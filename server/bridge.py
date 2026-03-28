"""
Machine bridge — polls linuxcnc.stat() and dispatches commands.

Runs in mock mode automatically when the linuxcnc module is not available
(e.g. developing on a non-LinuxCNC machine). Mock mode provides moving
position data so the frontend can be developed without a running machine.
"""

import asyncio
import bisect
import json
import logging
import re as _re
import time
from typing import Dict

try:
    import linuxcnc
    HAS_LINUXCNC = True
except ImportError:
    HAS_LINUXCNC = False

log = logging.getLogger(__name__)


def _parse_waypoints(path: str):
    """Parse a G-code file and return (waypoints, waypoint_lines).

    waypoints  — list of (line_num, x, y, z) in WCS mm, sorted by line_num
    waypoint_lines — list of just the line numbers (for bisect lookups)
    """
    waypoints = []
    x, y, z = 0.0, 0.0, 0.0
    abs_mode = True
    scale    = 1.0
    motion   = 0
    try:
        with open(path) as f:
            for line_num, raw in enumerate(f, 1):
                line = _re.sub(r'\(.*?\)', '', raw).split(';')[0].strip().upper()
                if not line:
                    continue
                words = {m.group(1): float(m.group(2))
                         for m in _re.finditer(r'([A-Z])\s*(-?\d*\.?\d+)', line)}
                if 'G' in words:
                    g = round(words['G'] * 10) / 10
                    if g in (0, 1, 2, 3): motion = g
                    if g == 90: abs_mode = True
                    if g == 91: abs_mode = False
                    if g == 20: scale = 25.4
                    if g == 21: scale = 1.0
                if not any(k in words for k in ('X', 'Y', 'Z')):
                    continue
                if abs_mode:
                    if 'X' in words: x = words['X'] * scale
                    if 'Y' in words: y = words['Y'] * scale
                    if 'Z' in words: z = words['Z'] * scale
                else:
                    if 'X' in words: x += words['X'] * scale
                    if 'Y' in words: y += words['Y'] * scale
                    if 'Z' in words: z += words['Z'] * scale
                waypoints.append((line_num, x, y, z))
    except Exception as e:
        log.warning(f"Could not parse waypoints from {path}: {e}")
    lines = [w[0] for w in waypoints]
    return waypoints, lines


