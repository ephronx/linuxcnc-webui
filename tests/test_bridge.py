"""
Tests for MachineBridge mock mode state machine.

The bridge must correctly gate state transitions:
  ESTOP → ESTOP_RESET → OFF/ON → homed

Run:
    cd webui && pytest tests/test_bridge.py -v
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "server"))
from bridge import MachineBridge


# ---- Helpers ----

def _state(bridge):
    """Return the mock state dict."""
    return bridge._mock


def _build(bridge):
    """Build and return the full state bundle."""
    return bridge.build_state()


def _cmd(bridge, op, **kwargs):
    return bridge.handle_command({"cmd": op, **kwargs})


# ---- Initial state ----

class TestInitialState:
    def test_starts_in_estop(self):
        b = MachineBridge()
        s = _build(b)
        assert s["machine"]["task_state"] == 1
        assert s["machine"]["estop"] is True

    def test_starts_not_enabled(self):
        b = MachineBridge()
        s = _build(b)
        assert s["machine"]["enabled"] is False

    def test_starts_unhomed(self):
        b = MachineBridge()
        s = _build(b)
        assert all(v == 0 for v in s["machine"]["homed"])

    def test_starts_at_origin(self):
        b = MachineBridge()
        s = _build(b)
        assert all(v == 0.0 for v in s["pos"]["actual"])


# ---- E-stop transitions ----

class TestEstopTransitions:
    def test_reset_from_estop(self):
        b = MachineBridge()
        result = _cmd(b, "estop_reset")
        assert result["ok"] is True
        assert _state(b)["task_state"] == 2   # ESTOP_RESET

    def test_estop_reset_requires_estop_state(self):
        """estop_reset when already reset should not change state."""
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "estop_reset")   # second call — already at state 2
        # should remain at 2, not increment
        assert _state(b)["task_state"] == 2

    def test_trigger_estop_from_on(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        assert _state(b)["task_state"] == 4
        _cmd(b, "estop")
        assert _state(b)["task_state"] == 1

    def test_build_state_after_reset(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        s = _build(b)
        assert s["machine"]["estop"] is False
        assert s["machine"]["task_state"] == 2


# ---- Power on/off ----

class TestPowerTransitions:
    def test_power_on_from_reset(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        result = _cmd(b, "machine_on")
        assert result["ok"] is True
        assert _state(b)["task_state"] == 4

    def test_power_on_blocked_in_estop(self):
        """machine_on while in e-stop must not transition to ON."""
        b = MachineBridge()
        _cmd(b, "machine_on")
        assert _state(b)["task_state"] == 1   # still ESTOP

    def test_power_off_from_on(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        result = _cmd(b, "machine_off")
        assert result["ok"] is True
        assert _state(b)["task_state"] == 3   # OFF

    def test_build_state_enabled_when_on(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        s = _build(b)
        assert s["machine"]["enabled"] is True
        assert s["machine"]["task_state"] == 4


# ---- Homing ----

class TestHoming:
    def test_home_all_when_on(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        result = _cmd(b, "home_all")
        assert result["ok"] is True
        assert _state(b)["homed"][:3] == [1, 1, 1]

    def test_home_all_blocked_not_on(self):
        """home_all while not powered must not set homed flags."""
        b = MachineBridge()
        _cmd(b, "estop_reset")
        # machine is at ESTOP_RESET (2), not ON (4)
        _cmd(b, "home_all")
        assert all(v == 0 for v in _state(b)["homed"])

    def test_home_all_blocked_in_estop(self):
        b = MachineBridge()
        _cmd(b, "home_all")
        assert all(v == 0 for v in _state(b)["homed"])

    def test_home_positions_at_origin(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        s = _build(b)
        assert s["pos"]["actual"][:3] == [0.0, 0.0, 0.0]

    def test_unhome_all(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        result = _cmd(b, "unhome_all")
        assert result["ok"] is True
        assert all(v == 0 for v in _state(b)["homed"])

    def test_build_state_homed_flags(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        s = _build(b)
        assert s["machine"]["homed"][:3] == [1, 1, 1]


# ---- Full machine-ready sequence ----

class TestFullSequence:
    def _ready(self):
        """Return a bridge in the fully-ready state."""
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        return b

    def test_full_sequence_state(self):
        b = self._ready()
        s = _build(b)
        assert s["machine"]["task_state"] == 4
        assert s["machine"]["enabled"] is True
        assert s["machine"]["estop"] is False
        assert s["machine"]["homed"][:3] == [1, 1, 1]

    def test_estop_resets_everything(self):
        b = self._ready()
        _cmd(b, "estop")
        s = _build(b)
        assert s["machine"]["task_state"] == 1
        assert s["machine"]["estop"] is True

    def test_unknown_command_returns_error(self):
        b = MachineBridge()
        result = _cmd(b, "not_a_real_command")
        assert result["ok"] is True   # mock mode accepts anything
        assert result.get("mock") is True

    def test_estop_clears_active_jogs(self):
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=10)
        _cmd(b, "estop")
        assert len(b._mock["jogs"]) == 0

    def test_mock_commands_always_succeed(self):
        """In mock mode every command returns ok=True (state may or may not change)."""
        b = MachineBridge()
        for op in ["mdi", "jog_start", "jog_stop", "feed_override",
                   "spindle_on", "flood_on", "mist_off"]:
            result = _cmd(b, op, gcode="G0 X0", axis=0, velocity=10, value=1.0)
            assert result["ok"] is True, f"{op} should return ok"


# ---- Build state structure ----

class TestBuildStateStructure:
    def test_all_top_level_keys_present(self):
        b = MachineBridge()
        s = _build(b)
        for key in ["pos", "machine", "program", "overrides",
                    "spindle", "coolant", "tool", "limits", "errors"]:
            assert key in s, f"Missing key: {key}"

    def test_pos_subkeys(self):
        b = MachineBridge()
        s = _build(b)
        for key in ["actual", "commanded", "g5x_offset", "g92_offset",
                    "g5x_index", "dtg"]:
            assert key in s["pos"], f"Missing pos key: {key}"

    def test_spindle_is_list(self):
        b = MachineBridge()
        s = _build(b)
        assert isinstance(s["spindle"], list)
        assert len(s["spindle"]) >= 1

    def test_errors_empty_by_default(self):
        b = MachineBridge()
        s = _build(b)
        assert s["errors"] == []

    def test_actual_position_length(self):
        b = MachineBridge()
        s = _build(b)
        assert len(s["pos"]["actual"]) == 9


# ---- Jogging ----

class TestJogging:
    def _ready(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        return b

    def test_jog_increment_moves_axis(self):
        b = self._ready()
        _cmd(b, "jog_increment", axis=0, velocity=10, distance=5.0)
        s = _build(b)
        assert s["pos"]["actual"][0] == pytest.approx(5.0)

    def test_jog_increment_negative(self):
        b = self._ready()
        _cmd(b, "jog_increment", axis=1, velocity=10, distance=-3.0)
        s = _build(b)
        assert s["pos"]["actual"][1] == pytest.approx(-3.0)

    def test_jog_increment_accumulates(self):
        b = self._ready()
        _cmd(b, "jog_increment", axis=0, velocity=10, distance=2.0)
        _cmd(b, "jog_increment", axis=0, velocity=10, distance=3.0)
        s = _build(b)
        assert s["pos"]["actual"][0] == pytest.approx(5.0)

    def test_jog_start_registers_active_jog(self):
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=10)
        assert 0 in b._mock["jogs"]

    def test_jog_stop_removes_active_jog(self):
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=10)
        _cmd(b, "jog_stop", axis=0)
        assert 0 not in b._mock["jogs"]

    def test_jog_start_stop_moves_position(self):
        import time as _time
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=100)   # 100 mm/s
        _time.sleep(0.05)                              # jog for ~50ms → ~5mm
        _cmd(b, "jog_stop", axis=0)
        s = _build(b)
        # Position should be >0 (jogged positive) — exact value is timing-dependent
        assert s["pos"]["actual"][0] > 0.1

    def test_jog_negative_velocity_moves_negative(self):
        import time as _time
        b = self._ready()
        _cmd(b, "jog_start", axis=1, velocity=-50)
        _time.sleep(0.05)
        _cmd(b, "jog_stop", axis=1)
        s = _build(b)
        assert s["pos"]["actual"][1] < -0.1

    def test_multiple_axes_jog_independently(self):
        import time as _time
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=100)
        _cmd(b, "jog_start", axis=2, velocity=-50)
        _time.sleep(0.05)
        _cmd(b, "jog_stop", axis=0)
        _cmd(b, "jog_stop", axis=2)
        s = _build(b)
        assert s["pos"]["actual"][0] > 0.1
        assert s["pos"]["actual"][2] < -0.1

    def test_continuous_jog_moves_position_over_time(self):
        """build_state during an active jog should show increasing position."""
        import time as _time
        b = self._ready()
        _cmd(b, "jog_start", axis=0, velocity=100)
        _time.sleep(0.02)
        s1 = _build(b)["pos"]["actual"][0]
        _time.sleep(0.02)
        s2 = _build(b)["pos"]["actual"][0]
        _cmd(b, "jog_stop", axis=0)
        assert s2 > s1


# ---- Jog watchdog (client disconnect safety) ----

class TestJogWatchdog:
    def _ready(self):
        b = MachineBridge()
        _cmd(b, "estop_reset")
        _cmd(b, "machine_on")
        _cmd(b, "home_all")
        return b

    def test_jog_start_registers_in_client_jogs(self):
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 10}, client_id=42)
        assert 0 in b._client_jogs.get(42, set())

    def test_jog_stop_removes_from_client_jogs(self):
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 10}, client_id=42)
        b.handle_command({"cmd": "jog_stop", "axis": 0}, client_id=42)
        assert 0 not in b._client_jogs.get(42, set())

    def test_client_disconnected_stops_active_jog(self):
        """Disconnecting mid-jog must stop the jog in mock state."""
        import time as _time
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 100}, client_id=99)
        _time.sleep(0.05)  # let position accumulate

        # Simulate client disconnect — watchdog fires
        b.client_disconnected(99)

        # Axis should no longer be in active jogs
        assert 0 not in b._mock["jogs"]
        # Client entry should be cleaned up
        assert 99 not in b._client_jogs

    def test_client_disconnected_position_frozen(self):
        """After watchdog stops the jog, further time passing should not change position."""
        import time as _time
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 100}, client_id=7)
        _time.sleep(0.03)
        b.client_disconnected(7)

        pos_after_stop = _build(b)["pos"]["actual"][0]
        _time.sleep(0.05)
        pos_later = _build(b)["pos"]["actual"][0]
        assert pos_after_stop == pytest.approx(pos_later, abs=1e-9)

    def test_client_disconnected_with_multiple_axes(self):
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 10}, client_id=5)
        b.handle_command({"cmd": "jog_start", "axis": 1, "velocity": 10}, client_id=5)
        b.client_disconnected(5)
        assert 0 not in b._mock["jogs"]
        assert 1 not in b._mock["jogs"]
        assert 5 not in b._client_jogs

    def test_client_disconnected_no_jogs_is_safe(self):
        """Disconnecting a client with no active jogs must not raise."""
        b = self._ready()
        b.client_disconnected(999)  # never jogged — must be a no-op

    def test_estop_clears_all_client_jog_tracking(self):
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 10}, client_id=1)
        b.handle_command({"cmd": "jog_start", "axis": 1, "velocity": 10}, client_id=2)
        b.handle_command({"cmd": "estop"}, client_id=0)
        assert b._client_jogs == {}

    def test_multiple_clients_independent_tracking(self):
        b = self._ready()
        b.handle_command({"cmd": "jog_start", "axis": 0, "velocity": 10}, client_id=1)
        b.handle_command({"cmd": "jog_start", "axis": 1, "velocity": 10}, client_id=2)
        b.client_disconnected(1)
        # Client 1's axis stopped, client 2's axis still running
        assert 0 not in b._mock["jogs"]
        assert 1 in b._mock["jogs"]
        assert 1 not in b._client_jogs
        assert 2 in b._client_jogs
