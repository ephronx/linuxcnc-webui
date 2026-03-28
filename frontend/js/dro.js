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

// Axis index → CSS class suffix
const AXIS_CLASS = ["axis-x", "axis-y", "axis-z", "axis-a", "axis-b", "axis-c"];

// ---- DOM refs ----

const droPanel         = document.getElementById("dro-panel");
const coordBtnWcs      = document.getElementById("coord-btn-wcs");
const coordBtnAbs      = document.getElementById("coord-btn-abs");
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

// ---- State ----

let _showWork = true;     // true = WCS primary (G54/G55/…), false = ABS/machine primary
let _axes = [];           // populated from config
let _droValueEls = [];    // per-axis primary value <span>
let _droSecEls   = [];    // per-axis secondary value <span> (always-visible secondary coord)
let _droZeroEls  = [];    // per-axis zero button
let _touchOffEls = [];    // per-axis touch-off <input> (kept for Zero All reset)
let _decimalPlaces = 3;

// ---- Build DRO rows from config ----

function buildDRO(cfg) {
  _axes = cfg.axes || ["X", "Y", "Z"];
  _decimalPlaces = cfg.units === "imperial" ? 4 : 3;
  droPanel.innerHTML = "";
  _droValueEls = [];
  _droSecEls   = [];
  _droZeroEls  = [];

  _axes.forEach((axisName, i) => {
    const axClass = AXIS_CLASS[i] || `axis-${axisName.toLowerCase()}`;
    const row = document.createElement("div");
    row.className = `dro-axis ${axClass}`;

    const label = document.createElement("span");
    label.className = "dro-label";
    label.textContent = axisName;

    // Value stack: primary (large) + secondary (small, dim)
    const stack = document.createElement("div");
    stack.className = "dro-value-stack";

    const primary = document.createElement("span");
    primary.className = "dro-value";
    primary.textContent = "0.000";
    _droValueEls.push(primary);

    const secondary = document.createElement("span");
    secondary.className = "dro-mcs";
    secondary.textContent = "MCS 0.000";
    _droSecEls.push(secondary);

    stack.append(primary, secondary);

    const actions = document.createElement("div");
    actions.className = "dro-actions";

    const zeroBtn = document.createElement("button");
    zeroBtn.className = "btn btn-default";
    zeroBtn.textContent = "Zero";
    zeroBtn.dataset.axis = i;
    zeroBtn.dataset.axisName = axisName;
    _droZeroEls.push(zeroBtn);

    actions.appendChild(zeroBtn);
    row.append(label, stack, actions);
    droPanel.appendChild(row);
  });

  // Build touch-off panel in the DRO panel
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

// ---- WCS / ABS mode buttons ----

function _setCoordMode(wcs) {
  _showWork = wcs;
  coordBtnWcs?.classList.toggle("btn-primary", wcs);
  coordBtnWcs?.classList.toggle("btn-default", !wcs);
  coordBtnAbs?.classList.toggle("btn-primary", !wcs);
  coordBtnAbs?.classList.toggle("btn-default", wcs);
  _refreshDRO();
}

coordBtnWcs?.addEventListener("click", () => _setCoordMode(true));
coordBtnAbs?.addEventListener("click", () => _setCoordMode(false));

// ---- Zero buttons ----

droPanel.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-axis-name]");
  if (!btn || !btn.classList.contains("btn")) return;
  const axisName = btn.dataset.axisName;
  send({ cmd: "mdi", gcode: `G10 L20 P${state.pos.g5x_index || 1} ${axisName}0` });
});

// ---- Update DRO values ----

function _refreshDRO() {
  const pos = state.pos;
  if (!pos) return;

  const dp = _decimalPlaces;
  const mcs = pos.actual;
  const wcs = pos.actual.map((v, i) => v - (pos.g5x_offset[i] || 0) - (pos.g92_offset[i] || 0));

  const primary   = _showWork ? wcs : mcs;
  const secondary = _showWork ? mcs : wcs;
  const secLabel  = _showWork ? "ABS" : (WCS_LABEL[pos.g5x_index || 1] || "WCS");

  _droValueEls.forEach((el, i) => {
    if (primary[i] !== undefined) el.textContent = primary[i].toFixed(dp);
  });
  _droSecEls.forEach((el, i) => {
    if (secondary[i] !== undefined) el.textContent = `${secLabel} ${secondary[i].toFixed(dp)}`;
  });

}

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

  // Keep WCS button label in sync with active WCS (G54, G55, …)
  const wcsIdx = state.pos?.g5x_index || 1;
  if (coordBtnWcs) coordBtnWcs.textContent = WCS_LABEL[wcsIdx] || "WCS";
}

// ---- Spindle display ----

function _updateSpindle(s) {
  const sp = s.spindle?.[0];
  if (!sp) return;
  const led = document.getElementById("spindle-led");
  const disp = document.getElementById("spindle-speed-display");
  if (led) led.className = `led ${sp.enabled ? "on-green" : ""}`;
  if (disp) disp.textContent = `${Math.abs(sp.speed).toFixed(0)} rpm`;
}

// ---- Tool display ----

function _updateTool(s) {
  if (s.tool) {
    toolNumber.textContent = s.tool.number ?? 0;
    toolOffsetZ.textContent = (s.tool.offset?.[2] ?? 0).toFixed(_decimalPlaces);
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
  if (!s.connected) return;

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
