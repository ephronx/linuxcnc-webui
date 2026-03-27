#!/usr/bin/env python3
"""
LinuxCNC Web UI — entry-point wrapper.

Usage:
    python linuxcnc_webui.py [--port 8080] [--ini /path/to/machine.ini] [--open-browser]

Can also be used as a LinuxCNC DISPLAY= target by wrapping it:
    DISPLAY = python /path/to/webui/linuxcnc_webui.py --open-browser
"""

import sys
from pathlib import Path

# Ensure server/ is on the path
sys.path.insert(0, str(Path(__file__).parent / "server"))

from main import main

if __name__ == "__main__":
    main()
