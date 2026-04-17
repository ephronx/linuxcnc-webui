/**
 * dro.js — Digital Read-Out panel and header status badges.
 *
 * Builds DRO rows from config.axes, then updates on every state frame.
 * Also updates: connection indicator, status badges, tool info, status bar.
 */

import { state, config, onUpdate, onConfig } from "./state.js";
import { send } from "./ws.js";

// ---- Constants ----

// LinuxCNC task modes
const MODE_MANUAL = 1, MODE_AUTO = 2, MODE_MDI = 3;

// LinuxCNC task states
const STATE_ESTOP = 1, STATE_ESTOP_RESET = 2, STATE_OFF = 3, STATE_ON = 4;

// g5x_index → G5x label (1=G54, 2=G55 … 9=G59.3)
const WCS_LABEL = ["?", "G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"];

// ---- DOM refs ----

const connLed          = document.getElementById("conn-led");
const connText         = document.getElementById("conn-text");
const connIndicator    = document.getElementById("conn-indicator");
const badgeEstop       = document.getElementById("badge-estop");
const badgeState       = document.getElementById("badge-state");
const badgeMode        = document.getElementById("badge-mode");
const badgeHomed       = document.getElementById("badge-homed");
const badgeMock        = document.getElementById("badge-mock");
const machineName      = document.getElementById("machine-name");
const toolNumber       = document.getElementById("tool-number");
const toolOffsetZ      = document.getElementById("tool-offset-z");
const statusBar        = document.getElementById("status-bar");
const statusDump       = document.getElementById("status-dump");
const errorLog         = document.getElementById("error-log");

// Persistent strip refs
const stripStateBadge  = document.getElementById("strip-state-badge");
const stripWcs         = document.getElementById("strip-wcs");
const stripTool        = document.getElementById("strip-tool");
const stripRpm         = document.getElementById("strip-rpm");
const stripModeWcs     = document.getElementById("strip-mode-wcs");
const stripModeAbs     = document.getElementById("strip-mode-abs");
const stripRoot        = document.getElementById("persistent-strip");
const stripDro = {
  X: document.getElementById("strip-dro-x"),
  Y: document.getElementById("strip-dro-y"),
  Z: document.getElementById("strip-dro-z"),
};
const stripSec = {
  X: document.getElementById("strip-sec-x"),
  Y: document.getElementById("strip-sec-y"),
  Z: document.getElementById("strip-sec-z"),
};

// ---- State ----

let _axes = [];              // populated from config
let _touchOffEls = [];       // per-axis touch-off <input> (kept for Zero All reset)
let _decimalPlaces = 3;
let _showWork = true;        // true = WCS primary (large), false = ABS primary

// ---- Build DRO / touch-off from config ----

function buildDRO(cfg) {
  _axes = cfg.axes || ["X", "Y", "Z"];
  _decimalPlaces = cfg.units === "imperial" ? 4 : 3;

  // Hide strip rows for axes the machine doesn't have (e.g. lathe without Y)
  for (const axis of ["X", "Y", "Z"]) {
    const row = document.querySelector(`.strip-axis[data-axis="${axis}"]`);
    if (row) row.style.display = _axes.includes(axis) ? "" : "none";
  }

  _buildTouchOff(_axes);
}

function _buildTouchOff(axes) {
  const panel = document.getElementById("touch-off-panel");
  if (!panel) return;
  panel.innerHTML = "";
  _touchOffEls = [];

  axes.forEach((axisName, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:var(--gap-sm); align-items:center; margin-bottom:var(--gap-sm)";

    const lbl = document.createElement("span");
    lbl.className = "dro-label";
    lbl.style.width = "1.2rem";
    lbl.textContent = axisName;

    const inp = document.createElement("input");
    inp.type = "number";
    inp.value = "0";
    inp.step = "0.001";
    inp.style.cssText = "flex:1; font-family:var(--font-mono); font-size:0.8rem; padding:0.3rem 0.5rem; background:var(--bg-3); border:1px solid var(--border-hi); border-radius:var(--radius); color:var(--text-primary); outline:none";
    inp.id = `touch-off-${i}`;
    inp.title = `Target value for ${axisName} after zero (default 0 = "this position is zero").\nChange only if you need a specific reference other than zero.`;
    // No live tracking — the DRO rows above already show the live position.
    // The input is purely for the target value; 0 is almost always correct.

    const btn = document.createElement("button");
    btn.className = "btn btn-warn";
    btn.textContent = "Zero";
    btn.dataset.axis = i;
    btn.dataset.axisName = axisName;
    btn.addEventListener("click", () => {
      const val = parseFloat(inp.value);
      const target = isNaN(val) ? 0 : val;
      send({ cmd: "mdi", gcode: `G10 L20 P${state.pos.g5x_index || 1} ${axisName}${target}` });
      inp.value = "0";   // reset to 0 ready for next use
    });

    row.append(lbl, inp, btn);
    panel.appendChild(row);
  });

  // Wire Zero All button — use onclick (not addEventListener) so rebuilding
  // DRO on a config update never registers duplicate handlers.
  const zeroAllBtn = document.getElementById("btn-zero-all");
  if (zeroAllBtn) {
    zeroAllBtn.onclick = () => {
      const p = state.pos?.g5x_index || 1;
      const axisWords = axes.map(a => `${a}0`).join(" ");
      send({ cmd: "mdi", gcode: `G10 L20 P${p} ${axisWords}` });
      _touchOffEls.forEach(inp => { inp.value = "0"; });
    };
  }
}

