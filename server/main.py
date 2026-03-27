"""
LinuxCNC Web UI — FastAPI server

Serves the frontend and provides a WebSocket endpoint at /ws.
Each connected client gets a per-client send queue so the poll loop
and command ACKs never race on the same socket.

Usage:
    python main.py [--port 8080] [--ini /path/to/machine.ini]
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Allow running from the webui/ root or the server/ subdirectory
sys.path.insert(0, str(Path(__file__).parent))
from bridge import MachineBridge
import config as machine_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("webui")

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    bridge.connect()
    asyncio.create_task(bridge.poll_loop())
    log.info("Poll loop started")
    log.info(f"Machine: {machine_cfg.get('machine_name', '?')}  "
             f"axes={machine_cfg.get('axes', [])}  "
             f"units={machine_cfg.get('units', '?')}")
    yield   # app runs here


app = FastAPI(title="LinuxCNC Web UI", lifespan=lifespan)
bridge = MachineBridge()
machine_cfg: dict = {}

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# G-code upload directory — prefer ~/linuxcnc/nc_files, fall back to a local dir
_DEFAULT_NC_DIR = Path.home() / "linuxcnc" / "nc_files"
UPLOAD_DIR: Path = _DEFAULT_NC_DIR if _DEFAULT_NC_DIR.exists() else Path(__file__).parent.parent / "nc_files"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_SUFFIXES = {".ngc", ".nc", ".gcode", ".tap", ".cnc"}


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------

@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/config")
async def get_config():
    """Return machine config to the frontend on startup."""
    return machine_cfg


@app.post("/upload")
async def upload_gcode(file: UploadFile = File(...)):
    """
    Accept a G-code file upload and save it to UPLOAD_DIR.
    The frontend sends a 'program_open' command over WebSocket after this
    returns, which is where the running-program guard is enforced.
    Returns {"path": "/absolute/path/to/file"} on success.
    """
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"File type {suffix!r} not allowed")

    dest = UPLOAD_DIR / file.filename
    contents = await file.read()
    dest.write_bytes(contents)
    log.info(f"Uploaded {file.filename} → {dest}")

    return {"path": str(dest), "filename": file.filename, "size": len(contents)}


@app.get("/file")
async def read_gcode(path: str):
    """Return the raw text of a G-code file that is inside UPLOAD_DIR."""
    p = Path(path).resolve()
    # Security: only serve files inside UPLOAD_DIR
    if not str(p).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return PlainTextResponse(p.read_text(errors="replace"))


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = id(websocket)
    queue: asyncio.Queue = asyncio.Queue(maxsize=5)
    bridge.clients[client_id] = queue
    # Send the last known state immediately so the new client doesn't show
    # stale/default UI while waiting for the next poll tick.
    bridge.push_initial_state(client_id)
    log.info(f"Client {client_id} connected  (total: {len(bridge.clients)})")

    async def sender():
        """Drain the per-client queue and push state frames."""
        while True:
            msg = await queue.get()
            await websocket.send_text(msg)

    async def receiver():
        """Receive commands and send ACKs."""
        async for raw in websocket.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "error": "invalid json"})
                continue
            result = bridge.handle_command(msg, client_id=client_id)
            await websocket.send_json({"type": "ack", "cmd": msg.get("cmd"), **result})

    try:
        # Run sender and receiver concurrently on the same socket.
        # asyncio.gather cancels both when either raises.
        await asyncio.gather(sender(), receiver())
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"Client {client_id} error: {e}")
    finally:
        bridge.clients.pop(client_id, None)
        # Watchdog: stop any jogs this client left running
        bridge.client_disconnected(client_id)
        log.info(f"Client {client_id} disconnected  (total: {len(bridge.clients)})")


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global machine_cfg

    parser = argparse.ArgumentParser(description="LinuxCNC Web UI server")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--host", default="127.0.0.1",
                        help="Bind address. Use 0.0.0.0 to allow LAN access.")
    parser.add_argument("--ini", default=None,
                        help="Path to LinuxCNC INI file")
    parser.add_argument("--open-browser", action="store_true",
                        help="Open browser automatically on start")
    args = parser.parse_args()

    machine_cfg = machine_config.load(args.ini)

    if args.open_browser:
        import threading, webbrowser
        def _open():
            import time; time.sleep(1.5)
            webbrowser.open(f"http://127.0.0.1:{args.port}")
        threading.Thread(target=_open, daemon=True).start()

    log.info(f"Starting LinuxCNC Web UI on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
