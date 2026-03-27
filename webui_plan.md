# LinuxCNC Web UI — Project Plan

> Local working document — not for version control
> Goal: replace QtDragon with a modern, fully responsive browser-based UI
> Feature parity with QtDragon as baseline, then improve from there

---

## Why

- QtDragon is pixel-locked — 184 of 416 widgets have fixed sizes, 44% of the UI doesn't scale
- A web UI is inherently responsive — one codebase works on a 7" panel, laptop, 4K monitor, or tablet
- Modern CSS/JS tooling makes iteration fast — no recompiling, no Qt Designer
- The LinuxCNC Python API (`linuxcnc`, `hal`) is stable and well-understood
- Local loopback latency is <5ms for commands, 20–50ms for display updates — imperceptible

---

## Architecture

```
LinuxCNC realtime core  (kernel modules, HAL, motion)
        │
        │  shared memory
        ▼
  Python bridge server   ←── the only new backend code needed
  (FastAPI + WebSockets)
        │
        │  JSON over WebSocket (loopback, ~0.2ms RTT)
        ▼
  Browser frontend        ←── HTML / CSS / JS
  (runs in Chromium/Firefox on same machine)
```

### Why FastAPI + WebSockets
- Async by default — poll loop and multiple WS connections don't block each other
- WebSockets give push-based updates (no polling from browser side)
- Runs as a standard Python process alongside LinuxCNC
- No new dependencies that aren't already on a LinuxCNC machine (pip install fastapi uvicorn)

### Data flow
```
stat.poll() every 50ms  →  JSON push to all connected clients
Browser button click     →  WS message  →  cmd.*() call  →  NML queue
HAL pin read            →  included in stat JSON bundle
```

### E-stop note
The physical e-stop remains hardwired through HAL — never goes through the web UI.
The UI e-stop button sends `cmd.state(linuxcnc.STATE_ESTOP)` as a software backup only,
exactly as QtDragon does.

---

## Technology Choices

| Layer | Choice | Reason |
|-------|--------|--------|
| Backend | Python 3, FastAPI, uvicorn | Already on LinuxCNC machines, async, minimal |
| WebSocket | `websockets` via FastAPI | Built-in, stable |
| Frontend framework | **Vanilla JS + CSS custom properties** (phase 1) | Zero build step, works offline, no npm needed |
| Frontend framework | Consider Alpine.js or Vue 3 (phase 2) | Reactive state without full SPA complexity |
| CSS approach | CSS custom properties for theming, CSS Grid + Flexbox for layout | Native responsive, no framework lock-in |
| 3D toolpath | Three.js or Babylon.js canvas renderer | Replaces gcode_graphics widget |
| Code editor | CodeMirror 6 | Syntax highlighting, line numbers, lightweight |
| Fonts/icons | Self-hosted — no CDN calls | Works on air-gapped machines |
| Launcher | Added to LinuxCNC INI `[DISPLAY]` section | Integrates with existing startup |

---

## Project Structure (target)

```
linuxcnc-webui/
├── server/
│   ├── main.py              # FastAPI app, WebSocket handler, startup
│   ├── bridge.py            # linuxcnc stat/cmd/error polling loop
│   ├── hal_bridge.py        # HAL pin read/write
│   └── config.py            # reads INI for machine config
├── frontend/
│   ├── index.html           # single page
│   ├── css/
│   │   ├── base.css         # reset, custom properties (colour tokens, sizing)
│   │   ├── layout.css       # grid structure, responsive breakpoints
│   │   ├── components.css   # buttons, DRO, sliders, LEDs
│   │   └── theme-dark.css   # dark industrial theme (default)
│   ├── js/
│   │   ├── ws.js            # WebSocket connection, reconnect logic
│   │   ├── state.js         # machine state store (plain JS object)
│   │   ├── dro.js           # DRO update logic
│   │   ├── jog.js           # jog button hold/release handling
│   │   ├── tabs.js          # tab switching
│   │   ├── gcode-view.js    # toolpath renderer (Three.js)
│   │   ├── gcode-editor.js  # CodeMirror integration
│   │   └── overrides.js     # feed/spindle/rapid override sliders
│   └── lib/                 # vendored: three.js, codemirror, alpine (if used)
└── linuxcnc_webui.py        # entry point — called from INI DISPLAY line
```

---

## Build Phases

### Phase 1 — Server bridge + bare-bones UI ✅ COMPLETE

Get the data flowing and commands working. UI can be ugly.