// ---- Update DRO values (persistent strip) ----

function _refreshDRO() {
  const pos = state.pos;
  if (!pos || !Array.isArray(pos.actual)) return;

  const dp  = _decimalPlaces;
  const mcs = pos.actual;
  const wcs = pos.actual.map((v, i) => v - (pos.g5x_offset[i] || 0) - (pos.g92_offset[i] || 0));

  const primary   = _showWork ? wcs : mcs;
  const secondary = _showWork ? mcs : wcs;
  const wcsLabel  = WCS_LABEL[pos.g5x_index || 1] || "WCS";
  const secLabel  = _showWork ? "ABS" : wcsLabel;

  _axes.forEach((axisName, i) => {
    const primaryEl = stripDro[axisName];
    const secEl     = stripSec[axisName];
    if (primaryEl && primary[i]   !== undefined) primaryEl.textContent = primary[i].toFixed(dp);
    if (secEl     && secondary[i] !== undefined) secEl.textContent     = `${secLabel} ${secondary[i].toFixed(dp)}`;
  });
}

// ---- Coord mode toggle (strip WCS/ABS buttons) ----

function _setCoordMode(showWork) {
  _showWork = showWork;
  stripModeWcs?.classList.toggle("active", showWork);
  stripModeAbs?.classList.toggle("active", !showWork);
  stripRoot?.classList.toggle("mode-abs", !showWork);
  _refreshDRO();
}

stripModeWcs?.addEventListener("click", () => _setCoordMode(true));
stripModeAbs?.addEventListener("click", () => _setCoordMode(false));

// Explicitly ensure these stay enabled — they are pure display-mode
// toggles, never gated by machine state.
if (stripModeWcs) stripModeWcs.disabled = false;
if (stripModeAbs) stripModeAbs.disabled = false;

// ---- Connection indicator ----

function _updateConnection(connected) {
  connIndicator.className = connected ? "connected" : "disconnected";
  connLed.className = `led ${connected ? "on-green" : "on-red"}`;
  connText.textContent = connected ? "connected" : "disconnected";

  const overlay = document.getElementById("overlay-disconnected");
  overlay.classList.toggle("visible", !connected);
}

// ---- Status badges ----

function _updateBadges(s) {
  const m = s.machine;
  if (!m) return;

  // E-STOP badge
  badgeEstop.style.display = m.estop ? "" : "none";

  // Power state badge
  if (m.task_state === STATE_ESTOP) {
    badgeState.textContent = "E-STOP";
    badgeState.className = "status-badge estop";
  } else if (m.task_state === STATE_ESTOP_RESET) {
    badgeState.textContent = "RESET";
    badgeState.className = "status-badge";
  } else if (m.task_state === STATE_OFF) {
    badgeState.textContent = "OFF";
    badgeState.className = "status-badge";
  } else {
    badgeState.textContent = "ON";
    badgeState.className = "status-badge on";
  }

  // Mode badge
  const modeLabel = { [MODE_MANUAL]: "MANUAL", [MODE_AUTO]: "AUTO", [MODE_MDI]: "MDI" };
  badgeMode.textContent = modeLabel[m.mode] || "?";

  // Homed badge
  const allHomed = Array.isArray(m.homed) && m.homed.slice(0, _axes.length).every(v => v);
  badgeHomed.style.display = allHomed ? "" : "none";

  // Mock mode badge — visible whenever the server is not connected to a real LinuxCNC
  if (badgeMock) badgeMock.style.display = state.mock ? "" : "none";

  // Persistent strip: active WCS badge
  const wcsIdx   = state.pos?.g5x_index || 1;
  const wcsLabel = WCS_LABEL[wcsIdx] || "G54";
  if (stripWcs) stripWcs.textContent = wcsLabel;

  // Persistent strip: consolidated state badge
  if (stripStateBadge) {
    const interp = m.interp_state;  // 1=IDLE 2=READING 3=PAUSED 4=WAITING
    let label = "OFF", cls = "state-off";
    if (m.estop) { label = "E-STOP"; cls = "state-estop"; }
    else if (m.task_state === STATE_ESTOP_RESET) { label = "RESET"; cls = "state-off"; }
    else if (m.task_state === STATE_ON) {
      if      (interp === 2) { label = "RUNNING";   cls = "state-running"; }
      else if (interp === 3) { label = "FEED HOLD"; cls = "state-pause"; }
      else                   { label = "IDLE";      cls = "state-idle"; }
    }
    stripStateBadge.textContent = label;
    stripStateBadge.className   = `strip-state-badge ${cls}`;
  }
}

