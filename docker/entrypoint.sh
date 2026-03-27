#!/bin/bash
# ============================================================
# Docker entrypoint — starts LinuxCNC sim then the web UI.
# ============================================================
set -e

SIM_DIR=/root/linuxcnc/configs/webui-sim
NC_DIR=/root/linuxcnc/nc_files
WEBUI_DIR=/opt/webui
PORT=${WEBUI_PORT:-8090}

# ---- Ensure runtime directories exist ----
mkdir -p "$SIM_DIR" "$NC_DIR"

# Copy sim config if not already present (allows volume-mounting custom configs)
if [ ! -f "$SIM_DIR/webui-sim.ini" ]; then
    cp /opt/sim/* "$SIM_DIR/"
    touch "$SIM_DIR/webui-sim.var"
fi

# ---- Start virtual framebuffer for headless X11 ----
Xvfb :1 -screen 0 1024x768x24 -ac &
XVFB_PID=$!
export DISPLAY=:1
sleep 1

# ---- Start LinuxCNC simulator ----
echo "Starting LinuxCNC simulator..."
linuxcnc "$SIM_DIR/webui-sim.ini" &
LCNC_PID=$!

# Wait until LinuxCNC NML is ready (linuxcnc.stat() succeeds)
echo "Waiting for LinuxCNC to be ready..."
for i in $(seq 1 30); do
    if python3 -c "import linuxcnc; s=linuxcnc.stat(); s.poll(); print('LinuxCNC ready')" 2>/dev/null; then
        break
    fi
    sleep 1
done

# ---- Start web UI ----
echo "Starting web UI on port $PORT..."
cd "$WEBUI_DIR"
exec python3 linuxcnc_webui.py \
    --host 0.0.0.0 \
    --port "$PORT" \
    --ini "$SIM_DIR/webui-sim.ini"