- [x] `bridge.py` — poll `stat()` at 20Hz, build JSON state bundle
- [x] `bridge.py` — expose `cmd.*()` calls via message dispatch table
- [x] `bridge.py` — relay `error_channel()` messages
- [x] `bridge.py` — mock mode (no LinuxCNC required) with simulated position, jog, WCS, touch-off
- [x] `main.py` — FastAPI app, single `/ws` WebSocket endpoint
- [x] `main.py` — serve static frontend files at `/`
- [x] `main.py` — read machine INI (axes, limits, units) on startup
- [x] `ws.js` — connect, auto-reconnect on disconnect
- [x] `state.js` — receive JSON, update state object
- [x] Basic HTML page — DRO readout, E-stop + Machine On, MDI

**Exit criteria:** Can home, MDI a move, read position back correctly. ✅

---

### Phase 2 — Main tab (the screen you look at 90% of the time) ✅ LARGELY COMPLETE

- [x] **Layout** — responsive CSS Grid with tab-based navigation
- [x] **DRO panel**
  - [x] X/Y/Z WCS position (primary, large) + ABS machine position (secondary, dim)
  - [x] WCS / ABS toggle button group (matches QtDragon pattern)
  - [x] Per-axis Zero button (sends G10 L20)
  - [x] A/B/C axes shown/hidden based on INI config
  - [x] Units (mm/inch) from INI — decimal places adapt
  - [ ] Per-axis home button (home individual axis)
- [x] **Toolpath viewer** (2D canvas renderer — upgrade to 3D later)
  - [x] Client-side G-code parser, rendered on OffscreenCanvas
  - [x] Live tool position marker + amber motion trail (last 80 positions, fading)
  - [x] Zoom / pan (mouse + touch)
  - [x] View presets: XY / XZ / YZ planes + 3D orbit view
  - [x] Fit-to-content button (respects gcode listing panel height)
  - [x] WCS offset applied — toolpath shifts in machine space when G54 changes
  - [x] Machine envelope bounds shown
  - [x] Correct 3D coordinate orientation — Z+ up, right-hand rule
  - [x] Executed segments highlighted green; pending segments in depth-shaded blue
  - [ ] Extents readout overlay
- [x] **Program control bar**
  - [x] Cycle Start / Pause / Stop / Step / Rewind
  - [x] Progress bar with % complete centered (1.8rem tall, fills with accent colour)
  - [x] Status message bar (colour-coded: default / warn / critical)
  - [ ] Run time display
- [x] **Jog controls**
  - [x] XY grid + Z+/Z- buttons (hold to jog continuous, release to stop)
  - [x] Jog increment selector (0.001 → 10mm)
  - [x] Jog velocity slider
  - [x] Jog panel hidden in AUTO mode (matches QtDragon behaviour)
  - [ ] A axis controls (conditional on config)
- [x] **Override sliders** — feed / rapid / spindle (0–200%)
- [x] **Spindle** — on/off buttons, RPM display, LED indicator
- [x] **Coolant controls** — flood / mist toggle buttons
- [x] **Machine state indicators** — E-Stop, Power, Mode, Homed badges
- [x] **Guards** — all buttons gated by machine state (estop/reset/powered/homed)
  - [x] Jog + MDI disabled/hidden when program active, with tooltip explanation
  - [x] Status bar hint messages at each permission level
- [ ] **Keyboard shortcuts** — match QtDragon bindings

---

### Phase 3 — File management / G-code tab ✅ LARGELY COMPLETE

- [x] Drag-and-drop file upload (POST /upload)
- [x] Browse button → file picker
- [x] G-code line list with syntax colouring (motion / comment / tool call)
- [x] Active line highlighting + auto-scroll during program run
- [x] `program_open` sent to server on file load — Run button enables
- [x] Auto tab shows loaded filename (linked to gcode tab state)
- [ ] Directory browser (local filesystem / USB)
- [ ] Recent files dropdown
- [ ] G-code editor (CodeMirror 6) — read/edit/save
- [ ] File copy between locations

### Mock simulation (bridge.py) ✅ COMPLETE

- [x] Full program run/pause/resume/step/stop simulation
- [x] G-code parsed into waypoints on `program_open`; `pos.actual` tracks tool along path
- [x] Line counter advances at 3 lines/sec; `interp_state` and `mode` reflect running/paused/idle
- [x] G10 L20 touch-off correctly computes WCS offsets
- [x] WCS switching (G54–G59) via `set_work_coord`
- [x] Jog integration with axis velocity simulation
- [x] Note: real machine uses `stat()` at 20 Hz — pos.actual interpolates smoothly between waypoints automatically

---

### Phase 4 — Tool management tab

- [ ] Tool table display (number, diameter, length offset, comment)
- [ ] Edit tool entry inline
- [ ] Add / delete tool
- [ ] Load tool (M61)
- [ ] Touch off — tool length via touchplate or sensor
- [ ] Sensor height configuration

