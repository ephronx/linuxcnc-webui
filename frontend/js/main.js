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
const mdiHistory_ = [];

function _sendMDI() {
  const gcode = mdiInput.value.trim();
  if (!gcode) return;
  send({ cmd: "mdi", gcode });
  mdiHistory_.push(gcode);
  if (mdiHistory_.length > 100) mdiHistory_.shift();
  if (mdiHistory) {
    const line = document.createElement("div");
    line.textContent = `> ${gcode}`;
    line.style.color = "var(--text-primary)";
    mdiHistory.appendChild(line);
    mdiHistory.scrollTop = mdiHistory.scrollHeight;
  }
  mdiInput.value = "";
}

document.getElementById("btn-mdi-send")?.addEventListener("click", _sendMDI);
mdiInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") _sendMDI();
});

// MDI history navigation (up/down arrows)
let _histIdx = -1;
mdiInput?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    _histIdx = Math.min(_histIdx + 1, mdiHistory_.length - 1);
    mdiInput.value = mdiHistory_[mdiHistory_.length - 1 - _histIdx] ?? "";
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    _histIdx = Math.max(_histIdx - 1, -1);
    mdiInput.value = _histIdx === -1 ? "" : (mdiHistory_[mdiHistory_.length - 1 - _histIdx] ?? "");
  } else {
    _histIdx = -1;
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
