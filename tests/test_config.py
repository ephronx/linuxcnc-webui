"""
Tests for the config loader.

Run:
    cd webui && pytest tests/test_config.py -v
"""

import sys
from pathlib import Path
import textwrap
import tempfile
import os

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "server"))
import config as cfg_module


def _write_ini(content: str) -> str:
    """Write an INI string to a temp file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".ini", delete=False)
    f.write(textwrap.dedent(content))
    f.close()
    return f.name


class TestLoadDefaults:
    def test_returns_dict(self):
        result = cfg_module.load(None)
        assert isinstance(result, dict)

    def test_has_required_keys(self):
        result = cfg_module.load(None)
        for key in ["machine_name", "axes", "units", "jog_increments",
                    "max_velocity", "axis_limits", "max_spindle_speed"]:
            assert key in result, f"Missing key: {key}"

    def test_default_axes(self):
        result = cfg_module.load(None)
        assert isinstance(result["axes"], list)
        assert len(result["axes"]) >= 1

    def test_default_units(self):
        result = cfg_module.load(None)
        assert result["units"] in ("metric", "imperial")

    def test_jog_increments_are_numbers(self):
        result = cfg_module.load(None)
        for inc in result["jog_increments"]:
            assert isinstance(inc, (int, float))

    def test_max_velocity_is_dict(self):
        result = cfg_module.load(None)
        assert isinstance(result["max_velocity"], dict)
        assert "default" in result["max_velocity"]


class TestLoadFromIni:
    def test_machine_name_read(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = TestMill
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = mm
        """)
        try:
            result = cfg_module.load(ini)
            assert result["machine_name"] == "TestMill"
        finally:
            os.unlink(ini)

    def test_metric_units_mm(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Mill
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = mm
        """)
        try:
            assert cfg_module.load(ini)["units"] == "metric"
        finally:
            os.unlink(ini)

    def test_metric_units_word(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Mill
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = metric
        """)
        try:
            assert cfg_module.load(ini)["units"] == "metric"
        finally:
            os.unlink(ini)

    def test_imperial_units_inch(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Router
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = inch
        """)
        try:
            assert cfg_module.load(ini)["units"] == "imperial"
        finally:
            os.unlink(ini)

    def test_imperial_units_in(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Router
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = in
        """)
        try:
            assert cfg_module.load(ini)["units"] == "imperial"
        finally:
            os.unlink(ini)

    def test_xyz_axes_parsed(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Mill
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = mm
        """)
        try:
            result = cfg_module.load(ini)
            assert result["axes"] == ["X", "Y", "Z"]
        finally:
            os.unlink(ini)

    def test_xyza_axes_parsed(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Lathe
            [TRAJ]
            COORDINATES = X Y Z A
            LINEAR_UNITS = mm
        """)
        try:
            result = cfg_module.load(ini)
            assert result["axes"] == ["X", "Y", "Z", "A"]
        finally:
            os.unlink(ini)

    def test_max_velocity_has_default(self):
        ini = _write_ini("""
            [EMC]
            MACHINE = Mill
            [TRAJ]
            COORDINATES = X Y Z
            LINEAR_UNITS = mm
            MAX_LINEAR_VELOCITY = 100
        """)
        try:
            result = cfg_module.load(ini)
            assert result["max_velocity"]["default"] == 100.0
        finally:
            os.unlink(ini)

    def test_missing_ini_file_returns_defaults(self):
        result = cfg_module.load("/nonexistent/path/machine.ini")
        assert isinstance(result, dict)
        assert "machine_name" in result

    def test_malformed_ini_returns_defaults(self):
        ini = _write_ini("this is not valid ini content %%% ~~~")
        try:
            result = cfg_module.load(ini)
            assert isinstance(result, dict)
        finally:
            os.unlink(ini)