---

### Phase 5 — Offsets / WCS tab ✅ LARGELY COMPLETE

- [x] WCS selector buttons G54–G59 (active WCS highlighted)
- [x] Per-axis touch-off "Zero" button (G10 L20 — sets current position as zero)
- [x] "Zero All Axes" button (zeroes all axes in one G10 L20 command) — properly gated on homed
- [x] Mock bridge handles G10 L20 and set_work_coord correctly
- [x] Toolpath shifts in viewer when WCS origin changes
- [ ] G54–G59.3 offset table display (show all stored offsets)
- [ ] G92 offset display and clear button
- [ ] Rotation offset
- [ ] Sensor / laser / camera offset fields
- [ ] Go-to-sensor button

---

### Phase 6 — Status / log tab

- [ ] Machine log display (scrolling, auto-scroll)
- [ ] System/integrator log
- [ ] Toggle between log sources
- [ ] Clear log
- [ ] Save log to file

---

### Phase 7 — Settings tab

- [ ] Display preferences (alpha mode, mouse inhibit)
- [ ] Feature toggles (virtual keyboard, tool sensor, camera, eoffsets)
- [ ] Probe parameters (search vel, probe vel, max distance, retract, Z safe)
- [ ] Run-from-line toggle
- [ ] Reload program on startup toggle
- [ ] Theme selector (dark industrial / light / high contrast)

---

### Phase 8 — Probing tab

- [ ] Basic probe widget (centre find, edge find, corner find)
- [ ] Probe velocity / search velocity fields
- [ ] Probe result display
- [ ] Safe travel height
- [ ] Probe log

---

### Phase 9 — Macro buttons

- [ ] 10 configurable macro buttons
- [ ] Read MDI commands from INI `[MDI_COMMAND_LIST]`
- [ ] Enable only in manual/MDI mode

---

### Phase 10 — Polish and extras

- [ ] **Touch support** — all jog buttons work on touchscreen (touch events, no hover dependency)
- [ ] **Virtual keyboard** — on-screen number/text input for touch operation
- [ ] **Camera tab** — if webcam HAL component present
- [ ] **GCode reference tab** — searchable G/M code list
- [ ] **Setup/docs tab** — load HTML or PDF from config directory
- [ ] **Responsive breakpoints** — 800px panel / 1280px desktop / 1920px+ workstation
- [ ] **Reconnect UX** — clear "disconnected" overlay when server drops
- [ ] **Multi-screen** — same server, multiple browser clients (pendant + monitor)
- [ ] **INI launcher** — `linuxcnc_webui.py` auto-opens browser, integrates with `[DISPLAY]`

---

### Phase 11 — Multi-machine-type support

LinuxCNC's HAL is machine-agnostic — the same bridge works for mills, lathes, routers, plasma tables, etc.
The UI detects machine type from the INI/config at startup and adjusts rendering and layout accordingly.

**`machine_type` field** — add to the config bundle pushed at startup:

```json
{ "machine_type": "mill" }   // "mill" | "lathe" | "router" | "plasma" | "unknown"
```

Read from INI `[DISPLAY] MACHINE_TYPE` or `[TRAJ] COORDINATES` (XZ only → assume lathe if not overridden).

#### Lathe mode

- [ ] XZ-only toolpath view (viewer already has XZ plane — just lock it and hide YZ/3D presets)
- [ ] Diameter mode (G7) vs radius mode (G8) — DRO X shows diameter when G7 active
- [ ] DRO layout: X (diameter/radius), Z only — suppress Y
- [ ] Lathe-specific jog panel: X+/X–/Z+/Z– cardinal buttons, no Y
- [ ] Tool table: nose radius, orientation code (front/rear/boring), not just length/diameter
- [ ] Spindle display shows CSS (constant surface speed) when active (G96)
- [ ] Chuck/tailstock indicators (HAL pins) if configured

#### Mill / router mode (current default)

- [ ] No changes needed — mill is the baseline

#### Plasma / cutting mode (future)

- [ ] THC (torch height control) status from HAL
- [ ] Pierce delay / cut height fields
- [ ] No Z jog (THC owns Z)

#### Design rule
All machine-type branches live in the frontend only — the bridge and HAL layer are unchanged.
A `machine_type` check at render time switches layouts, hides/shows controls, and adjusts DRO formatting.

---

## State JSON Bundle (design)

What the server pushes every 50ms:

