# ============================================================
# LinuxCNC Web UI — Docker image
#
# Runs LinuxCNC uspace simulator + the FastAPI web UI in one
# container. No real hardware required.
#
# Build:
#   docker compose build
#
# Run:
#   docker compose up
# ============================================================

FROM debian:bookworm-slim

# ---- Base system ----
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    xvfb \
    x11-utils \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# ---- LinuxCNC APT repository ----
RUN curl -fsSL https://deb.linuxcnc.org/linuxcnc-arch.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/linuxcnc-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/linuxcnc-archive-keyring.gpg] \
    http://deb.linuxcnc.org/ bookworm base 2.9-uspace" \
    > /etc/apt/sources.list.d/linuxcnc.list

# ---- LinuxCNC uspace + axis GUI ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    linuxcnc-uspace \
    linuxcnc-uspace-dev \
    python3-linuxcnc \
    && rm -rf /var/lib/apt/lists/*

# ---- Python web UI dependencies ----
COPY ../requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
    -r /tmp/requirements.txt

# ---- Copy web UI source ----
COPY .. /opt/webui/
RUN rm -rf /opt/webui/docker /opt/webui/tests /opt/webui/.pytest_cache

# ---- Copy sim config ----
COPY sim/ /opt/sim/

# ---- Runtime directories ----
RUN mkdir -p /root/linuxcnc/nc_files /root/linuxcnc/configs/webui-sim

# ---- Entrypoint ----
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8090

ENTRYPOINT ["/entrypoint.sh"]
