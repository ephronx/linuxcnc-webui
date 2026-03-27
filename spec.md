# LinuxCNC Specification Document

> Reverse-engineered from source — version 2.10.0~pre1
> License: LGPL v3 (most), GPL v2 (some components)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Build System](#3-build-system)
4. [Subsystems](#4-subsystems)
   - 4.1 [RTAPI — Real-Time API Abstraction](#41-rtapi--real-time-api-abstraction)
   - 4.2 [HAL — Hardware Abstraction Layer](#42-hal--hardware-abstraction-layer)
   - 4.3 [NML — Neutral Message Language](#43-nml--neutral-message-language)
   - 4.4 [Motion Controller](#44-motion-controller)
   - 4.5 [Trajectory Planner](#45-trajectory-planner)
   - 4.6 [G-code Interpreter (RS274NGC)](#46-g-code-interpreter-rs274ngc)
   - 4.7 [Task Controller](#47-task-controller)
   - 4.8 [Kinematics](#48-kinematics)
   - 4.9 [Tool Management](#49-tool-management)
   - 4.10 [I/O Controller](#410-io-controller)
5. [Hardware Drivers](#5-hardware-drivers)
6. [HAL Components Library](#6-hal-components-library)
7. [User Interfaces](#7-user-interfaces)
8. [Key Data Structures](#8-key-data-structures)
9. [Real-Time vs Non-Real-Time Boundary](#9-real-time-vs-non-real-time-boundary)
10. [Configuration System](#10-configuration-system)
11. [Directory Reference](#11-directory-reference)
12. [Language & File Statistics](#12-language--file-statistics)
13. [Contribution Areas](#13-contribution-areas)

---

## 1. Project Overview

LinuxCNC is an open-source CNC (Computer Numerical Control) machine controller for Linux. It provides:

- Hard real-time motion control with cycle times of ~1ms or better
- A flexible hardware abstraction layer (HAL) for connecting to physical hardware
- A G-code interpreter compliant with the NIST RS274NGC standard
- Multiple GUI front-ends (Tk, Qt, GTK, touchscreen)
- Support for mills, lathes, 3D printers, plasma cutters, robot arms, hexapods, and more
- 60+ hardware interface drivers (parallel port, PCI cards, Mesa FPGA boards, GPIO platforms, USB)

**Version:** 2.10.0~pre1
**Primary language:** C/C++ (realtime), Python (GUI/scripting), Tcl/Tk (legacy GUI)
**Realtime options:** RTAI (kernel module), Xenomai, POSIX userspace (uspace)

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                  User Space (Non-RT)                  │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌───────┐  ┌─────────┐  │
│  │  AXIS   │  │  QtVCP   │  │Gmocca │  │ emcrsh  │  │
│  │(Tk/Py)  │  │  (Qt5)   │  │  py   │  │(remote) │  │
│  └────┬────┘  └────┬─────┘  └───┬───┘  └────┬────┘  │
│       └────────────┴────────────┴────────────┘       │
│                         │                             │
│              ┌──────────▼──────────┐                  │
│              │   NML / IPC Layer   │  (libnml)        │
│              └──────────┬──────────┘                  │
│                         │                             │
│  ┌──────────────────────▼──────────────────────────┐  │
│  │              Task Controller (emctaskmain)       │  │
│  │   G-code Interpreter (rs274ngc) ◄── INI / tool  │  │
│  └──────────────────────┬──────────────────────────┘  │
└─────────────────────────┼────────────────────────────┘
                          │  NML commands
┌─────────────────────────▼────────────────────────────┐
│                 Real-Time Domain                       │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │           Motion Controller (motion.c)        │    │
│  │   Trajectory Planner (tp/) ─► Kinematics      │    │
│  │   Homing, Axis/Joint control, Feed override   │    │
│  └─────────────────┬────────────────────────────┘    │
│                    │  HAL signals                     │
│  ┌─────────────────▼────────────────────────────┐    │
│  │           HAL (Hardware Abstraction Layer)     │    │
│  │  Logic ─ Math ─ PID ─ Encoder ─ StepGen ─ PWM│    │
│  └─────────────────┬────────────────────────────┘    │
│                    │                                  │
│  ┌─────────────────▼────────────────────────────┐    │
│  │              Hardware Drivers                  │    │
│  │  Mesa FPGA │ Parallel Port │ GPIO │ PCI cards  │    │
│  └──────────────────────────────────────────────┘    │
│                  RTAPI abstraction                     │
│         (RTAI / Xenomai / POSIX uspace)               │
└───────────────────────────────────────────────────────┘
```

### Signal Flow: G-code to Motor

```
G-code file
    │
    ▼
RS274NGC Interpreter   (src/emc/rs274ngc/)
    │  canonical commands (LINE_TO, ARC_FEED, etc.)
    ▼
Task Controller        (src/emc/task/)
    │  NML motion commands
    ▼
Motion Controller      (src/emc/motion/)  ← realtime thread
    │  trajectory segments
    ▼
Trajectory Planner     (src/emc/tp/)      ← realtime
    │  per-joint position commands
    ▼
Kinematics             (src/emc/kinematics/)
    │  HAL pin writes (position-cmd)
    ▼
HAL Components         (stepgen / encoder / PID)
    │  hardware signals
    ▼
Hardware Driver        (Mesa / parport / GPIO)
    │
    ▼
Physical Hardware (stepper/servo motors)
```

---

## 3. Build System

### Primary: Autotools + Make

```
src/configure.ac     — Autoconf script
src/Makefile         — Non-recursive makefile
src/Makefile.inc.in  — Build variable template
```

**Configure detects:**
- Realtime subsystem: RTAI, Xenomai, or uspace (POSIX)
- Compiler: GCC, Clang, or RTSCC
- Dependencies: Boost, libtirpc, libudev, Python dev headers, pkg-config
- C++ standard: C++20

### Secondary: Meson (unit tests only)

```
meson.build          — Root-level, covers tp/ and interp/ unit tests
unit_tests/          — Meson-based unit test suite
```

### Build Modes

| Mode | Description |
|------|-------------|
| Run-in-place | `./configure --enable-run-in-place` — run directly from source tree |
| System install | Standard `make && make install` to `/usr/` |
| Simulator | `--with-realtime=uspace` — no hardware required |

### Key Build Targets

```bash
cd src && ./configure [options]
make
make install          # or use run-in-place
make modules          # build kernel modules (RTAI only)
```

---

## 4. Subsystems

### 4.1 RTAPI — Real-Time API Abstraction

**Location:** `src/rtapi/`
**Purpose:** Abstracts the underlying realtime OS so the rest of LinuxCNC is portable across RTAI, Xenomai, and POSIX userspace.

**Key files:**

| File | Description |
|------|-------------|
| `rtapi.h` | Public API (42KB) — tasks, timers, shared memory, mutex |
| `rtapi_common.h` | Common types and constants |
| `rtapi_math.h` | Math function wrappers |
| `rtapi_mutex.h` | Mutex/semaphore primitives |
| `rtapi_atomic.h` | Atomic operations |
| `rtapi_pci.h` | PCI device abstraction |
| `rtapi_parport.h` | Parallel port abstraction |
| `rtai_rtapi.c` | RTAI kernel-module implementation (52KB) |
| `rtai_ulapi.c` | RTAI user-space companion (27KB) |
| `uspace_rtapi_app.cc` | POSIX uspace implementation (41KB) |

**API surface:**

```c
// Task management
int  rtapi_app_main(void);
void rtapi_app_exit(void);
int  rtapi_task_new(void (*taskcode)(void*), void *arg, int prio, int module_id, unsigned long stacksize, int uses_fp, char *name, int cpu_id);
int  rtapi_task_start(int task_id, unsigned long period_nsec);
void rtapi_task_wait(void);

// Shared memory
int  rtapi_shmem_new(int key, int module_id, unsigned long size);
int  rtapi_shmem_getptr(int shmem_id, void **ptr);

// Timing
long long rtapi_get_time(void);
long long rtapi_get_clocks(void);
```

---

### 4.2 HAL — Hardware Abstraction Layer

**Location:** `src/hal/`
**Purpose:** A shared-memory signal routing bus. Components export named pins; pins are connected via signals in HAL configuration files (`.hal`).

**Core files:**

| File | Size | Description |
|------|------|-------------|
| `hal_lib.c` | 4,469 lines | Core library: pin/signal/param management, shared memory |
| `hal.h` | 45KB | Public API and type definitions |
| `hal_priv.h` | 22KB | Internal structures (not for external use) |
| `halmodule.cc` | 68KB | Python bindings |

**Pin Data Types:**

| Type | C type | Description |
|------|--------|-------------|
| `HAL_BIT` | `hal_bit_t` | Boolean (0 or 1) |
| `HAL_FLOAT` | `hal_float_t` | 64-bit floating point |
| `HAL_S32` | `hal_s32_t` | 32-bit signed integer |
| `HAL_U32` | `hal_u32_t` | 32-bit unsigned integer |
| `HAL_PORT` | `hal_port_t` | FIFO byte stream |

**Pin Directions:** `HAL_IN`, `HAL_OUT`, `HAL_IO`

**Component Lifecycle:**

```c
int  hal_init(const char *name);         // register component
int  hal_pin_bit_new(const char *name, hal_bit_t **data_ptr_addr, int dir, int comp_id);
int  hal_pin_float_new(...);             // similar for each type
int  hal_param_float_new(...);           // parameters (non-connectable)
int  hal_ready(int comp_id);            // mark component ready
void hal_exit(int comp_id);             // unregister
```

**HAL files (`.hal`)** are scripts executed by `halcmd` that:
1. Load components (`loadrt`, `loadusr`)
2. Connect pins to signals (`net signal-name comp.pin`)
3. Set parameters (`setp comp.param value`)
4. Add functions to threads (`addf comp.funct thread`)

**Realtime threads** — defined in INI, executed by RTAPI:
- `servo-thread` — typically 1ms period, runs motion + PID + driver reads/writes
- `base-thread` — optional 25–50µs, for software step generation

---

### 4.3 NML — Neutral Message Language

**Location:** `src/libnml/`
**Purpose:** Middleware for passing typed messages between processes (GUI ↔ Task ↔ Motion). Provides buffering, serialization, and transport independence (shared memory, TCP, UDP).

**Key subdirectories:**

| Dir | Description |
|-----|-------------|
| `nml/` | Core NML library (message types, queuing) |
| `cms/` | Communication Media Selection (transports) |
| `buffer/` | Ring buffer implementations |
| `posemath/` | 3D position and rotation mathematics |
| `rcs/` | Reference Model Servo framework |
| `os_intf/` | OS abstraction layer |
| `inifile/` | INI parser |
| `linklist/` | Linked list utilities |

**EMC NML message hierarchy** (`src/emc/nml_intf/emc.hh`, 59KB):

```
EMC_CMD_MSG           — base command type
  EMC_JOINT_*         — per-joint commands (home, jog, enable)
  EMC_AXIS_*          — per-axis commands
  EMC_TRAJ_*          — trajectory commands (linear, circular, pause)
  EMC_MOTION_*        — motion mode commands
  EMC_SPINDLE_*       — spindle commands
  EMC_COOLANT_*       — coolant control
  EMC_TOOL_*          — tool change, offset
  EMC_TASK_*          — task-level commands (open file, run, abort)
  EMC_LUBE_*          — lubrication

EMC_STAT_MSG          — base status type
  EMC_JOINT_STAT      — joint position, homed, fault state
  EMC_AXIS_STAT       — axis limits, position
  EMC_TRAJ_STAT       — trajectory queue state, current velocity
  EMC_MOTION_STAT     — all motion status
  EMC_TASK_STAT       — interpreter state, active file/line
  EMC_IO_STAT         — tool, spindle, coolant status
```

---

### 4.4 Motion Controller

**Location:** `src/emc/motion/`
**Purpose:** Hard realtime control loop. Reads commands from NML queue, drives the trajectory planner, reads encoder feedback, closes position loops, writes position/velocity commands to HAL.

**Key files:**

| File | Description |
|------|-------------|
| `motion.c` | Main realtime thread entry point |
| `command.c` | Processes NML commands from task controller |
| `control.c` | Per-cycle control: position loop, velocity, acceleration limiting |
| `homing.c` | Homing state machine for all joint types |
| `axis.c` | Per-axis (Cartesian) controllers |
| `emcmotcfg.h` | Compile-time constants: `EMC_JOINT_MAX=16`, `EMC_AXIS_MAX=9` |
| `motion.h` | `EMCMOT_STRUCT` — the central realtime shared memory structure |

**Realtime shared memory structure `EMCMOT_STRUCT`** contains:
- Per-joint: position cmd/fb, velocity, limits, homing state, enables
- Per-axis: position, min/max limits
- Trajectory: current velocity, acceleration, scale factors
- Status flags: enabled, homed, fault, estop

**Motion modes:**
- Free mode — manual jogging, individual joints
- Teleop mode — coordinated Cartesian motion
- Coord mode — trajectory following (G-code execution)

**Homing sequences** (defined per-joint in INI):
- Search for home switch
- Latch on switch edge
- Move to home offset
- Zero encoder/position

---

### 4.5 Trajectory Planner

**Location:** `src/emc/tp/`
**Purpose:** Converts a queue of motion segments (lines, arcs) into smooth, blended motion that respects velocity, acceleration, and jerk limits.

**Key files:**

| File | Description |
|------|-------------|
| `tc.c` | Trajectory code — per-segment state machine |
| `tcq.c` | Trajectory queue management |
| `tp.c` | Planner main logic |
| `blendmath.c` | Curve-to-curve blending algorithms |
| `spherical_arc.c` | 3D arc interpolation |
| `ruckig_wrapper.cc` | Integration with Ruckig (jerk-limited profiles) |
| `sp_scurve.c` | S-curve velocity profiles |

**Blend types:**
- Tangential blending (G64 — path tolerance)
- Exact stop (G61)
- Parabolic blending for acceleration-limited transitions

---

### 4.6 G-code Interpreter (RS274NGC)

**Location:** `src/emc/rs274ngc/`
**Purpose:** Parses and executes G-code programs per the NIST RS274NGC specification. Generates canonical commands sent to the task controller.

**Key files:**

| File | Size | Description |
|------|------|-------------|
| `interp_convert.cc` | 250KB | Core G/M-code to canonical command conversion |
| `interp_cycles.cc` | — | Canned cycles: drilling, boring, tapping, pocketing |
| `interp_arc.cc` | — | Arc (G2/G3) computation |
| `interp_g7x.cc` | — | G7x lathe cycles |
| `interp_base.hh` | — | Interpreter state machine base class |
| `gcodemodule.cc` | — | Python bindings for G-code parser |
| `canonmodule.cc` | — | Python bindings for canonical functions |

**Interpreter state includes:**
- Current position (6 axes: X Y Z A B C)
- Active modal groups (motion, plane, units, feed mode, etc.)
- Tool number and offset
- Coordinate system (G54–G59.3)
- Feed rate, spindle speed
- Subroutine call stack
- O-word named parameters

**Canonical function interface** (`canon.hh`, 42KB) — the abstraction between interpreter and motion:
```c
STRAIGHT_TRAVERSE(x, y, z, a, b, c, u, v, w)
STRAIGHT_FEED(...)
ARC_FEED(end_x, end_y, center_x, center_y, turn, end_z, ...)
SPINDLE_RETRACT()
TOOL_CHANGE(slot)
SET_FEED_RATE(rate)
// ... ~100 canonical functions
```

---

### 4.7 Task Controller

**Location:** `src/emc/task/`
**Purpose:** Sequences G-code interpretation and sends motion commands to the motion controller. Acts as the bridge between user interface (via NML) and the realtime motion system.

**Key files:**

| File | Size | Description |
|------|------|-------------|
| `emctaskmain.cc` | — | Main task loop |
| `emccanon.cc` | 140KB | Canonical command implementation (calls motion NML) |
| `emctask.cc` | — | Task state machine |
| `taskintf.cc` | — | Interface to motion controller |
| `taskclass.cc` | — | Task class definition |

**Task states:** `IDLE → WAITING_FOR_MOTION_QUEUE → WAITING_FOR_MOTION → DONE`

---

### 4.8 Kinematics

**Location:** `src/emc/kinematics/`
**Purpose:** Transforms between Cartesian tool-tip coordinates (X Y Z A B C) and joint positions (J0–J8). Every machine type needs a kinematics module.

**Interface** (`kinematics.h`):
```c
int kinematicsForward(const double *joint, EmcPose *world, ...);  // joints → Cartesian
int kinematicsInverse(const EmcPose *world, double *joint, ...);  // Cartesian → joints
KINEMATICS_TYPE kinematicsType();                                  // IDENTITY, BOTH, etc.
```

**Available kinematics modules:**

| Module | Machine type |
|--------|-------------|
| `trivkins` | Standard XYZ (identity, most machines) |
| `genhexkins` | General hexapod/Stewart platform |
| `5axiskins` | Generic 5-axis mill |
| `genserfuncs` | Serial robot arm (6-DOF) |
| `lineardeltakins` | Linear delta (3D printer) |
| `corexykins` | CoreXY (3D printer / laser) |
| `pumakins` | PUMA-style robot |
| `scarakins` | SCARA robot |
| `xyzbc-trt-kins` | Table-rotary/tilting 5-axis |

---

### 4.9 Tool Management

**Location:** `src/emc/tooldata/`
**Purpose:** Maintains the tool table (diameter, length offsets, wear compensation) and tool change coordination.

**Key files:**

| File | Description |
|------|-------------|
| `tooldata_common.cc` | Core tool data structures |
| `tooldata_mmap.cc` | Memory-mapped tool database |
| `tooldata_nml.cc` | NML-based tool interface |
| `tool_watch.cc` | File-based tool database watcher |

**Tool data per entry:**
- Tool number, pocket number
- X/Y/Z offsets, diameter
- Front/back angles (lathe)
- Orientation
- Comment

---

### 4.10 I/O Controller

**Location:** `src/emc/iocontrol/`
**Purpose:** Manages non-motion I/O: tool changes, spindle, coolant, lube. Runs as a separate process communicating via NML/HAL.

---

## 5. Hardware Drivers

**Location:** `src/hal/drivers/`

### Mesa Electronics FPGA (Primary/Featured)

The most capable and widely-used hardware interface. Mesa boards implement motion control functions in FPGA firmware, offloading step generation, encoder counting, and PWM to dedicated hardware.

**Driver files:**

| File | Description |
|------|-------------|
| `mesa-hostmot2/hm2_eth.c` | Ethernet-connected Mesa boards (54KB) |
| `mesa-hostmot2/hm2_pci.c` | PCI/PCIe Mesa boards (27KB) |
| `mesa-hostmot2/hm2_spi.c` | SPI-connected Mesa boards (10KB) |
| `mesa-hostmot2/hm2_7i43.c` | 7i43 EPP board |
| `mesa-hostmot2/hm2_7i90.c` | 7i90 EPP board |
| `mesa-hostmot2/encoder.c` | Quadrature encoder module |
| `mesa-hostmot2/stepgen.c` | Step/direction generator module |
| `mesa-hostmot2/pwmgen.c` | PWM generator module |
| `mesa-hostmot2/sserial.c` | Smart Serial interface (110KB) |

**Supported FPGA modules (hostmot2 firmware):**
- Encoder (quadrature, index, velocity estimation)
- StepGen (step/direction or quadrature output)
- PWMGen (PWM/PDM/direction)
- ResolverMod (resolver feedback)
- SSI (synchronous serial encoder)
- BSPI / SPI interfaces
- GPIO with programmable direction
- Smart Serial (sserial) for daughter cards

### Other Hardware Drivers

| Driver | Interface | Description |
|--------|-----------|-------------|
| `hal_parport.c` | Parallel port | Classic 8-bit/17-pin interface |
| `hal_stg.c` | PCI | Servo-to-Go servo boards |
| `hal_motenc.c` | PCI | Motenc-100/Lite encoder/DAC boards |
| `hal_vti.c` | PCI | Vigilant Technologies interface |
| `hal_gm.c` | PCI | General Mechatronics controller |
| `hal_bb_gpio.c` | BeagleBone | GPIO (via mmap) |
| `hal_pi_gpio.c` | Raspberry Pi | GPIO (via mmap) |
| `pluto_servo.comp` | USB | Pluto-P FPGA servo interface |
| `pluto_step.comp` | USB | Pluto-P FPGA step interface |
| `hal_pci_8255.c` | PCI | 8255 PPI chip on PCI cards |
| `hal_speaker.c` | ISA/PC | PC speaker (beep on estop) |
| `hal_tiro.c` | PCI | TIRO motion controller |

---

## 6. HAL Components Library

**Location:** `src/hal/components/` (128 `.comp` files)

HAL components are realtime building blocks. Each exports input/output pins and a function called periodically by a thread. They are written in a `.comp` DSL that generates C code.

### Logic

| Component | Function |
|-----------|----------|
| `and2` | 2-input AND gate |
| `or2` | 2-input OR gate |
| `xor2` | 2-input XOR gate |
| `not` | Logical invert |
| `mux2/4/8` | Multiplexers |
| `demux` | Demultiplexer |
| `flipflop` | D flip-flop |
| `oneshot` | Monostable pulse generator |
| `edge` | Rising/falling edge detector |

### Math & Signal Processing

| Component | Function |
|-----------|----------|
| `abs` | Absolute value |
| `add2`, `sum2` | Addition |
| `mult2`, `div2` | Multiply/divide |
| `scale` | Linear scale + offset |
| `limit1/2/3` | Clamp with velocity/accel limits |
| `ddt` | Derivative (differentiation) |
| `integrator` | Integration |
| `lowpass` | Low-pass filter |
| `biquad` | Biquadratic filter (configurable) |
| `deadzone` | Dead-band filter |

### Motion & Control

| Component | Function |
|-----------|----------|
| `pid` | PID controller (proportional/integral/derivative) |
| `encoder` | Quadrature encoder decoder |
| `counter` | Pulse counter |
| `stepgen` | Software step generator (base-thread) |
| `pwmgen` | Software PWM generator |
| `charge_pump` | Safety charge pump signal |
| `estop_latch` | E-stop with latch |
| `joyhandle` | Joystick-to-velocity mapping |
| `anglejog` | Angular axis jogging |

### Motor Control

| Component | Function |
|-----------|----------|
| `bldc` | Brushless DC motor commutation |
| `modmath` | 3-phase modular mathematics |
| `clarke2/3` | Clarke transform (3-phase to 2-phase) |
| `clarkeinv` | Inverse Clarke transform |
| `park` | Park transform (rotating reference frame) |
| `parkinv` | Inverse Park transform |
| `svpwm` | Space vector PWM |

### Utility

| Component | Function |
|-----------|----------|
| `carousel` | Rotary tool changer sequencer |
| `eoffset` | External axis offset |
| `gearchange` | Spindle gear range selector |
| `time` | Timer (seconds) |
| `toggle` | Toggle bit on rising edge |
| `wcomp` | Window comparator |
| `watchdog` | HAL watchdog timer |

---

## 7. User Interfaces

### 7.1 Axis (Classic — Tk/Python)

**Location:** `src/emc/usr_intf/axis/`
**Technology:** Python + Tcl/Tk + OpenGL
**Status:** Mature, widely used

Features:
- 3D toolpath preview (Gremlin, OpenGL)
- Manual MDI input
- Jogging with configurable increments
- Tool table editor
- Backplot with error detection

### 7.2 QtVCP (Modern — Qt5/Python)

**Location:** `src/emc/usr_intf/qtvcp/`
**Technology:** Python 3, Qt5, Qt Designer
**Status:** Active development, recommended for new installations

Features:
- Virtual Control Panel concept — build custom panels in Qt Designer
- Pluggable widget library (`lib/python/qtvcp/widgets/`)
- Multiple built-in screens (qtdefault, qtaxis, qtplasmac)
- HAL pin integration from Python
- Handler files for custom logic

### 7.3 Gmoccapy (Touchscreen — Qt)

**Location:** `src/emc/usr_intf/gmoccapy/`
**Technology:** Python, GTK/Qt
**Target:** Touchscreen panels, industrial pendants

### 7.4 Touchy

**Location:** `src/emc/usr_intf/touchy/`
**Technology:** Python, GTK
**Target:** Minimal touchscreen, keypad-driven

### 7.5 Gscreen

**Location:** `src/emc/usr_intf/gscreen/`
**Technology:** Python, GTK
**Target:** Configurable GTK-based screen

### 7.6 Remote Interface (emcrsh)

**Location:** `src/emc/usr_intf/emcrsh.cc` (117KB)
**Purpose:** TCP/IP remote shell — control LinuxCNC over a network connection.
**Protocol:** Text-based command/response

### 7.7 HAL UI Daemon (halui)

**Location:** `src/emc/usr_intf/halui.cc` (101KB)
**Purpose:** Exposes machine state and control to HAL pins, enabling physical panel buttons/indicators without custom software.

**Example pins:**
```
halui.machine.on              (HAL_BIT, IN) — turn machine on
halui.machine.is-on           (HAL_BIT, OUT) — machine is on
halui.program.run             (HAL_BIT, IN) — start program
halui.axis.0.pos-relative     (HAL_FLOAT, OUT) — X position
halui.spindle.0.override-value (HAL_FLOAT, OUT) — spindle override %
```

### 7.8 Utility GUIs

| Tool | Description |
|------|-------------|
| `halshow` | Browse and monitor HAL pins/signals/parameters |
| `halmeter` | Real-time numeric/graphical pin monitor |
| `halscope` | Oscilloscope for HAL signals |
| `stepconf` | Stepper motor configuration wizard |
| `pncconf` | Mesa/parallel port configuration wizard |
| ClassicLadder | IEC 61131-3 ladder logic PLC editor |

### 7.9 Core UI Libraries

| File | Description |
|------|-------------|
| `lib/python/pyvcp_widgets.py` (66KB) | PyVCP widget set for custom panels |
| `lib/python/vismach.py` (34KB) | 3D virtual machine simulation |
| `lib/python/gremlin_view.py` (19KB) | G-code toolpath 3D visualization |
| `lib/python/linuxcnc.py` | Python bindings to NML (status/command/error) |
| `lib/python/hal.py` | Python HAL bindings |

---

## 8. Key Data Structures

### HAL Shared Memory Layout (`hal_priv.h`)

```c
typedef struct {
    hal_pin_t     *pin_list_ptr;      // linked list of all pins
    hal_signal_t  *sig_list_ptr;      // linked list of all signals
    hal_param_t   *param_list_ptr;    // linked list of all parameters
    hal_comp_t    *comp_list_ptr;     // linked list of all components
    hal_thread_t  *thread_list_ptr;   // linked list of threads
    hal_funct_t   *funct_list_ptr;    // linked list of functions
    // ... mutex, shmem allocator state, etc.
} hal_shared_data_t;

typedef struct hal_pin_t {
    int next_ptr;           // offset of next pin in list
    int data_ptr_addr;      // offset of pointer to pin data
    int owner_ptr;          // offset of owning component
    hal_type_t type;        // HAL_BIT, HAL_FLOAT, etc.
    hal_pin_dir_t dir;      // HAL_IN, HAL_OUT, HAL_IO
    int signal;             // offset of connected signal (or 0)
    hal_data_u dummysig;    // unconnected pin reads from here
    char name[HAL_NAME_LEN+1];
} hal_pin_t;
```

### Motion Shared Memory (`motion.h`)

```c
typedef struct emcmot_status_t {
    // per-joint
    emcmot_joint_t joint[EMCMOT_MAX_JOINTS];
    // per-axis
    emcmot_axis_t  axis[EMCMOT_MAX_AXIS];
    // trajectory
    EmcPose        carte_pos_cmd;   // commanded Cartesian position
    EmcPose        carte_pos_fb;    // actual Cartesian position
    double         current_vel;
    double         requested_vel;
    // flags
    int            motion_flag;
    int            homing_flag;
    // ...
} emcmot_status_t;
```

### Pose Structure (`emcpose.h`)

```c
typedef struct EmcPose {
    PmCartesian tran;    // X, Y, Z
    double a, b, c;      // rotation axes
    double u, v, w;      // auxiliary axes (9-axis machines)
} EmcPose;
```

---

## 9. Real-Time vs Non-Real-Time Boundary

### Real-Time Domain (RTAPI threads)

| Component | Thread | Typical Period |
|-----------|--------|----------------|
| Hardware drivers | servo-thread | 1ms |
| HAL components (PID, encoder) | servo-thread | 1ms |
| Motion controller | servo-thread | 1ms |
| Software stepgen | base-thread | 25–50µs |
| Software PWM | base-thread | 25–50µs |

### Non-Real-Time Domain

| Component | Update Rate | Notes |
|-----------|-------------|-------|
| Task controller | ~100Hz | Soft realtime, high priority |
| G-code interpreter | On demand | Runs in task process |
| halui | ~100Hz | Polls HAL and NML |
| GUIs | ~10–100Hz | User display, not timing-critical |
| emcrsh | On demand | Network driven |

### IPC Mechanisms

| Mechanism | Usage |
|-----------|-------|
| HAL shared memory | RT ↔ RT and RT ↔ non-RT signal passing |
| NML buffers | Non-RT command/status (task ↔ GUI ↔ motion) |
| RTAPI shared memory | RT module data exchange |
| POSIX mmap | Tool database |

---

## 10. Configuration System

### INI File Structure

Every machine configuration has a master `.ini` file. Key sections:

```ini
[EMC]
VERSION = 1.1
MACHINE = My CNC Mill

[DISPLAY]
DISPLAY = axis           # which GUI to launch
POSITION_OFFSET = RELATIVE

[FILTER]                 # G-code file preprocessors

[RS274NGC]
PARAMETER_FILE = my_machine.var
SUBROUTINE_PATH = ~/linuxcnc/macros

[EMCMOT]
EMCMOT = motmod
COMM_TIMEOUT = 1.0
SERVO_PERIOD = 1000000   # nanoseconds (1ms)

[TASK]
TASK = milltask
CYCLE_TIME = 0.010

[HAL]
HALFILE = my_machine.hal  # HAL script(s) to execute
POSTGUI_HALFILE = panel.hal

[TRAJ]
COORDINATES = X Y Z
MAX_LINEAR_VELOCITY = 50
MAX_LINEAR_ACCELERATION = 500

[JOINT_0]                # one section per joint
TYPE = LINEAR
HOME = 0.0
MAX_VELOCITY = 50
MAX_ACCELERATION = 500
STEPGEN_MAXVEL = 60
SCALE = 1600             # steps/mm or counts/unit
HOME_SEARCH_VEL = 10
HOME_LATCH_VEL = 1
HOME_SEQUENCE = 0

[AXIS_X]                 # one section per Cartesian axis
MIN_LIMIT = -300
MAX_LIMIT = 0

[SPINDLE_0]
MAX_FORWARD_VELOCITY = 24000

[TOOL_TABLE]
TOOL_TABLE = my_machine.tbl
```

### HAL Script Example

```hal
# Load realtime components
loadrt [KINS]KINEMATICS
loadrt motmod
loadrt hostmot2
loadrt hm2_pci config="firmware=hm2/5i25/svst2_4.bit"
loadrt pid names=x-pid,y-pid,z-pid

# Add functions to threads
addf hm2_5i25.0.read          servo-thread
addf motion-command-handler   servo-thread
addf motion-controller        servo-thread
addf x-pid.do-pid-calcs       servo-thread
addf hm2_5i25.0.write         servo-thread

# Connect signals
net x-pos-cmd  <= joint.0.motor-pos-cmd
net x-pos-cmd  => x-pid.command
net x-pos-fb   <= hm2_5i25.0.encoder.00.position
net x-pos-fb   => joint.0.motor-pos-fb
net x-pos-fb   => x-pid.feedback
net x-output   <= x-pid.output
net x-output   => hm2_5i25.0.dac.00.value

# Parameters
setp x-pid.Pgain 1000
setp x-pid.Igain 0
setp x-pid.Dgain 0
```

---

## 11. Directory Reference

```
linuxcnc/
├── bin/                        Installed executable wrapper scripts
├── configs/                    Example machine configurations
│   ├── sim/                    Simulator configs (no hardware required)
│   ├── by_machine/             Configs organized by machine type
│   └── by_interface/           Configs organized by hardware interface
├── debian/                     Debian packaging
├── docs/                       Documentation
│   ├── src/                    AsciiDoc source
│   ├── man/                    Man pages
│   └── html/                   Generated HTML
├── lib/
│   ├── python/                 Python libraries (pyvcp, vismach, gremlin, qtvcp)
│   └── tcl/                    Tcl libraries
├── nc_files/                   Sample G-code files and macros
├── rtlib/                      Compiled realtime modules (.so/.ko)
├── scripts/                    Startup and utility scripts
├── share/                      Shared data (icons, .glade, .ui files)
│   └── qtvcp/                  Qt screen definitions and panels
├── src/
│   ├── emc/                    EMC — CNC control engine
│   │   ├── motion/             Realtime motion controller
│   │   ├── tp/                 Trajectory planner
│   │   ├── rs274ngc/           G-code interpreter
│   │   ├── task/               Task controller
│   │   ├── nml_intf/           NML message definitions
│   │   ├── ini/                INI file processing
│   │   ├── kinematics/         Kinematics modules
│   │   ├── tooldata/           Tool table management
│   │   ├── iocontrol/          I/O control process
│   │   ├── usr_intf/           User interfaces
│   │   │   ├── axis/           Classic Tk GUI
│   │   │   ├── qtvcp/          Qt VCP framework
│   │   │   ├── gmoccapy/       Touchscreen GUI
│   │   │   ├── touchy/         Minimal touchscreen GUI
│   │   │   ├── gscreen/        GTK screen
│   │   │   ├── stepconf/       Stepper config wizard
│   │   │   └── pncconf/        Mesa/parport config wizard
│   │   └── pythonplugin/       Python plugin system
│   ├── hal/
│   │   ├── hal_lib.c           HAL core library
│   │   ├── components/         Realtime component library (128 .comp)
│   │   ├── drivers/            Hardware interface drivers
│   │   │   └── mesa-hostmot2/  Mesa FPGA driver subsystem
│   │   ├── user_comps/         User-space components
│   │   └── utils/              halcmd, halshow, halmeter, classicladder
│   ├── libnml/                 NML middleware library
│   ├── rtapi/                  RTAPI realtime abstraction
│   ├── po/                     Translations (gettext)
│   └── configs/                Build-time configuration templates
├── tcl/                        Tcl/Tk scripts and libraries
├── tests/                      Integration test suite
└── unit_tests/                 Unit tests (Meson)
```

---

## 12. Language & File Statistics

| Language | Files | Primary Role |
|----------|-------|-------------|
| C | ~222 | Realtime kernel modules, HAL core, RTAPI, drivers |
| C++ | ~124 | Task controller, G-code interpreter, NML, user interfaces |
| Header (.h/.hh) | ~243 | API definitions, data structures, message types |
| HAL Components (.comp) | 128 | Realtime logic/math/control blocks |
| Python (.py) | ~253 | GUIs, utilities, HAL scripting, test harness |
| Tcl/Tk (.tcl) | ~21 | Legacy GUI (Axis), config utilities |
| AsciiDoc | Many | Documentation source |

---

## 13. Contribution Areas

Based on the architecture, here are natural areas for contribution, from most accessible to most specialized:

### Documentation & Testing
- Improve or translate AsciiDoc documentation (`docs/src/`)
- Add integration tests (`tests/`)
- Write unit tests (`unit_tests/`) — uses Meson, tests `tp/` and `rs274ngc/`
- Improve inline code comments

### Python / GUI (Lower barrier)
- **QtVCP** (`src/emc/usr_intf/qtvcp/`) — Qt5/Python, active development
  - New widgets, screens, panel designs
  - Qt Designer integration improvements
- **PyVCP** (`lib/python/pyvcp_widgets.py`) — panel widget improvements
- **Gremlin** (`lib/python/gremlin_view.py`) — 3D toolpath visualizer
- **Configuration wizards** (`stepconf/`, `pncconf/`) — usability improvements
- **Utility scripts** — halshow, halmeter improvements

### HAL Components (Medium)
- New `.comp` files in `src/hal/components/`
- `.comp` DSL is well-documented; generates C
- Examples: new filter types, signal processing, motor control blocks

### Hardware Drivers (Medium-High)
- New drivers for emerging hardware in `src/hal/drivers/`
- Mesa hostmot2 extensions for new daughter cards
- GPIO platform support (new SBCs)

### Kinematics (High — math required)
- New kinematics modules in `src/emc/kinematics/`
- Implement `kinematicsForward()` / `kinematicsInverse()` interface
- Robot arm configurations, specialty machine types

### G-code Interpreter (High)
- RS274NGC extensions in `src/emc/rs274ngc/`
- New canned cycles (`interp_cycles.cc`)
- G-code dialect compatibility

### Motion / Trajectory Planner (Very High)
- Trajectory planning improvements in `src/emc/tp/`
- Ruckig integration (`ruckig_wrapper.cc`)
- Look-ahead improvements, S-curve profiles

### Build / Infrastructure
- Meson build system migration (currently only unit tests use Meson)
- CI/CD improvements
- Packaging (Debian, RPM, AppImage)

### Getting Started

```bash
# Clone and build in simulator mode (no hardware needed)
git clone https://github.com/LinuxCNC/linuxcnc
cd linuxcnc/src
./autogen.sh
./configure --with-realtime=uspace --enable-run-in-place
make -j$(nproc)
source ../scripts/rip-environment
linuxcnc                    # opens configuration picker
linuxcnc configs/sim/axis/axis.ini   # launch Axis simulator
```

**Key resources:**
- Developer documentation: `docs/src/code/`
- HAL component tutorial: `docs/src/hal/comp.adoc`
- Coding style: `src/CodingStyle`
- Mailing list and forum: linuxcnc.org
- Issue tracker: github.com/LinuxCNC/linuxcnc/issues
