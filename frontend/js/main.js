/**
 * main.js — wires up machine control buttons that don't belong in other modules.
 *
 * Covers: E-stop, power on/off, homing, MDI, program controls, WCS selection.
 */

import { send } from "./ws.js";
import { state, onUpdate } from "./state.js";

// ---- Machine control ----

document.getElementById("btn-estop")?.addEventListener("click", () => {
  // task_state 1 = STATE_ESTOP → send reset; anything else → trigger estop
  send({ cmd: state.machine?.task_state === 1 ? "estop_reset" : "estop" });
});

document.getElementById("btn-machine-on")?.addEventListener("click", () => {
  send({ cmd: "machine_on" });
});

document.getElementById("btn-machine-off")?.addEventListener("click", () => {
  send({ cmd: "machine_off" });
});

// ---- Homing ----

document.getElementById("btn-home-all")?.addEventListener("click", () => {
  send({ cmd: "home_all" });
});

document.getElementById("btn-unhome-all")?.addEventListener("click", () => {
  send({ cmd: "unhome_all" });
});

// ---- MDI ----

const mdiInput   = document.getElementById("mdi-input");
const mdiHistory = document.getElementById("mdi-history");
const MDI_HISTORY_KEY   = "webui:mdiHistory";
const MDI_HISTORY_LIMIT = 100;

function _loadHistory() {
  try {
    const raw = localStorage.getItem(MDI_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === "string") : [];
  } catch {
    return [];   // private mode, quota, or malformed JSON
  }
}

function _saveHistory() {
  try {
    localStorage.setItem(MDI_HISTORY_KEY, JSON.stringify(mdiHistory_));
  } catch {
    // Storage disabled/full — history still works in-memory for this session.
  }
}

const mdiHistory_ = _loadHistory();

function _appendHistoryLine(gcode) {
  if (!mdiHistory) return;
  const line = document.createElement("div");
  line.className   = "mdi-history-entry";
  line.textContent = `> ${gcode}`;
  line.title       = "Click to copy to input";
  line.addEventListener("click", () => {
    mdiInput.value = gcode;
    mdiInput.focus();
    // Place cursor at end so the operator can edit immediately.
    const n = mdiInput.value.length;
    mdiInput.setSelectionRange(n, n);
    _histIdx = -1;   // break out of arrow-key navigation
    _highlightHistory();
  });
  mdiHistory.appendChild(line);
  mdiHistory.scrollTop = mdiHistory.scrollHeight;
}

// Visually mark the history entry matching _histIdx (arrow-key navigation).
// DOM children are 1:1 with mdiHistory_ (newest last); _histIdx=0 is newest.
function _highlightHistory() {
  if (!mdiHistory) return;
  const children = mdiHistory.children;
  const target   = _histIdx < 0 ? -1 : children.length - 1 - _histIdx;
  for (let i = 0; i < children.length; i++) {
    children[i].classList.toggle("selected", i === target);
  }
  if (target >= 0) {
    children[target].scrollIntoView({ block: "nearest" });
  }
}

// Re-hydrate visible panel from loaded history
mdiHistory_.forEach(_appendHistoryLine);

function _sendMDI() {
  const gcode = mdiInput.value.trim();
  if (!gcode) return;
  send({ cmd: "mdi", gcode });
  mdiHistory_.push(gcode);
  if (mdiHistory_.length > MDI_HISTORY_LIMIT) {
    mdiHistory_.shift();
    // Drop the oldest DOM entry to stay in sync with the array.
    mdiHistory?.firstElementChild?.remove();
  }
  _appendHistoryLine(gcode);
  _saveHistory();
  mdiInput.value = "";
  _histIdx = -1;
  _highlightHistory();
}

document.getElementById("btn-mdi-send")?.addEventListener("click", _sendMDI);
mdiInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") _sendMDI();
});

// Clear button — wipes the visible panel, the in-memory array, and storage.
// Safe to press at any time including during a run (clears display only,
// never affects the machine).
const mdiClearBtn = document.getElementById("btn-mdi-history-clear");
if (mdiClearBtn) {
  mdiClearBtn.addEventListener("click", () => {
    if (mdiHistory_.length === 0) return;   // nothing to clear — no prompt
    const n = mdiHistory_.length;
    if (!window.confirm(
      `Clear all ${n} MDI history ${n === 1 ? "entry" : "entries"}?\n\n` +
      `This cannot be undone.`
    )) return;
    mdiHistory_.length = 0;
    if (mdiHistory) mdiHistory.innerHTML = "";
    try { localStorage.removeItem(MDI_HISTORY_KEY); } catch {}
    _histIdx = -1;
    _highlightHistory();
  });
  // Never gated by machine state — pure display action.
  mdiClearBtn.disabled = false;
}

// MDI history navigation (up/down arrows)
let _histIdx = -1;
mdiInput?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    _histIdx = Math.min(_histIdx + 1, mdiHistory_.length - 1);
    mdiInput.value = mdiHistory_[mdiHistory_.length - 1 - _histIdx] ?? "";
    _highlightHistory();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    _histIdx = Math.max(_histIdx - 1, -1);
    mdiInput.value = _histIdx === -1 ? "" : (mdiHistory_[mdiHistory_.length - 1 - _histIdx] ?? "");
    _highlightHistory();
  } else if (e.key !== "Enter") {
    // Any other key (user is typing) breaks out of navigation.
    _histIdx = -1;
    _highlightHistory();
  }
});