class MachineBridge:
    def __init__(self):
        self._stat = None
        self._cmd = None
        self._err = None
        # client_id -> asyncio.Queue  (populated by main.py)
        self.clients: Dict[int, asyncio.Queue] = {}
        # Watchdog: tracks which axes each client is continuously jogging.
        # client_id -> set of axis indices.  Used to stop jogs on disconnect.
        self._client_jogs: Dict[int, set] = {}
        # Last serialised state frame — sent immediately to newly connected clients
        # so they see the current machine state without waiting for the next poll tick.
        self._last_state_json: str | None = None
        # Mock mode machine state — starts in e-stop, stationary at origin
        self._mock = {
            "task_state": 1,   # 1=ESTOP 2=ESTOP_RESET 3=OFF 4=ON
            "homed": [0] * 9,
            "pos": [0.0] * 9,
            # active continuous jogs: axis_index -> (velocity mm/s, start_time, start_pos)
            "jogs": {},
            # overrides (stored as fractions, 1.0 = 100%)
            "feed_override":    1.0,
            "rapid_override":   1.0,
            "spindle_override": 1.0,
            "flood": False,
            "mist":  False,
            # WCS state: index 1=G54 … 6=G59, offsets[i] is 9-element list
            "g5x_index":    1,
            "g5x_offsets":  [[0.0] * 9 for _ in range(10)],
            # Program / auto-mode state
            "program_file":          "",
            "program_total_lines":   0,
            "program_line":          0,
            "program_running":       False,
            "program_paused":        False,
            "program_last_advance":  0.0,   # time.time() of last line increment
            "mode":                  1,     # 1=MANUAL 2=AUTO 3=MDI
            # Parsed waypoints for position simulation
            "program_waypoints":     [],    # [(line_num, x, y, z), ...] WCS mm
            "program_waypoint_lines":[],    # [line_num, ...] parallel list for bisect
        }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """
        Open connections to the running LinuxCNC instance.
        Returns True if connection succeeded, False otherwise.
        Safe to call repeatedly — retries after a failed or dropped connection.
        """
        if not HAS_LINUXCNC:
            log.warning("linuxcnc module not available — running in mock mode")
            return False
        try:
            self._stat = linuxcnc.stat()
            self._cmd = linuxcnc.command()
            self._err = linuxcnc.error_channel()
            self._stat.poll()   # verify the connection is live
            log.info("Connected to LinuxCNC")
            return True
        except Exception as e:
            self._stat = None
            self._cmd = None
            self._err = None
            log.warning(f"Could not connect to LinuxCNC: {e} — running in mock mode")

    # ------------------------------------------------------------------
    # State polling
    # ------------------------------------------------------------------

    @property
    def is_mock(self) -> bool:
        return not HAS_LINUXCNC or self._stat is None

    def build_state(self) -> dict:
        if self.is_mock:
            state = self._mock_state()
            state["mock"] = True
            return state
        try:
            state = self._real_state()
            state["mock"] = False
            return state
        except Exception as e:
            log.warning(f"stat poll error: {e} — dropping frame")
            # Mark stat as None so retry logic kicks in next cycle
            self._stat = None
            return {}

    def _real_state(self) -> dict:
        s = self._stat
        s.poll()

        # Drain the error channel
        errors = []
        if self._err:
            while True:
                result = self._err.poll()
                if not result:
                    break
                kind, text = result
                errors.append({"kind": kind, "text": text})

        # Spindle data — linuxcnc.stat.spindle is a tuple of dicts
        spindle_data = []
        for sp in s.spindle:
            spindle_data.append({
                "speed":            sp.get("speed", 0.0),
                "direction":        sp.get("direction", 0),
                "enabled":          bool(sp.get("enabled", False)),
                "at_speed":         bool(sp.get("at_speed", False)),
                "override":         sp.get("override", 1.0),
                "override_enabled": bool(sp.get("override_enabled", True)),
                "brake":            bool(sp.get("brake", False)),
            })

        return {
            "pos": {
                "actual":     list(s.actual_position),
                "commanded":  list(s.position),
                "g5x_offset": list(s.g5x_offset),
                "g92_offset": list(s.g92_offset),
                "g5x_index":  s.g5x_index,
                "dtg":        list(s.dtg),
            },
            "machine": {
                "estop":        bool(s.estop),
                "enabled":      bool(s.enabled),
                "homed":        list(s.homed),
                "mode":         s.task_mode,
                "interp_state": s.interp_state,
                "motion_mode":  s.motion_mode,
                "motion_type":  s.motion_type,
                "task_state":   s.task_state,
                "exec_state":   s.exec_state,
            },
            "program": {
                "file":       s.file,
                "line":       s.current_line,
                "motion_line": s.motion_line,
                "run_time":   getattr(s, "task_heartbeat", 0),
            },
            "overrides": {
                "feed":    s.feedrate,
                "rapid":   s.rapidrate,
            },
            "spindle": spindle_data,
            "coolant": {
                "flood": bool(s.flood),
                "mist":  bool(s.mist),
            },
            "tool": {
                "number": s.tool_in_spindle,
                "offset": list(s.tool_offset),
            },
            "limits": {
                "min_soft": list(s.min_position_limit),
                "max_soft": list(s.max_position_limit),
            },
            "errors": errors,
        }

    def _mock_state(self) -> dict:
        """Return fake state that respects the simulated machine state."""
        m = self._mock
        ts = m["task_state"]
        is_on = ts == 4
        all_homed = is_on and all(m["homed"][:3])

        # Integrate active continuous jogs into position (only when not running a program)
        now = time.time()
        pos = list(m["pos"])
        if not m["program_running"]:
            for axis, (vel, t0, p0) in m["jogs"].items():
                pos[axis] = p0 + vel * (now - t0)
            # Persist integrated positions so jog_stop can read them
            m["pos"] = pos

        # Advance program line if running (3 lines/second)
        prog_line = m["program_line"]
        if m["program_running"] and not m["program_paused"]:
            now_t = time.time()
            elapsed = now_t - m["program_last_advance"]
            lines_to_add = int(elapsed * 3.0)
            if lines_to_add > 0:
                prog_line = min(prog_line + lines_to_add, m["program_total_lines"])
                m["program_line"] = prog_line
                m["program_last_advance"] = now_t
                if prog_line >= m["program_total_lines"]:
                    m["program_running"] = False
                    m["program_paused"]  = False
                    m["mode"]            = 1  # back to MANUAL when done

        # Move simulated tool position along the parsed waypoints
        if m["program_running"] or m["program_paused"]:
            wp      = m["program_waypoints"]
            wp_lns  = m["program_waypoint_lines"]
            if wp and wp_lns:
                idx = bisect.bisect_right(wp_lns, m["program_line"]) - 1
                if idx >= 0:
                    _, wx, wy, wz = wp[idx]
                    off = m["g5x_offsets"][m["g5x_index"]]
                    pos = [wx + off[0], wy + off[1], wz + off[2]] + [0.0] * 6
                    m["pos"] = pos

        # interp_state: 1=IDLE 2=READING 3=PAUSED
        if m["program_running"] and not m["program_paused"]:
            interp_state = 2
        elif m["program_paused"]:
            interp_state = 3
        else:
            interp_state = 1

        return {
            "pos": {
                "actual":     list(pos),
                "commanded":  list(pos),
                "g5x_offset": list(m["g5x_offsets"][m["g5x_index"]]),
                "g92_offset": [0.0] * 9,
                "g5x_index":  m["g5x_index"],
                "dtg":        [0.0] * 9,
            },
            "machine": {
                "estop":        ts == 1,
                "enabled":      is_on,
                "homed":        list(m["homed"]),
                "mode":         m["mode"],
                "interp_state": interp_state,
                "motion_mode":  1,
                "motion_type":  0,
                "task_state":   ts,
                "exec_state":   1,
            },
            "program": {
                "file":        m.get("program_file", ""),
                "line":        prog_line,
                "motion_line": prog_line,
                "run_time":    0,
            },
            "overrides": {"feed": m["feed_override"], "rapid": m["rapid_override"]},
            "spindle": [{
                "speed": 0.0, "direction": 0, "enabled": False,
                "at_speed": False, "override": m["spindle_override"],
                "override_enabled": True, "brake": False,
            }],
            "coolant": {"flood": m["flood"], "mist": m["mist"]},
            "tool": {"number": 0, "offset": [0.0] * 9},
            "limits": {
                "min_soft": [False] * 9,
                "max_soft": [False] * 9,
            },
            "errors": [],
        }

    # ------------------------------------------------------------------
    # Command dispatch
    # ------------------------------------------------------------------

    def handle_command(self, msg: dict, client_id: int = 0) -> dict:
        if not HAS_LINUXCNC or self._cmd is None:
            result = self._mock_dispatch(msg)
        else:
            try:
                result = self._dispatch(msg)
            except Exception as e:
                log.error(f"Command error: {e}")
                return {"ok": False, "error": str(e)}

        # Watchdog bookkeeping — track which axes each client is jogging so
        # we can stop them safely if the client disconnects mid-jog.
        op = msg.get("cmd", "")
        if op == "jog_start":
            axis = int(msg.get("axis", 0))
            self._client_jogs.setdefault(client_id, set()).add(axis)
        elif op in ("jog_stop", "jog_increment"):
            axis = int(msg.get("axis", 0))
            self._client_jogs.get(client_id, set()).discard(axis)
        elif op == "estop":
            # Hard stop — clear all tracked jogs for all clients
            self._client_jogs.clear()

        return result

    def client_disconnected(self, client_id: int) -> None:
        """
        Called when a WebSocket client disconnects.  Stops any continuous jogs
        that were initiated by that client so the machine does not keep moving.
        """
        axes = self._client_jogs.pop(client_id, set())
        for axis in axes:
            log.warning(
                f"Client {client_id} disconnected mid-jog — "
                f"sending jog_stop for axis {axis}"
            )
            stop_msg = {"cmd": "jog_stop", "axis": axis}
            try:
                if not HAS_LINUXCNC or self._cmd is None:
                    self._mock_dispatch(stop_msg)
                else:
                    self._dispatch(stop_msg)
            except Exception as e:
                log.error(f"Watchdog jog_stop failed for axis {axis}: {e}")

    def _mock_dispatch(self, msg: dict) -> dict:
        """Simulate state changes in mock mode so the UI gates work correctly."""
        op = msg.get("cmd", "")
        m = self._mock
        log.info(f"[mock] {op}")

        if op == "estop":
            m["task_state"] = 1
            m["jogs"].clear()
        elif op == "estop_reset":
            if m["task_state"] == 1:
                m["task_state"] = 2
        elif op == "machine_on":
            if m["task_state"] in (2, 3):
                m["task_state"] = 4
        elif op == "machine_off":
            m["task_state"] = 3
        elif op == "home_all":
            if m["task_state"] == 4:
                m["homed"] = [1, 1, 1, 0, 0, 0, 0, 0, 0]
                m["pos"]   = [0.0] * 9   # home position is machine zero
        elif op == "unhome_all":
            m["homed"] = [0] * 9

        elif op == "jog_start":
            axis = int(msg.get("axis", 0))
            vel  = float(msg.get("velocity", 0))
            # snapshot current position so integration starts from here
            m["jogs"][axis] = (vel, time.time(), m["pos"][axis])

        elif op == "jog_stop":
            axis = int(msg.get("axis", 0))
            # Flush integrated position before removing the jog entry
            if axis in m["jogs"]:
                vel, t0, p0 = m["jogs"].pop(axis)
                m["pos"][axis] = p0 + vel * (time.time() - t0)

        elif op == "jog_increment":
            axis     = int(msg.get("axis", 0))
            velocity = float(msg.get("velocity", 1))
            distance = float(msg.get("distance", 0))
            m["pos"][axis] += distance

        elif op == "feed_override":
            m["feed_override"]    = max(0.0, float(msg.get("value", 1.0)))
        elif op == "rapid_override":
            m["rapid_override"]   = max(0.0, float(msg.get("value", 1.0)))
        elif op == "spindle_override":
            m["spindle_override"] = max(0.0, float(msg.get("value", 1.0)))

        elif op == "flood_on":  m["flood"] = True
        elif op == "flood_off": m["flood"] = False
        elif op == "mist_on":   m["mist"]  = True
        elif op == "mist_off":  m["mist"]  = False

        elif op == "set_work_coord":
            # Activate a WCS (e.g. "G54" → index 1)
            code = str(msg.get("code", "G54")).upper().strip()
            idx_map = {"G54": 1, "G55": 2, "G56": 3, "G57": 4, "G58": 5, "G59": 6}
            m["g5x_index"] = idx_map.get(code, 1)

        elif op == "mdi":
            import re
            gcode = str(msg.get("gcode", "")).upper().strip()
            # G10 L20 P{n} {axis}{val} — touch-off: set WCS so that axis reads val here
            # G10 L20 Pn means: new_offset = current_machine_pos - target_val
            hit = re.match(r"G10\s+L20\s+P(\d+)\s+(.+)", gcode)
            if hit:
                p = int(hit.group(1))
                if 1 <= p <= 9:
                    # Integrate any active jogs for accurate current position
                    now = time.time()
                    pos = list(m["pos"])
                    for axis, (vel, t0, p0) in m["jogs"].items():
                        pos[axis] = p0 + vel * (now - t0)
                    axis_map = {"X": 0, "Y": 1, "Z": 2, "A": 3, "B": 4, "C": 5}
                    for am in re.finditer(r"([XYZABC])(-?[\d.]+)", hit.group(2)):
                        ai = axis_map.get(am.group(1), -1)
                        if ai >= 0:
                            m["g5x_offsets"][p][ai] = pos[ai] - float(am.group(2))

        elif op == "program_open":
            if m.get("program_running"):
                return {"ok": False, "error": "program is running — stop it first"}
            path = str(msg.get("path", ""))
            m["program_file"]    = path
            m["program_line"]    = 0
            m["program_running"] = False
            m["program_paused"]  = False
            m["mode"]            = 1
            # Parse waypoints and count lines
            wp, wp_lns = _parse_waypoints(path)
            m["program_waypoints"]      = wp
            m["program_waypoint_lines"] = wp_lns
            try:
                with open(path) as _f:
                    m["program_total_lines"] = sum(1 for _ in _f)
            except Exception:
                m["program_total_lines"] = len(wp) or 100

        elif op == "program_run":
            if m["program_file"] and m["task_state"] == 4:
                start = int(msg.get("start_line", 0))
                m["program_line"]         = start
                m["program_running"]      = True
                m["program_paused"]       = False
                m["program_last_advance"] = time.time()
                m["mode"]                 = 2  # AUTO

        elif op == "program_pause":
            if m["program_running"]:
                m["program_paused"] = True

        elif op == "program_resume":
            if m["program_running"] and m["program_paused"]:
                m["program_paused"]       = False
                m["program_last_advance"] = time.time()

        elif op == "program_step":
            if m["program_file"] and m["task_state"] == 4:
                m["program_running"] = False
                m["program_paused"]  = False
                m["mode"]            = 2  # AUTO
                total = m["program_total_lines"]
                m["program_line"] = min(m["program_line"] + 1, total)

        elif op == "program_stop":
            m["program_running"] = False
            m["program_paused"]  = False
            m["program_line"]    = 0
            m["mode"]            = 1  # MANUAL

        # All other mock commands are acknowledged but ignored
        return {"ok": True, "mock": True}

    def _dispatch(self, msg: dict) -> dict:
        c = self._cmd
        op = msg.get("cmd", "")

        if op == "estop":
            c.state(linuxcnc.STATE_ESTOP)

        elif op == "estop_reset":
            c.state(linuxcnc.STATE_ESTOP_RESET)

        elif op == "machine_on":
            c.state(linuxcnc.STATE_ON)

        elif op == "machine_off":
            c.state(linuxcnc.STATE_OFF)

        elif op == "home_all":
            c.home(-1)

        elif op == "home":
            c.home(int(msg["axis"]))

        elif op == "unhome_all":
            c.teleop_enable(False)
            c.home(-1)  # home -1 with all homed = unhome

        elif op == "mdi":
            c.mode(linuxcnc.MODE_MDI)
            c.wait_complete()
            c.mdi(str(msg["gcode"]))

        elif op == "program_open":
            self._stat.poll()
            if self._stat.interp_state == 2:  # INTERP_READING
                return {"ok": False, "error": "program is running — stop it first"}
            c.program_open(str(msg["path"]))

        elif op == "program_run":
            c.mode(linuxcnc.MODE_AUTO)
            c.wait_complete()
            c.auto(linuxcnc.AUTO_RUN, msg.get("start_line", 0))

        elif op == "program_pause":
            c.auto(linuxcnc.AUTO_PAUSE)

        elif op == "program_resume":
            c.auto(linuxcnc.AUTO_RESUME)

        elif op == "program_step":
            c.auto(linuxcnc.AUTO_STEP)

        elif op == "program_stop":
            c.abort()

        elif op == "jog_start":
            # joint_flag=False means axis (teleop) mode
            c.jog(linuxcnc.JOG_CONTINUOUS, False,
                  int(msg["axis"]), float(msg["velocity"]))

        elif op == "jog_stop":
            c.jog(linuxcnc.JOG_STOP, False, int(msg["axis"]))

        elif op == "jog_increment":
            c.jog(linuxcnc.JOG_INCREMENT, False,
                  int(msg["axis"]), float(msg["velocity"]), float(msg["distance"]))

        elif op == "feed_override":
            c.feedrate(float(msg["value"]))

        elif op == "rapid_override":
            c.rapidrate(float(msg["value"]))

        elif op == "spindle_override":
            c.spindleoverride(float(msg["value"]), int(msg.get("spindle", 0)))

        elif op == "spindle_on":
            c.spindle(linuxcnc.SPINDLE_FORWARD, float(msg.get("speed", 0)),
                      int(msg.get("spindle", 0)))

        elif op == "spindle_off":
            c.spindle(linuxcnc.SPINDLE_OFF, 0, int(msg.get("spindle", 0)))

        elif op == "flood_on":
            c.flood(linuxcnc.FLOOD_ON)

        elif op == "flood_off":
            c.flood(linuxcnc.FLOOD_OFF)

        elif op == "mist_on":
            c.mist(linuxcnc.MIST_ON)

        elif op == "mist_off":
            c.mist(linuxcnc.MIST_OFF)

        elif op == "abort":
            c.abort()

        elif op == "set_work_coord":
            c.mode(linuxcnc.MODE_MDI)
            c.wait_complete()
            c.mdi(str(msg["code"]))  # e.g. "G54"

        else:
            return {"ok": False, "error": f"unknown command: {op}"}

        return {"ok": True}

    # ------------------------------------------------------------------
    # Push loop — called as a background asyncio task
    # ------------------------------------------------------------------

    def is_program_running(self) -> bool:
        """Return True if a program is currently executing (mock or real)."""
        if not HAS_LINUXCNC or self._stat is None:
            return bool(self._mock.get("program_running"))
        try:
            self._stat.poll()
            return self._stat.interp_state == 2  # INTERP_READING
        except Exception:
            return False

    def push_initial_state(self, client_id: int) -> None:
        """Push the last known state frame immediately to a newly connected client."""
        if self._last_state_json and client_id in self.clients:
            try:
                self.clients[client_id].put_nowait(self._last_state_json)
            except asyncio.QueueFull:
                pass

    async def poll_loop(self):
        """Push state to all connected clients at 20Hz.
        Automatically retries LinuxCNC connection every 5 seconds if lost."""
        _retry_ticks = 0
        _RETRY_INTERVAL = 100  # ticks at 20Hz = 5 seconds

        while True:
            # Retry connecting to LinuxCNC if we lost (or never had) the connection
            if HAS_LINUXCNC and self._stat is None:
                _retry_ticks += 1
                if _retry_ticks >= _RETRY_INTERVAL:
                    _retry_ticks = 0
                    log.info("Attempting to reconnect to LinuxCNC...")
                    self.connect()

            if self.clients:
                state = self.build_state()
                if state:
                    msg = json.dumps(state)
                    self._last_state_json = msg
                    for client_id, queue in list(self.clients.items()):
                        try:
                            # Drop frame if client queue is full (slow client)
                            queue.put_nowait(msg)
                        except asyncio.QueueFull:
                            pass
            await asyncio.sleep(0.05)  # 20 Hz
