"""
Tests for FastAPI HTTP endpoints.

Uses FastAPI's built-in TestClient (no real server needed).

Run:
    cd webui && pytest tests/test_server.py -v
"""

import sys
import io
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "server"))

# Patch the bridge before importing main so we don't need a real LinuxCNC
from unittest.mock import MagicMock, patch
import bridge as bridge_module

# Ensure mock mode (no linuxcnc module)
bridge_module.HAS_LINUXCNC = False

import main as main_module
from fastapi.testclient import TestClient

client = TestClient(main_module.app)


# ---- Static routes ----

class TestStaticRoutes:
    def test_index_returns_html(self):
        r = client.get("/")
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]
        assert "<html" in r.text.lower()

    def test_config_returns_json(self):
        r = client.get("/config")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_static_css_served(self):
        r = client.get("/static/css/base.css")
        assert r.status_code == 200
        assert "text/css" in r.headers.get("content-type", "")


# ---- Upload endpoint ----

class TestUpload:
    def _upload(self, filename, content=b"G0 X0 Y0\n"):
        return client.post(
            "/upload",
            files={"file": (filename, io.BytesIO(content), "text/plain")},
        )

    def test_upload_ngc_succeeds(self):
        r = self._upload("test.ngc")
        assert r.status_code == 200
        data = r.json()
        assert "path" in data
        assert "filename" in data
        assert data["filename"] == "test.ngc"

    def test_upload_returns_size(self):
        content = b"G0 X10\nG1 Y20\n"
        r = self._upload("prog.ngc", content)
        assert r.status_code == 200
        assert r.json()["size"] == len(content)

    def test_upload_disallowed_extension(self):
        r = self._upload("evil.exe", b"bad content")
        assert r.status_code == 400
        assert "not allowed" in r.json()["detail"].lower()

    def test_upload_nc_extension(self):
        r = self._upload("program.nc")
        assert r.status_code == 200

    def test_upload_gcode_extension(self):
        r = self._upload("program.gcode")
        assert r.status_code == 200

    def test_upload_tap_extension(self):
        r = self._upload("program.tap")
        assert r.status_code == 200

    def test_upload_file_saved_to_disk(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path)
        content = b"G0 X5\n"
        r = self._upload("check_saved.ngc", content)
        assert r.status_code == 200
        saved = tmp_path / "check_saved.ngc"
        assert saved.exists()
        assert saved.read_bytes() == content


# ---- /file endpoint ----

class TestFileRead:
    def test_read_file_in_upload_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path)
        f = tmp_path / "sample.ngc"
        f.write_text("G0 X0\nG1 Y10\n")
        r = client.get(f"/file?path={f}")
        assert r.status_code == 200
        assert "G0 X0" in r.text

    def test_read_file_outside_upload_dir_denied(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path)
        # Try to read a file outside the upload dir
        r = client.get("/file?path=/etc/passwd")
        assert r.status_code == 403

    def test_read_nonexistent_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path)
        missing = tmp_path / "missing.ngc"
        r = client.get(f"/file?path={missing}")
        assert r.status_code == 404

    def test_read_file_content_type(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main_module, "UPLOAD_DIR", tmp_path)
        f = tmp_path / "prog.ngc"
        f.write_text("G0 X0\n")
        r = client.get(f"/file?path={f}")
        assert "text/plain" in r.headers.get("content-type", "")


# ---- WebSocket ----
# The poll loop (20 Hz state frames) doesn't run inside TestClient's sync
# event loop, so tests only exercise the command → ack path, which is
# handled directly by the receiver coroutine without needing the poll loop.

class TestWebSocket:
    def test_ws_connects(self):
        """WebSocket handshake succeeds without error."""
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"cmd": "estop"})   # send something so receiver runs
            msg = ws.receive_json()
            assert msg is not None

    def test_ws_command_returns_ack(self):
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"cmd": "estop_reset"})
            msg = ws.receive_json()
            assert msg.get("type") == "ack"
            assert msg["ok"] is True

    def test_ws_ack_echoes_command_name(self):
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"cmd": "machine_on"})
            msg = ws.receive_json()
            assert msg.get("cmd") == "machine_on"

    def test_ws_multiple_commands(self):
        with client.websocket_connect("/ws") as ws:
            for cmd in ["estop_reset", "machine_on", "home_all"]:
                ws.send_json({"cmd": cmd})
                msg = ws.receive_json()
                assert msg.get("type") == "ack", f"Expected ack for {cmd}"
                assert msg["ok"] is True

    def test_ws_invalid_json_returns_error(self):
        with client.websocket_connect("/ws") as ws:
            ws.send_text("not valid json {{{{")
            msg = ws.receive_json()
            assert msg.get("type") == "error"
            assert "invalid json" in msg.get("error", "").lower()

    def test_ws_unknown_command_still_acks(self):
        """Mock mode returns ok=True for any unknown command."""
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"cmd": "not_a_real_command"})
            msg = ws.receive_json()
            assert msg.get("type") == "ack"
            assert msg["ok"] is True
