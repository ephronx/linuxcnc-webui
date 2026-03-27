# CNC HMI Design Research

> Research compiled 2026-03-27 — standards, competitor analysis, operator feedback

---

## Standards

### ISA-101 (ANSI/ISA-101.01-2015) — High Performance HMI

The primary standard for industrial HMI design. Core thesis: cluttered, colourful screens cause operators to miss critical events.

**Display hierarchy (4 levels)**
- Level 1: Overview of operator's entire realm (machine status at a glance)
- Level 2: Overview of one unit/major task (current job running)
- Level 3: Task detail including major control modules
- Level 4: Specific device or parameter detail (drill-down)

**Colour rules — colour is rationed, not decorative**

| Colour | Meaning |
|--------|---------|
| Grey (background ~#DDDDDD) | Normal operating state — background, static elements |
| Dark grey / black | Static text, labels, borders |
| Bright Yellow | Warning / deviation — not normal but acceptable |
| Bright Red | Critical alarm — flashes until acknowledged, then steady |
| Blue | Diagnostic / informational (lowest priority) |
| Dark blue / dark green | Live data values (DRO numbers) |

**Critical rule**: Never use red for any normal operating state. If red appears anywhere, the operator's eye is immediately drawn to it. Spindle running = green, NOT red.

**Alarm rules (ISA-18.2)**
- Alarms must be prioritised (P1 = critical, P2 = high, P3 = medium, P4 = advisory)
- Flashing: colour flashes until acknowledged, then remains steady
- Never rely on colour alone — pair with symbol or text (colour-blind operators)
- Text labels should not flash; borders or surrounding objects flash instead
- Alarm flooding (too many alarms) trains operators to ignore them

### ISO 9241 — Ergonomics of Human-System Interaction

- ISO 9241-11: Usability (effectiveness, efficiency, satisfaction)
- ISO 9241-210: Human-centred design process (understand users and context first)
- ISO 9241-420: Selection of physical input devices (includes touch screens)

### Touch Target Sizes

| Context | Minimum Size |
|---------|-------------|
| Standard interactive controls | 15 mm x 15 mm (~56px at 96dpi) |
| Safety-critical functions (E-stop, Feed Hold, Cycle Start) | 25 mm x 25 mm minimum |
| Inter-target spacing | 3 mm minimum |
| WCAG 2.1 AA (enhanced) | 44 x 44 CSS px |

**Gloves**: Nitrile/latex gloves cannot actuate capacitive touch. For gloved operation: 20mm+ targets and resistive touch technology. Physical buttons remain mandatory for safety-critical actions.

### Contrast Ratios

| Standard | Requirement |
|----------|-------------|
| WCAG 2.1 AA body text | 4.5:1 minimum |
| WCAG 2.1 AA large text (24px+ or bold 18.5px+) | 3:1 minimum |
| ISA-101 grey background (#DDDDDD) + black text | ~14:1 — well above requirements |

### Workshop Display Requirements
- Anti-glare (matte) coating mandatory
- 500-1000 nit brightness for shop floor under overhead lighting
- Grey background (~#C8C8C8 to #E0E0E0) outperforms black in bright shops — black washes out under overhead fluorescent lighting
- Pure white causes glare and eye fatigue
- Audio alerts are unreliable in shops — visual alarm indication must be self-sufficient

---

## Commercial CNC UI Analysis

### Fanuc (Series 0i, 30i, 31i)

5 function keys switch between screen areas: POS (DRO), PROG (program), OFS/SET (offsets), SYSTEM (params), GRAPH.

**DRO "ALL" screen** — three columns: Absolute (WCS), Relative, Machine — X/Y/Z stacked. Active tool, active WCS, modal G-codes in header. Feed override %, spindle speed (commanded), feedrate all persistent.

**Problems operators report**:
- "Operator dance" — to change a tool offset while running: go to OFS, find tool, edit, return to PROG, return to POS. Screen navigation destroys task context
- Softkey menu trees require memorisation — no breadcrumbs, no "home" button
- No undo. "You can't tell what the offset was before you changed it"
- Editor is widely disliked: no undo, cryptic navigation

### Siemens Sinumerik (840D, 828D) — "Sinumerik Operate"

**Persistent header (always visible ~50px strip)**:
- Current operating area + mode
- Active tool (T:), spindle speed (S:), feedrate (F:), spindle utilisation %
- Alarm line — always visible, shows current alarm code and text

This persistent header is Sinumerik's most praised design element — operators always know machine state regardless of which screen they are on.

**Two-axis softkey system**:
- Horizontal softkeys (8+2): context-sensitive, navigate within area
- Vertical softkeys (8): navigate between operating areas
- Area switchover key: shows all areas on horizontal + modes on vertical — "home" from anywhere
- Recall key: previous screen (breadcrumb navigation)

**6 operating areas**: Machine, Parameters, Program, Program Manager, Diagnosis, Startup

**Praised for**: Persistent header, copy/paste in editor, simplified "Smart Operate" variant for non-CNC operators.

### Heidenhain (TNC 640, TNC 7)

Defining feature: "Klartext" conversational programming (not G-code) — operator answers dialogue questions, control selects tools/speeds/feeds.

**Split-screen key**: Left pane = NC listing, Right pane = graphical simulation / position DRO. Graphic updates as program is written during conversational programming.

**TNC 7 innovations**:
- 1920x1080 minimum
- Gesture touchscreen (smartphone-like, "zero reaction delay")
- Dark mode option
- Graphical 6D workpiece setup with guided probing and 3D visualisation
- Graphical programming — draw contours on touchscreen; TNC7 converts to Klartext
- Physical keyboard retained alongside touch (physical keys remain superior for eyes-free operation)
- Backward compatible with all old NC programs

Most progressive commercial CNC UI — aggressively adopting mobile UX patterns while retaining physical keyboard.

### Mitsubishi M800 Series

- Touchscreen standard — pinch, flick, scroll like smartphone
- Icon-based navigation (not text softkeys)
- Split-window layout on large models (19"): show keyboard, operation panel, document viewer or custom apps side by side
- On-screen soft keyboard repositionable by operator (different operators, different heights)
- Customisable screen layout per job/process
- Centralised tool management (life, geometry, remaining cuts)

### Mazak (Mazatrol)

- Conversational programming since 1981 (world's first)
- Operator answers prompts: material, shape type, dimensions, tolerances — control selects tools/speeds/feeds/toolpaths automatically
- Modern Mazatrol (SmoothX): 15" touchscreen, 3D CAD import, drag-to-customise layout, AI-assisted feeds/speeds
- Conversational and G-code can be mixed in same program
- **Major criticism**: Mazatrol programs are proprietary — cannot run on any other control brand

---

## Open-Source / Community UIs

### PathPilot (Tormach) — strongest open-source HMI design

**Split horizontal layout**:
- **Top half (tabbed)**: Main (G-code listing + 3D toolpath), File, Offsets, Conversational, Probe, Settings, Status
- **Bottom half (persistent, never scrolls away)**: DRO (X/Y/Z large font, WCS, tool number) + Program Control (Cycle Start, Feed Hold, Stop, overrides) + Manual Control (spindle, coolant)

**The persistent bottom-half is the key design insight** — operators can be on any tab and always see position, program state, and overrides. Matches ISA-101 Level 1/2 hierarchy.

**Operator praise**: Feed hold responsiveness, clean layout, conversational modes, soft limits alerts.

**Operator requests**: MDI text entry cumbersome; no quick macro button tab; no single-button WCS cycling; offset table lacks protection against misentry.

### Probe Basic (LinuxCNC QtPyVCP)

Distinct mill and lathe builds. 1920x1080 required minimum.

Sections: File management, ATC management, Tool table, Work offsets, Probing (extensive — edge, bore centre, corner, angle, calibration), Conversational CAM, Settings, Status.

Praised as "a monster in disguise with all the features" — closest open-source equivalent to commercial CNC UI. Deep probing integration is standout feature vs QtDragon.

### Axis (default LinuxCNC)

Extremely stable (runs months 24/7), OpenGL toolpath preview. Dated visually, poor touch support. Recommended as baseline for hardware verification.

### Gmoccapy (LinuxCNC)

GTK-based, designed for touchscreen. Better touch ergonomics than Axis. Dedicated lathe support (radius/diameter toggle). Less active development.

### CNC12 (Centroid)

Virtual Control Panel (VCP) replicates physical machine panel on touchscreen. Keyboard jogging built in. Familiar to commercial CNC operators. More PLC-panel-simulation than modern adaptive UI.

---

## Key Design Principles (Synthesised)

### Information Hierarchy

**Tier 1 — Always visible (persistent, never navigated away from)**
- X/Y/Z DRO (absolute WCS coordinates)
- Machine mode/state (RUNNING, FEED HOLD, E-STOP, ALARM, IDLE)
- Active alarm count and first alarm text
- Active WCS identifier (G54 etc.)
- Active tool number (T:) and spindle speed actual (RPM)
- Feed override % and spindle override %

**Tier 2 — One click away (current task context)**
- G-code listing with current line highlighted
- Toolpath backplot
- Remaining program distance/time estimate
- Active modal G-codes (G17/18/19, G90/91, G94/95)

**Tier 3 — Tabbed / navigation required**
- Tool offset table
- Work offset table
- MDI command history
- Probing routines
- Conversational programming

**Tier 4 — Settings / admin (access-controlled or rarely accessed)**
- Machine parameters, HAL configuration, software updates

### DRO Conventions

- Axis order: Mill = X, Y, Z; Lathe = X (diameter), Z
- Display modes must be instantly switchable: Absolute (WCS), Machine (MCS), Relative/DTG
- DRO digits must be the largest text on screen — 24-36pt equivalent
- Sign always shown (+ or -)
- 4 decimal places metric (0.0001mm), 4 imperial (0.0001")
- Units clearly labelled
- Active axis highlighted during jog

### Machine State Indication

Must be readable from 1.5 metres in 0.5 seconds:

| State | Visual | Colour |
|-------|--------|--------|
| E-Stop Active | Large persistent banner, all motion controls disabled | Red background |
| Alarm / Fault | Alarm text in header, alarm list accessible | Red |
| Running | Clear "RUNNING" indicator | Green |
| Feed Hold | "FEED HOLD" indicator, motion frozen | Yellow |
| MDI Ready | "MDI" indicator, MDI input active | White/neutral |
| Jog / Manual | "JOG" indicator | White/neutral |
| Idle / Ready | "READY" or "IDLE" | Green (dim) or white |
| Limit Hit | Specific axis indicated | Red |

### Colour Coding (CNC-Specific)

| Element | Colour |
|---------|--------|
| E-Stop hardware button | Red mushroom |
| Cycle Start hardware button | Green |
| Feed Hold hardware button | Yellow |
| Running / normal state | Green |
| Stopped / E-stop | Red |
| Warning / caution | Yellow/Amber |
| Spindle indicator (running) | Green — NEVER red |
| Alarm text | Red, high contrast, prominent |
| Active axis (during jog) | Blue or brighter highlight |
| Current program line | Contrasting background highlight |

### Jog Controls

- Step increments: 0.001, 0.010, 0.100, 1.000 mm (or 0.0001, 0.001, 0.010, 0.100 inch)
- Continuous jog: slow (~5% rapid) and fast (100%) modes
- Physical rotary knobs preferred over software sliders for overrides — tactile position sense, no accidental jumps from 5% to 100%
- Software jog must require continuous hold (release = stop)
- Feed Hold and E-stop must be reachable without releasing jog button (separate hardware)

### Naming Conventions (follow Fanuc/Haas vocabulary operators know)
- G54 not "WCS 1"
- T01 not "Slot 1"
- MDI not "Manual Command"
- Absolute not "Machine Origin"

---

## What Operators Actually Complain About

### 1. Too Much Navigation for Routine Tasks
"On a Fanuc, you have to flip around from MDI to call tools, to the offset page, and back while fighting door interlocks."

**Fix**: Contextual adjacent actions. Measuring tool 3? Show the offset entry for tool 3 right there with measure button adjacent.

### 2. Editor is Unusable
"You can't undo. There is no undo. You just destroyed your offset and you'll find out at spindle height."

**Fix**: Undo/redo everywhere — offsets, work offsets, MDI history, program edits. Log previous value when offset is changed. Confirmation dialog for large changes (">5mm change — confirm?").

### 3. Softkey Menus Hide Functions
"Ease with which you can accidentally dismiss a menu screen and struggle to navigate back."

**Fix**: Navigation must be visible and persistent — tabs, breadcrumbs, or always-visible nav sidebar. There must always be an obvious "home" or "back".

### 4. Software Sliders vs. Physical Knobs for Overrides
"On a rotary, I can't accidentally go from 10% to 100% by mistake."

**Fix**: Override adjustment should map to physical hardware (USB encoder). Web UI reflects physical state rather than replacing it.

### 5. No Undo on Offsets / No Change Log
"You can't tell what the offset was before you changed it."

**Fix**: Change history per offset (last 5 values, timestamp). Large-change warning.

### 6. 3D Graphics Consuming Primary Screen Space
Many experienced operators never look at the 3D view during production — they run from program listing + position DRO.

**Fix**: 3D backplot should be a tab or optional panel. Split-pane control (Heidenhain model) lets operator decide.

### 7. Information Not Persistent Enough
"Would be nice to have live offset display on the main screen rather than navigating to the offset page."
"I want to see distance-to-go alongside current position."
"Show me the actual spindle RPM, not just the commanded value."

**Fix**: Persistent Tier 1 panel. Actual RPM vs commanded RPM both displayed.

---

## Implications for Our Design

### Strengths we already have
- Dark industrial theme (workshop-appropriate for dim/controlled lighting)
- Tab-based navigation (visible tabs, not softkey trees)
- Machine state badges (E-Stop, Power, Mode, Homed)
- WCS selector (G54-G59 visible)
- Jog controls gated by machine state
- Hold-to-jog (continuous hold = motion, release = stop) — correct per standards
- Progress bar for program completion
- Status bar hint messages at each permission level

### Gaps to address

**High priority**
- [ ] **Persistent DRO panel** — currently navigable away from; should be always visible regardless of tab (PathPilot model). Consider splitting layout so DRO + key controls never scroll away.
- [ ] **Actual vs commanded spindle RPM** — show both; commanded is what operator sets, actual confirms spindle is up to speed
- [ ] **Distance-to-go (DTG)** — show on DRO alongside absolute and machine positions
- [ ] **Modal G-codes display** — G17/18/19, G90/91, G94/95, G40/41/42 currently active; operators need to see these
- [ ] **Offset change log** — previous value + timestamp when tool or work offset is changed; large-change confirmation dialog (>5mm)
- [ ] **Alarm priority display** — distinguish P1 (critical) from P4 (advisory); flashing until acknowledged then steady

**Medium priority**
- [ ] **Reserve red exclusively for faults/alarms** — audit current UI for any red used in normal operating states
- [ ] **Theme option for bright shop environments** — current dark theme may wash out under overhead fluorescent lighting; grey-industrial theme per ISA-101 as alternative
- [ ] **Undo on offset entry** — currently no undo when editing tool or work offsets
- [ ] **Probe tab** — Probe Basic's deep probing integration is consistently cited as a major differentiator; edge find, bore centre, corner find at minimum

**Lower priority / later phases**
- [ ] **Conversational CAM** — valued for one-off work; Mazak/PathPilot demonstrate the pattern
- [ ] **Macro buttons tab** — quick-access MDI sequences without loading into main program; one of the most common PathPilot feature requests
- [ ] **Physical encoder/MPG integration** — web UI should consume USB HID encoder events for feed/spindle override adjustment
- [ ] **Configurable dashboard** — let operator pin specific data items to the persistent panel
