/**
 * guards.js — machine-state gating.
 *
 * On every state update, derives the current permission level and
 * enables/disables every interactive element accordingly.
 *
 * Permission levels (escalating):
 *   0  ESTOP      — only Reset E-Stop
 *   1  RESET      — can power on
 *   2  POWERED    — can home, overrides, coolant, abort
 *   3  HOMED      — full operation (jog, spindle, MDI, program)
 */

import { state, config, onUpdate } from "./state.js";

// LinuxCNC task_state constants
const STATE_ESTOP       = 1;
const STATE_ESTOP_RESET = 2;
const STATE_OFF         = 3;
const STATE_ON          = 4;

// LinuxCNC task_mode constants
const MODE_MANUAL = 1;
const MODE_AUTO   = 2;
const MODE_MDI    = 3;

// LinuxCNC interp_state constants
const INTERP_IDLE    = 1;
const INTERP_READING = 2;
const INTERP_PAUSED  = 3;

// Buttons that must never be gated — UI navigation and safety controls.
const NEVER_GATE = [
  ".tab-btn",          // tab switching
  ".viewer-plane-btn", // XY / XZ / YZ view selector
  ".coord-mode-btn",   // WCS / ABS display mode — read-only, never affects machine
  "#btn-estop",        // always reachable (safety)
  "#btn-prog-open",    // file selection is harmless
  "#btn-browse",       // file selection is harmless
  "#btn-viewer-fit",   // camera control
].join(", ");

// ---- Helpers ----

function _level(s) {
  const ts = s.machine?.task_state;
  if (ts === STATE_ESTOP)                        return 0;
  if (ts === STATE_ESTOP_RESET || ts === STATE_OFF) return 1;
  // Powered
  const axes     = config.axes?.length ?? 3;
  const homed    = s.machine?.homed ?? [];
  const allHomed = homed.slice(0, axes).every(v => v);
  return allHomed ? 3 : 2;
}

function _setEnabled(id, enabled, title = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = !enabled;
  if (title) el.title = enabled ? "" : title;
}

function _setAllEnabled(selector, enabled, title = "") {
  document.querySelectorAll(selector).forEach(el => {
    el.disabled = !enabled;
    if (title) el.title = enabled ? "" : title;
  });
}

// ---- E-stop button label ----

function _updateEstopBtn(s) {
  const btn = document.getElementById("btn-estop");
  if (!btn) return;
  const inEstop = s.machine?.task_state === STATE_ESTOP;
  btn.textContent = inEstop ? "↺ Reset E-Stop" : "⬡ E-STOP";
  btn.classList.toggle("btn-success", inEstop);
  btn.classList.toggle("btn-danger",  !inEstop);
}

function _reEnableNav() {
  // Split into individual selectors to avoid :not() list compatibility issues
  [".tab-btn", ".viewer-plane-btn", ".coord-mode-btn",
   "#btn-estop", "#btn-prog-open", "#btn-browse", "#btn-viewer-fit"].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.disabled = false; el.title = ""; });
  });
}

// ---- Main gate update ----