// ---- Spindle display ----

function _updateSpindle(s) {
  const sp = s.spindle?.[0];
  if (!sp) return;
  const led = document.getElementById("spindle-led");
  const disp = document.getElementById("spindle-speed-display");
  if (led) led.className = `led ${sp.enabled ? "on-green" : ""}`;
  if (disp) disp.textContent = `${Math.abs(sp.speed).toFixed(0)} rpm`;
  if (stripRpm) stripRpm.textContent = `${Math.abs(sp.speed).toFixed(0)}`;
}

// ---- Tool display ----

function _updateTool(s) {
  if (s.tool) {
    const n = s.tool.number ?? 0;
    if (toolNumber)  toolNumber.textContent  = n;
    if (toolOffsetZ) toolOffsetZ.textContent = (s.tool.offset?.[2] ?? 0).toFixed(_decimalPlaces);
    if (stripTool)   stripTool.textContent   = n;
  }
}

// ---- Status bar ----

function _updateStatusBar(s) {
  const m = s.machine;
  if (!m) return;

  let text = "";
  const interpLabels = { 1: "Idle", 2: "Reading", 3: "Paused", 4: "Waiting" };
  text = interpLabels[m.interp_state] || "";

  if (s.program?.file) {
    const fname = s.program.file.split("/").pop().split("\\").pop();
    text += `  |  ${fname}  line ${s.program.line}`;
  }

  statusBar.textContent = text || "Ready";
  statusBar.className = m.estop ? "critical" : "";
}

// ---- Status dump (debug tab) ----

function _updateStatusDump(s) {
  if (statusDump) {
    statusDump.textContent = JSON.stringify(s, null, 2);
  }
}

// ---- Error log ----

function _appendErrors(errors) {
  if (!errors?.length || !errorLog) return;
  errors.forEach(e => {
    const line = document.createElement("div");
    line.textContent = `[${e.kind === 1 ? "ERR" : "MSG"}] ${e.text}`;
    errorLog.appendChild(line);
    errorLog.scrollTop = errorLog.scrollHeight;
  });
}

// ---- Coolant buttons ----

function _updateCoolant(s) {
  const floodBtn = document.getElementById("btn-flood");
  const mistBtn  = document.getElementById("btn-mist");
  if (!floodBtn || !mistBtn) return;
  floodBtn.classList.toggle("btn-primary", !!s.coolant?.flood);
  floodBtn.classList.toggle("btn-default", !s.coolant?.flood);
  mistBtn.classList.toggle("btn-primary",  !!s.coolant?.mist);
  mistBtn.classList.toggle("btn-default",  !s.coolant?.mist);
}

// ---- Main update callback ----

onConfig((cfg) => {
  if (machineName) machineName.textContent = cfg.machine_name || "LinuxCNC";
  buildDRO(cfg);
});

onUpdate((s) => {
  _updateConnection(s.connected);
  // Render whenever state changes — do NOT gate on s.connected. At startup
  // state.connected flips true slightly before the first frame arrives, so
  // a hard gate here could leave the DRO stuck at 0.000 in rare cases.
  // Each update function guards its own inputs internally.
  _refreshDRO();
  _updateBadges(s);
  _updateSpindle(s);
  _updateTool(s);
  _updateStatusBar(s);
  _updateStatusDump(s);
  _appendErrors(s.errors);
  _updateCoolant(s);
});

// Build with defaults on first load (before config arrives)
buildDRO(config);
