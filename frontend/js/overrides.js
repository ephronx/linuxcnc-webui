/**
 * overrides.js — feed/rapid/spindle override sliders + coolant toggles.
 */

import { send } from "./ws.js";
import { state, onUpdate } from "./state.js";

// ---- Override sliders ----

function _sliderSetup(sliderId, displayId, cmdName, toDisplay = v => `${Math.round(v * 100)}%`) {
  const slider  = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  if (!slider) return;

  let _dragging = false;

  slider.addEventListener("pointerdown", () => { _dragging = true; });
  slider.addEventListener("pointerup",   () => { _dragging = false; });
  slider.addEventListener("pointerleave",() => { _dragging = false; });

  slider.addEventListener("input", () => {
    const v = parseFloat(slider.value);
    if (display) display.textContent = toDisplay(v);
    send({ cmd: cmdName, value: v });
  });

  return {
    update(v) {
      if (_dragging) return;  // don't jump while user is dragging
      slider.value = v;
      if (display) display.textContent = toDisplay(v);
    }
  };
}

const feedSlider    = _sliderSetup("feed-override",    "feed-override-val",    "feed_override");
const rapidSlider   = _sliderSetup("rapid-override",   "rapid-override-val",   "rapid_override");
const spindleSlider = _sliderSetup("spindle-override", "spindle-override-val", "spindle_override");

onUpdate((s) => {
  if (!s.connected) return;
  feedSlider?.update(s.overrides?.feed   ?? 1.0);
  rapidSlider?.update(s.overrides?.rapid ?? 1.0);
  spindleSlider?.update(s.spindle?.[0]?.override ?? 1.0);
});

// ---- Coolant ----

document.getElementById("btn-flood")?.addEventListener("click", () => {
  send({ cmd: state.coolant?.flood ? "flood_off" : "flood_on" });
});

document.getElementById("btn-mist")?.addEventListener("click", () => {
  send({ cmd: state.coolant?.mist ? "mist_off" : "mist_on" });
});

// ---- Spindle on/off ----

document.getElementById("btn-spindle-on")?.addEventListener("click", () => {
  const raw = parseFloat(document.getElementById("spindle-speed-display")?.dataset?.setSpeed ?? "");
  const speed = Number.isFinite(raw) && raw > 0 ? raw : 1000;
  send({ cmd: "spindle_on", speed });
});

document.getElementById("btn-spindle-off")?.addEventListener("click", () => {
  send({ cmd: "spindle_off" });
});