function _applyGates(s) {
  if (!s.connected) {
    _setAllEnabled("button", false, "Disconnected");
    _setAllEnabled("input[type=range]", false, "Disconnected");
    _reEnableNav();
    return;
  }

  const lv = _level(s);
  const isPowered = lv >= 2;
  const isHomed   = lv >= 3;
  const hasFile   = !!(s.program?.file);

  const mode         = s.machine?.mode ?? MODE_MANUAL;
  const interp       = s.machine?.interp_state ?? INTERP_IDLE;
  const isAutoMode   = mode === MODE_AUTO;
  const isProgActive = isAutoMode && (interp === INTERP_READING || interp === INTERP_PAUSED);

  // E-stop toggle — always available when connected
  _setEnabled("btn-estop", true);
  _updateEstopBtn(s);

  // Power controls
  _setEnabled("btn-machine-on",
    lv === 1,
    "Clear E-stop first");
  _setEnabled("btn-machine-off",
    isPowered,
    "Machine must be powered");

  // Homing
  _setEnabled("btn-home-all",
    isPowered,
    "Power on the machine first");
  _setEnabled("btn-unhome-all",
    isPowered && isHomed,
    "Machine must be powered and homed");

  // Override sliders
  ["feed-override", "rapid-override", "spindle-override"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !isPowered;
  });

  // Coolant — available when powered
  _setEnabled("btn-flood",  isPowered, "Power on the machine first");
  _setEnabled("btn-mist",   isPowered, "Power on the machine first");

  // Spindle — homed required (spindle itself doesn't need homing, but
  // convention is: don't run spindle until machine is ready to work)
  _setEnabled("btn-spindle-on",  isHomed, "Home the machine first");
  _setEnabled("btn-spindle-off", isPowered, "Machine must be powered");

  // Jog panel — hidden entirely in AUTO mode (matches QtDragon behaviour)
  const jogPanel = document.getElementById("jog-panel");
  if (jogPanel) jogPanel.style.display = isProgActive ? "none" : "";

  // Jog buttons — disabled until homed (panel is already hidden during AUTO)
  const canJog = isHomed && !isProgActive;
  const jogTitle = !isPowered ? "Power on the machine first"
                 : !isHomed   ? "Home all axes first"
                              : "";
  _setAllEnabled(".jog-btn",     canJog, jogTitle);
  _setAllEnabled(".jog-inc-btn", canJog, jogTitle);
  const jogVel = document.getElementById("jog-velocity");
  if (jogVel) jogVel.disabled = !canJog;

  // Dim the jog grid when homed checks fail (panel still visible, just not ready)
  const jogGrid = document.getElementById("jog-xy");
  if (jogGrid) jogGrid.style.opacity = canJog ? "1" : "0.35";

  // MDI — disabled in AUTO mode
  const canMdi = isHomed && !isAutoMode;
  const mdiInput = document.getElementById("mdi-input");
  if (mdiInput) {
    mdiInput.disabled = !canMdi;
    mdiInput.title    = canMdi ? "" : isAutoMode ? "MDI unavailable in Auto mode" : "Home the machine first";
  }
  _setEnabled("btn-mdi-send", canMdi, isAutoMode ? "MDI unavailable in Auto mode" : "Home the machine first");

  // Program controls
  _setEnabled("btn-prog-run",    isHomed && hasFile, isHomed ? "Load a program first" : "Home the machine first");
  _setEnabled("btn-prog-pause",  isPowered);
  _setEnabled("btn-prog-stop",   isPowered);
  _setEnabled("btn-prog-step",   isHomed && hasFile, isHomed ? "Load a program first" : "Home the machine first");
  _setEnabled("btn-prog-rewind", isHomed && hasFile, isHomed ? "Load a program first" : "Home the machine first");
  // btn-prog-open, btn-browse, tab-btn, viewer-plane-btn — handled by NEVER_GATE below

  // WCS buttons — available when powered (can select work coord without homing)
  _setAllEnabled(".wcs-btn", isPowered, "Power on the machine first");

  // Touch-off — only when homed (per-axis buttons inside panel + Zero All outside it)
  document.querySelectorAll("#touch-off-panel button").forEach(btn => {
    btn.disabled = !isHomed;
    btn.title    = isHomed ? "" : "Home the machine first";
  });
  _setEnabled("btn-zero-all", isHomed, "Home the machine first");

  // Navigation buttons are always enabled regardless of machine state
  _reEnableNav();
}

// ---- Status hint in status bar ----

function _statusHint(s) {
  if (!s.connected) return;
  const lv = _level(s);
  const bar = document.getElementById("status-bar");
  if (!bar) return;

  const mode   = s.machine?.mode ?? MODE_MANUAL;
  const interp = s.machine?.interp_state ?? INTERP_IDLE;

  if (lv === 0) {
    bar.textContent = "E-Stop active — press Reset E-Stop to continue";
    bar.className = "critical";
  } else if (lv === 1) {
    bar.textContent = "Machine reset — press Power On to enable";
    bar.className = "warn";
  } else if (lv === 2) {
    bar.textContent = "Machine powered — home all axes to enable full control";
    bar.className = "warn";
  } else if (mode === MODE_AUTO && interp === INTERP_PAUSED) {
    bar.textContent = "Program paused — jogging and MDI disabled. Resume or Stop to continue.";
    bar.className = "warn";
  }
  // lv === 3, mode MANUAL or program running: let dro.js manage the status bar content
}

// ---- Register ----

onUpdate((s) => {
  _applyGates(s);
  _statusHint(s);
});

// Apply gates immediately on load with the default disconnected state
// so nothing is clickable before the first server frame arrives.
_applyGates(state);