// ---- Program controls ----

document.getElementById("btn-prog-run")?.addEventListener("click", () => {
  send({ cmd: "program_run", start_line: 0 });
});

document.getElementById("btn-prog-pause")?.addEventListener("click", () => {
  // Toggle pause/resume based on current interp state
  const interp = state.machine?.interp_state;
  // interp_state 3 = PAUSED
  send({ cmd: interp === 3 ? "program_resume" : "program_pause" });
});

document.getElementById("btn-prog-stop")?.addEventListener("click", () => {
  send({ cmd: "program_stop" });
});

document.getElementById("btn-prog-step")?.addEventListener("click", () => {
  send({ cmd: "program_step" });
});

document.getElementById("btn-prog-rewind")?.addEventListener("click", () => {
  send({ cmd: "program_run", start_line: 0 });
});

// btn-prog-open and file-picker are handled by gcode.js

// ---- WCS buttons (document-level so both DRO panel and Offsets tab work) ----

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".wcs-btn");
  if (!btn) return;
  send({ cmd: "set_work_coord", code: btn.dataset.wcs });
  // Active state is synced by the onUpdate handler below when state arrives
});

// ---- Update program display ----

onUpdate((s) => {
  const fileEl = document.getElementById("program-file");
  const lineEl = document.getElementById("program-line");
  if (fileEl && s.program?.file) {
    fileEl.textContent = s.program.file.split("/").pop().split("\\").pop() || "No file";
  }
  if (lineEl && s.program) {
    lineEl.textContent = `line ${s.program.line ?? 0}`;
  }

  // Sync pause button label
  const pauseBtn = document.getElementById("btn-prog-pause");
  if (pauseBtn) {
    pauseBtn.textContent = s.machine?.interp_state === 3 ? "▶ Resume" : "⏸ Pause";
  }

  // Sync WCS buttons
  const g5x = s.pos?.g5x_index;
  if (g5x !== undefined) {
    const wcsLabel = ["?","G54","G55","G56","G57","G58","G59","G59.1","G59.2","G59.3"][g5x] || "G54";
    document.querySelectorAll(".wcs-btn").forEach(b => {
      const active = b.dataset.wcs === wcsLabel;
      b.classList.toggle("btn-primary", active);
      b.classList.toggle("btn-default", !active);
    });
  }
});

// ---- Viewer / panel-below splitter ----
// Lets the operator resize the toolpath viewer vs the gcode listing / MDI
// history / auto controls below it. Persists the chosen height in
// localStorage. Double-click returns to the default flex ratio.

const VIEWER_HEIGHT_KEY = "webui:viewerHeightPx";
const splitter      = document.getElementById("viewer-splitter");
const sharedViewer  = document.getElementById("shared-viewer");
const panelMain     = document.getElementById("panel-main");

function _applyViewerHeight(px) {
  if (!sharedViewer) return;
  // flex:0 0 {px}px pins the viewer to this height; the panel below fills
  // whatever space remains. Clamped by min-height in the CSS.
  sharedViewer.style.flex = `0 0 ${px}px`;
}

function _resetViewerHeight() {
  if (!sharedViewer) return;
  sharedViewer.style.flex = "";   // revert to stylesheet default (3 1 0)
  try { localStorage.removeItem(VIEWER_HEIGHT_KEY); } catch {}
}

// Restore any previously saved height on load.
try {
  const saved = localStorage.getItem(VIEWER_HEIGHT_KEY);
  if (saved) {
    const px = parseInt(saved, 10);
    if (Number.isFinite(px) && px > 0) _applyViewerHeight(px);
  }
} catch {}

if (splitter && sharedViewer && panelMain) {
  let dragging = false;

  splitter.addEventListener("pointerdown", (e) => {
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    e.preventDefault();
  });

  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // New viewer height = mouse Y relative to the top of panel-main, minus
    // the tab-bar height (which sits above #shared-viewer inside panel-main).
    const rect   = panelMain.getBoundingClientRect();
    const tabBar = document.getElementById("tab-bar");
    const tabBarH = tabBar ? tabBar.getBoundingClientRect().height : 0;
    // Respect the panel-main bottom so the panel below doesn't collapse to
    // zero; reserve 6rem (~96px) of minimum space for it.
    const maxH = rect.height - tabBarH - 96;
    const rawH = e.clientY - rect.top - tabBarH;
    const h    = Math.max(96, Math.min(maxH, rawH));
    _applyViewerHeight(h);
  });

  const _endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    splitter.releasePointerCapture?.(e.pointerId);
    // Persist final height.
    const h = sharedViewer.getBoundingClientRect().height;
    try { localStorage.setItem(VIEWER_HEIGHT_KEY, String(Math.round(h))); } catch {}
  };
  splitter.addEventListener("pointerup",     _endDrag);
  splitter.addEventListener("pointercancel", _endDrag);

  // Double-click → reset to stylesheet default flex ratio.
  splitter.addEventListener("dblclick", _resetViewerHeight);
}