```json
{
  "pos": {
    "actual": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "commanded": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "g5x_offset": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "g92_offset": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "g5x_index": 1
  },
  "machine": {
    "estop": true,
    "enabled": false,
    "homed": [0, 0, 0, 0, 0, 0, 0, 0, 0],
    "mode": 1,
    "interp_state": 1,
    "motion_mode": 1,
    "motion_type": 0
  },
  "program": {
    "file": "",
    "line": 0,
    "total_lines": 0,
    "run_time": 0.0
  },
  "overrides": {
    "feed": 1.0,
    "rapid": 1.0,
    "spindle": [1.0]
  },
  "spindle": {
    "speed": [0.0],
    "direction": [0],
    "enabled": [false],
    "at_speed": [false],
    "override_enabled": [true]
  },
  "coolant": {
    "flood": false,
    "mist": false
  },
  "tool": {
    "number": 0,
    "offset": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    "diameter": 0.0
  },
  "limits": {
    "min_position_limit": [false, false, false],
    "max_position_limit": [false, false, false]
  },
  "errors": []
}
```

## Command Messages (browser → server)

```json
{ "cmd": "estop" }
{ "cmd": "estop_reset" }
{ "cmd": "machine_on" }
{ "cmd": "machine_off" }
{ "cmd": "home_all" }
{ "cmd": "home", "axis": 0 }
{ "cmd": "mdi", "gcode": "G0 X10 Y10" }
{ "cmd": "program_open", "path": "/home/user/file.ngc" }
{ "cmd": "program_run" }
{ "cmd": "program_run_from_line", "line": 42 }
{ "cmd": "program_pause" }
{ "cmd": "program_resume" }
{ "cmd": "program_step" }
{ "cmd": "program_stop" }
{ "cmd": "jog_start", "axis": 0, "velocity": 10.0 }
{ "cmd": "jog_stop", "axis": 0 }
{ "cmd": "jog_increment", "axis": 0, "distance": 0.1, "velocity": 10.0 }
{ "cmd": "feed_override", "value": 1.0 }
{ "cmd": "rapid_override", "value": 1.0 }
{ "cmd": "spindle_override", "spindle": 0, "value": 1.0 }
{ "cmd": "flood_on" }
{ "cmd": "flood_off" }
{ "cmd": "mist_on" }
{ "cmd": "mist_off" }
{ "cmd": "set_active_code", "code": "G54" }
```

---

## Design Principles for the Frontend

1. **Dark industrial theme by default** — high contrast, readable in workshop lighting
2. **Touch-first interaction** — all controls work with fat fingers, no hover-only states
3. **Density over decoration** — more information per pixel, less chrome
4. **CSS custom properties for everything** — swap a theme by changing 20 variables
5. **No fixed pixel sizes** — `rem`, `%`, `vw/vh`, `fr` units only
6. **Responsive at three breakpoints:**
   - `< 900px` — compact panel (7–10" touchscreen, single column)
   - `900px–1400px` — standard desktop (1280×768 laptop)
   - `> 1400px` — wide workstation (1920×1080+, side-by-side panels)
7. **Graceful degradation** — if WebSocket drops, show "DISCONNECTED" clearly and keep trying
8. **No external CDN calls** — all libraries vendored locally, works air-gapped

---

## Open Questions / Decisions

- [ ] Toolpath rendering: Three.js (3D) or a 2D canvas renderer for phase 1?
      *(2D canvas is much simpler to start, can upgrade to 3D later)*
- [ ] GCode parsing for toolpath: do it server-side (Python, send path coords) or client-side (JS parser)?
      *(Server-side is easier, re-uses LinuxCNC's own parser)*
- [ ] Frontend framework: vanilla JS phase 1, then evaluate Alpine.js vs Vue 3 for phase 2?
- [ ] HAL pins: expose a `/hal` WebSocket endpoint separately, or fold into the main state bundle?
- [ ] Should the server auto-open a browser window on launch, or just print the URL?
- [ ] Authentication: none (localhost only), or token for remote/tablet access?
- [ ] Where does this live: separate repo, or `src/emc/usr_intf/webui/` in the LinuxCNC tree?

---

## INI Integration (target)

```ini
[DISPLAY]
DISPLAY = linuxcnc_webui
PORT    = 8080          ; optional, default 8080
BROWSER = chromium      ; optional, auto-opens on launch
```

Or as a drop-in with no INI changes by wrapping:
```ini
DISPLAY = qtvcp webui
```

---

## Notes

- The realtime layer (motion, HAL, step generation) is completely untouched
- This is purely a UI replacement — same LinuxCNC underneath
- E-stop must remain hardwired through HAL regardless of UI
- The server process can run alongside an existing QtDragon session during development
- Start with the simulator config (`configs/sim/qtdragon/`) for all testing
