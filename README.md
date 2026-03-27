# LinuxCNC Web UI

A modern browser-based front-end for [LinuxCNC](https://linuxcnc.org) — runs alongside the LinuxCNC process and exposes a full machine control interface over HTTP/WebSocket.

![screenshot placeholder](docs/screenshot.png)

## Features

- **Full machine control** — E-stop, power on/off, home axes, MDI, feed/spindle/rapid overrides
- **G-code viewer** — Drag-and-drop upload, syntax highlighting, active-line tracking with auto-scroll and progress bar
- **Toolpath visualisation** — Live 2D/3D orthographic viewer with executed/pending segment colouring, amber motion trail, and real-time tool position
- **Digital Read-Out (DRO)** — Machine and work-coordinate display for all axes, one-click zero buttons
- **Jog panel** — Keyboard-style XYZ jog buttons with configurable step sizes
- **Auto / Manual / MDI tabs** — Context-aware UI that hides irrelevant controls (e.g. jog panel hidden during program execution)
- **Mock mode** — Full machine simulation with G-code waypoint tracking; no LinuxCNC installation required for development

## Architecture

```
Browser (HTML/CSS/ES-modules)
        │  WebSocket + REST
        ▼
FastAPI server  (server/main.py)
        │
        ├─ bridge.py  ──── linuxcnc.stat() / linuxcnc.command()
        │                  (falls back to mock simulation when linuxcnc is unavailable)
        └─ /upload, /file  static file serving and G-code upload
```

The bridge polls `linuxcnc.stat()` at 20 Hz and pushes a JSON state snapshot to all connected WebSocket clients. Commands from the browser (`program_open`, `jog`, `mdi`, etc.) are dispatched back to `linuxcnc.command()`.

## Quick Start

### Without LinuxCNC (mock mode — any platform)

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python linuxcnc_webui.py
```

Open [http://localhost:8000](http://localhost:8000).

The server starts in **mock mode** automatically when the `linuxcnc` Python module is not installed. You can upload any `.ngc` / `.gcode` file and watch the simulated tool trace the toolpath.

### With a real LinuxCNC machine

Run on the LinuxCNC host (Ubuntu/Debian with LinuxCNC installed):

```bash
pip install fastapi "uvicorn[standard]" python-multipart
python linuxcnc_webui.py
```

Connect from any device on the same network: `http://<machine-ip>:8000`

### Docker

```bash
docker compose up
```

Uses the included `docker/Dockerfile` with a LinuxCNC simulation config.

## Project Structure

```
linuxcnc-webui/
├── frontend/
│   ├── index.html          # Single-page app shell
│   ├── css/
│   │   ├── base.css        # Variables, reset, typography
│   │   ├── components.css  # Buttons, DRO, sliders, viewer
│   │   └── layout.css      # Panel grid, tab layout
│   └── js/
│       ├── ws.js           # WebSocket connection + reconnect
│       ├── state.js        # Central state store + subscriber bus
│       ├── main.js         # Machine control (estop, power, home)
│       ├── dro.js          # DRO display, zero buttons, WCS selector
│       ├── jog.js          # Jog controls + keyboard shortcuts
│       ├── gcode.js        # G-code panel, upload, active-line tracking
│       ├── viewer.js       # 2D/3D toolpath renderer (Canvas API)
│       ├── guards.js       # Button enable/disable state machine
│       ├── overrides.js    # Feed/spindle/rapid override sliders
│       └── tabs.js         # Tab switching
├── server/
│   ├── main.py             # FastAPI app, WebSocket hub, file endpoints
│   ├── bridge.py           # LinuxCNC bridge + mock simulation
│   └── config.py           # Upload directory, port configuration
├── tests/                  # pytest suite
├── docker/                 # Dockerfile + LinuxCNC sim config
├── docker-compose.yml
├── requirements.txt
└── linuxcnc_webui.py       # Entry point
```

## Development

```bash
pip install -r requirements.txt
pytest                      # run tests
python linuxcnc_webui.py    # start server with hot-reload
```

The frontend is plain ES modules — no build step required. Edit files and refresh the browser.

## Configuration

Environment variables (or edit `server/config.py`):

| Variable | Default | Description |
|---|---|---|
| `WEBUI_PORT` | `8000` | HTTP/WS listen port |
| `WEBUI_HOST` | `0.0.0.0` | Bind address |
| `UPLOAD_DIR` | `nc_files/` | Directory for uploaded G-code files |

## Keyboard Shortcuts (jog panel)

| Key | Action |
|---|---|
| Arrow keys | X/Y jog |
| Page Up / Page Down | Z+ / Z− |
| `[` / `]` | Cycle step size down/up |

## Status

Early development — functional for simulation and basic machine control. Tested against LinuxCNC 2.9 on Ubuntu 22.04.

## License

GPL-2.0 — same as LinuxCNC. See [LICENSE](LICENSE).
