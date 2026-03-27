/**
 * state.js — central state store.
 *
 * Receives raw JSON frames from ws.js, merges them into `state`,
 * then fires registered update callbacks.
 *
 * Also fetches /config on startup and exposes machine configuration.
 *
 * Exports:
 *   state          — live machine state object (mutated in-place)
 *   config         — machine config from /config endpoint
 *   onUpdate(cb)   — register callback for state updates
 *   onConfig(cb)   — register callback once config is loaded
 */

import { onMessage, onConnect, onDisconnect } from "./ws.js";

// ---- State ----

export const state = {
  pos:       { actual: [], commanded: [], g5x_offset: [], g92_offset: [], g5x_index: 1, dtg: [] },
  machine:   { estop: true, enabled: false, homed: [], mode: 1, interp_state: 1,
               motion_mode: 1, motion_type: 0, task_state: 1, exec_state: 1 },
  program:   { file: "", line: 0, motion_line: 0, run_time: 0 },
  overrides: { feed: 1.0, rapid: 1.0 },
  spindle:   [{ speed: 0, direction: 0, enabled: false, at_speed: false,
                override: 1.0, override_enabled: true, brake: false }],
  coolant:   { flood: false, mist: false },
  tool:      { number: 0, offset: [] },
  limits:    { min_soft: [], max_soft: [] },
  errors:    [],
  connected: false,
};

export let config = {
  machine_name: "LinuxCNC",
  axes: ["X", "Y", "Z"],
  units: "metric",
  max_velocity: {},
  jog_increments: [0, 0.001, 0.01, 0.1, 1.0],
};

const _updateHandlers = [];
const _configHandlers = [];

export function onUpdate(cb) { _updateHandlers.push(cb); }
export function onConfig(cb) { _configHandlers.push(cb); }

// ---- Config fetch ----

async function _fetchConfig() {
  try {
    const r = await fetch("/config");
    if (!r.ok) return;
    const data = await r.json();
    Object.assign(config, data);
    _configHandlers.forEach(h => h(config));
  } catch (e) {
    console.warn("config fetch failed:", e);
  }
}

// ---- WS integration ----

onConnect(() => {
  state.connected = true;
  _fetchConfig();
  _updateHandlers.forEach(h => h(state));
});

onDisconnect(() => {
  state.connected = false;
  _updateHandlers.forEach(h => h(state));
});

onMessage((frame) => {
  // ACK frames don't carry machine state — skip them
  if (frame.type === "ack" || frame.type === "error") return;

  // Deep-merge top-level keys from frame into state
  for (const key of Object.keys(frame)) {
    if (typeof frame[key] === "object" && !Array.isArray(frame[key]) &&
        state[key] !== undefined && typeof state[key] === "object" &&
        !Array.isArray(state[key])) {
      Object.assign(state[key], frame[key]);
    } else {
      state[key] = frame[key];
    }
  }

  _updateHandlers.forEach(h => h(state));
});
