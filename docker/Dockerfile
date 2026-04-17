# ============================================================
# LinuxCNC Web UI — dev image (mock mode only)
#
# Runs the FastAPI server in mock mode. No LinuxCNC install.
# Real LinuxCNC needs an RT kernel + HAL + kernel modules, which
# cannot run inside a container — validate against a real machine
# on the LinuxCNC host.
#
# Build + run via docker-compose.yml at the repo root:
#   docker compose up --build
# ============================================================

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY linuxcnc_webui.py ./
COPY server/ ./server/
COPY frontend/ ./frontend/

RUN mkdir -p /app/nc_files

EXPOSE 8090

CMD ["python", "linuxcnc_webui.py", "--host", "0.0.0.0", "--port", "8090"]
