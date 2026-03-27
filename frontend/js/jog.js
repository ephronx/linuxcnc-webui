/**
 * jog.js — jog controls (continuous and incremental).
 *
 * Uses pointer events so both mouse and touchscreen work.
 * Continuous jog: pointerdown → jog_start, pointerup/leave → jog_stop.
 * Incremental jog: pointerdown → jog_increment (one-shot).
 */

import { send, onDisconnect } from "./ws.js";
import { config } from "./state.js";

// ---- State ----

let _increment = 0;       // 0 = continuous
let _velocityFrac = 0.5;  // fraction of max jog velocity
let _activeJogs = new Set(); // axes currently jogging (continuous mode)

// ---- Jog increment buttons ----

document.getElementById("jog-increment-btns")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".jog-inc-btn");
  if (!btn) return;
  _increment = parseFloat(btn.dataset.inc);
  document.querySelectorAll(".jog-inc-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
});

// ---- Velocity slider ----

const jogVelSlider = document.getElementById("jog-velocity");
const jogVelDisplay = document.getElementById("jog-velocity-val");

jogVelSlider?.addEventListener("input", () => {
  _velocityFrac = parseFloat(jogVelSlider.value);
  if (jogVelDisplay) jogVelDisplay.textContent = `${Math.round(_velocityFrac * 100)}%`;
});

// ---- Compute velocity for an axis ----

function _velocity(axis) {
  // axis is a 0-based index; max_velocity is keyed by letter ("X","Y","Z") or "default"
  const letter = (config.axes ?? ["X","Y","Z"])[axis] ?? "";
  const maxV = config.max_velocity?.[letter] ?? config.max_velocity?.default ?? 50; // mm/s
  return _velocityFrac * maxV;
}

// ---- Jog button handling ----

function _onJogDown(btn) {
  const axis = parseInt(btn.dataset.axis);
  const dir  = parseInt(btn.dataset.dir);
  const vel  = _velocity(axis) * dir;

  if (_increment === 0) {
    // Continuous
    _activeJogs.add(axis);
    send({ cmd: "jog_start", axis, velocity: vel });
  } else {
    // Incremental — one-shot
    send({ cmd: "jog_increment", axis, velocity: Math.abs(vel), distance: _increment * dir });
  }
}

function _onJogUp(btn) {
  if (_increment !== 0) return; // incremental mode — nothing to stop
  const axis = parseInt(btn.dataset.axis);
  if (_activeJogs.has(axis)) {
    _activeJogs.delete(axis);
    send({ cmd: "jog_stop", axis });
  }
}

// Attach to all jog buttons
document.querySelectorAll(".jog-btn").forEach(btn => {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    _onJogDown(btn);
  });

  btn.addEventListener("pointerup",   () => _onJogUp(btn));
  btn.addEventListener("pointercancel", () => _onJogUp(btn));
});

// Safety: stop all active jogs when page loses focus
window.addEventListener("blur", () => {
  _activeJogs.forEach(axis => send({ cmd: "jog_stop", axis }));
  _activeJogs.clear();
  _keyDown.clear();
});

// Safety: stop all active jogs when the WebSocket connection drops.
// The sent jog_stop commands will be dropped by ws.js (motion commands are
// never buffered), so the server-side watchdog is responsible for actually
// halting the machine. Clearing our local sets ensures the UI doesn't think
// axes are still jogging after a reconnect.
onDisconnect(() => {
  _activeJogs.forEach(axis => send({ cmd: "jog_stop", axis }));
  _activeJogs.clear();
  _keyDown.clear();
});

// Keyboard jog (arrow keys when manual tab is active)
const KEY_AXIS = {
  "ArrowRight":  { axis: 0, dir:  1 },
  "ArrowLeft":   { axis: 0, dir: -1 },
  "ArrowUp":     { axis: 1, dir:  1 },
  "ArrowDown":   { axis: 1, dir: -1 },
  "PageUp":      { axis: 2, dir:  1 },
  "PageDown":    { axis: 2, dir: -1 },
};

const _keyDown = new Set();

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.target.tagName === "INPUT") return;

  const map = KEY_AXIS[e.key];
  if (!map) return;

  e.preventDefault();
  if (_keyDown.has(e.key)) return;
  _keyDown.add(e.key);

  const vel = _velocity(map.axis) * map.dir;
  if (_increment === 0) {
    _activeJogs.add(map.axis);
    send({ cmd: "jog_start", axis: map.axis, velocity: vel });
  } else {
    send({ cmd: "jog_increment", axis: map.axis,
           velocity: Math.abs(vel), distance: _increment * map.dir });
  }
});

document.addEventListener("keyup", (e) => {
  const map = KEY_AXIS[e.key];
  if (!map) return;
  _keyDown.delete(e.key);
  if (_increment === 0 && _activeJogs.has(map.axis)) {
    _activeJogs.delete(map.axis);
    send({ cmd: "jog_stop", axis: map.axis });
  }
});
