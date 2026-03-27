"""
Read machine configuration from the LinuxCNC INI file.
Provides the frontend with axis count, units, limits, and machine name.

Uses linuxcnc.ini() when available (real machine), falls back to
Python's configparser so config can be read in dev/test without LinuxCNC.
"""

import configparser
import os

try:
    import linuxcnc
    HAS_LINUXCNC = True
except ImportError:
    HAS_LINUXCNC = False


def _parse_units(raw: str) -> str:
    """Normalise LinuxCNC unit strings to 'metric' or 'imperial'."""
    r = raw.strip().lower()
    if r in ("mm", "metric", "1", "1.0"):
        return "metric"
    if r in ("inch", "in", "imperial", "25.4"):
        return "imperial"
    return "metric"   # safe default


def _make_getter(ini_path: str):
    """
    Return a (get, has_ini) tuple.

    get(section, key, default=None) reads from the INI file.
    Uses linuxcnc.ini() when available, otherwise configparser.
    """
    # Try linuxcnc.ini() first
    if HAS_LINUXCNC and ini_path and os.path.exists(ini_path):
        try:
            lc_ini = linuxcnc.ini(ini_path)
            def get_lc(section, key, default=None):
                val = lc_ini.find(section, key)
                return val if val is not None else default
            return get_lc, True
        except Exception:
            pass

    # Fall back to configparser (works in dev/test without linuxcnc)
    if ini_path and os.path.exists(ini_path):
        try:
            cp = configparser.RawConfigParser()
            cp.read(ini_path)
            def get_cp(section, key, default=None):
                try:
                    return cp.get(section, key)
                except (configparser.NoSectionError, configparser.NoOptionError):
                    return default
            return get_cp, True
        except Exception:
            pass

    # No INI available
    def get_none(section, key, default=None):
        return default
    return get_none, False


def load(ini_path: str = None) -> dict:
    """
    Extract the machine config the frontend needs on startup.
    Falls back to sensible defaults when running without a real INI file.
    """
    # Allow override via environment (LinuxCNC sets INI_FILE_NAME)
    path = ini_path or os.environ.get("INI_FILE_NAME") or None
    get, has_ini = _make_getter(path)

    # Axis letters
    coord_str = get("TRAJ", "COORDINATES", "X Y Z").upper()
    axes = coord_str.split()

    machine_name = get("EMC", "MACHINE", "LinuxCNC")
    units = _parse_units(get("TRAJ", "LINEAR_UNITS", "mm"))
    angular_units = get("TRAJ", "ANGULAR_UNITS", "degree")
    max_linear_vel = float(get("TRAJ", "MAX_LINEAR_VELOCITY", 50))
    max_angular_vel = float(get("TRAJ", "MAX_ANGULAR_VELOCITY", 360))

    # Per-axis limits
    axis_limits = {}
    for letter in ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]:
        section = f"AXIS_{letter}"
        min_lim = get(section, "MIN_LIMIT")
        max_lim = get(section, "MAX_LIMIT")
        if min_lim is not None and max_lim is not None:
            axis_limits[letter] = {"min": float(min_lim), "max": float(max_lim)}

    max_spindle_speed = float(get("SPINDLE_0", "MAX_FORWARD_VELOCITY",
                               get("DISPLAY", "MAX_SPINDLE_OVERRIDE", 2000)))
    max_feed_override = float(get("DISPLAY", "MAX_FEED_OVERRIDE", 2.0))

    increments_str = get("DISPLAY", "INCREMENTS", "1 0.1 0.01 0.001")
    jog_increments = []
    for tok in increments_str.split():
        tok = tok.strip()
        if not tok:
            continue
        # Strip trailing unit suffixes (mm, inch, deg, …)
        num = tok.rstrip("abcdefghijklmnopqrstuvwxyz ").rstrip()
        try:
            jog_increments.append(float(num))
        except ValueError:
            pass

    # max_velocity dict — used by jog.js for per-axis velocity scaling
    max_velocity = {"default": max_linear_vel}
    for letter in axes:
        max_velocity[letter] = max_linear_vel

    return {
        "machine_name": machine_name,
        "axes": axes,
        "units": units,
        "angular_units": angular_units,
        "max_velocity": max_velocity,
        "max_linear_velocity": max_linear_vel,
        "max_angular_velocity": max_angular_vel,
        "axis_limits": axis_limits,
        "max_spindle_speed": max_spindle_speed,
        "max_feed_override": max_feed_override,
        "jog_increments": jog_increments,
    }
