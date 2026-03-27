/**
 * gcode.js — G-code file viewer with drag-and-drop upload.
 *
 * Responsibilities:
 *   - Drag-and-drop or browse to upload a file via POST /upload
 *   - Render lines with line numbers and basic syntax colouring
 *   - Highlight + auto-scroll to the currently executing line
 *   - Show/hide the drop zone based on whether a file is loaded
 */

import { send } from "./ws.js";
import { state, onUpdate } from "./state.js";
import { loadGcodeText } from "./viewer.js";

// ---- DOM refs ----

const dropzone    = document.getElementById("gcode-dropzone");
const linesEl     = document.getElementById("gcode-lines");
const fileInput   = document.getElementById("file-picker");
const browseBtn   = document.getElementById("btn-browse");
const openBtn     = document.getElementById("btn-prog-open");
const programFile = document.getElementById("program-file");
const programLine   = document.getElementById("program-line");
const progressFill  = document.getElementById("program-progress-fill");
const progressPct   = document.getElementById("program-progress-pct");

let _totalLines = 0;

function _setProgress(line) {
  const pct = _totalLines > 0 ? Math.min(100, (line / _totalLines) * 100) : 0;
  if (progressFill) progressFill.style.width = `${pct.toFixed(1)}%`;
  if (progressPct)  progressPct.textContent  = `${Math.round(pct)}%`;
}

// ---- State ----

let _loadedPath    = "";
let _lineEls       = [];    // indexed by line number (1-based, index 0 unused)
let _lastActive    = -1;
let _autoScroll    = true;
let _scrollTimer   = null;

// ---- Syntax highlighter ----

function _highlight(text) {
  const t = text.trim();
  if (!t) return `<span class="gc-text"> </span>`;

  // Comments: parentheses or semicolon
  if (t.startsWith("(") || t.startsWith(";")) {
    return `<span class="gc-text gc-comment">${_esc(text)}</span>`;
  }
  // Tool call
  if (/^\s*T\d+/i.test(text)) {
    return `<span class="gc-text gc-toolcall">${_esc(text)}</span>`;
  }
  // Motion codes G0 G1 G2 G3 G80-G89
  if (/^\s*G[0-3]\b|^\s*G8[0-9]\b/i.test(text)) {
    return `<span class="gc-text gc-motion">${_esc(text)}</span>`;
  }
  return `<span class="gc-text">${_esc(text)}</span>`;
}

function _esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Render lines ----

function _render(text, filename = "") {
  // Pass to viewer before building DOM (viewer does its own async parse)
  loadGcodeText(text, filename || _loadedPath.split("/").pop().split("\\").pop());

  const lines = text.split("\n");
  linesEl.innerHTML = "";
  _lineEls = [null]; // 1-based

  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const row = document.createElement("div");
    row.className = "gc-line";
    row.dataset.line = lineNum;
    row.innerHTML = `<span class="gc-num">${lineNum}</span>${_highlight(line)}`;
    frag.appendChild(row);
    _lineEls.push(row);
  });

  linesEl.appendChild(frag);
  _lastActive = -1;

  // Update progress max
  _totalLines = lines.length;
  _setProgress(0);

  // Show viewer, hide drop zone
  dropzone.classList.add("hidden");
}

// ---- Active line tracking ----

function _setActiveLine(lineNum) {
  if (lineNum === _lastActive) return;
  if (_lastActive > 0 && _lineEls[_lastActive]) {
    _lineEls[_lastActive].classList.remove("active");
  }
  if (lineNum > 0 && _lineEls[lineNum]) {
    _lineEls[lineNum].classList.add("active");
    if (_autoScroll) {
      _lineEls[lineNum].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  _setProgress(lineNum);
  _lastActive = lineNum;
}

// ---- Upload ----

async function _upload(file) {
  const form = new FormData();
  form.append("file", file);

  let result;
  try {
    const r = await fetch("/upload", { method: "POST", body: form });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      _setStatus(`Upload failed: ${err.detail}`, true);
      return;
    }
    result = await r.json();
  } catch (e) {
    _setStatus(`Upload error: ${e.message}`, true);
    return;
  }

  _loadedPath = result.path;
  _setStatus(`Loaded: ${result.filename}  (${_humanSize(result.size)})`);

  // Update program file display immediately (before server round-trip)
  if (programFile) programFile.textContent = result.filename;

  // Tell LinuxCNC (or mock) to open the file so Run becomes available
  send({ cmd: "program_open", path: result.path });

  // Fetch and render the file content
  try {
    const r2 = await fetch(`/file?path=${encodeURIComponent(result.path)}`);
    if (r2.ok) {
      _render(await r2.text(), result.filename);
    }
  } catch (e) {
    console.warn("Could not fetch file for preview:", e);
  }
}

function _humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _setStatus(msg, isError = false) {
  const bar = document.getElementById("status-bar");
  if (bar) {
    bar.textContent = msg;
    bar.className = isError ? "critical" : "";
  }
}

// ---- Drag and drop ----

function _onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  dropzone.classList.add("drag-over");
}

function _onDragLeave(e) {
  // Only remove if leaving the dropzone itself (not a child)
  if (!dropzone.contains(e.relatedTarget)) {
    dropzone.classList.remove("drag-over");
  }
}

function _onDrop(e) {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = e.dataTransfer.files?.[0];
  if (file) _upload(file);
}

// Allow dropping anywhere on the viewer area, not just the dropzone
const viewer = document.getElementById("gcode-viewer");
viewer?.addEventListener("dragover",  _onDragOver);
viewer?.addEventListener("dragleave", _onDragLeave);
viewer?.addEventListener("drop",      _onDrop);

// Also allow dropping anywhere on the shared gcode listing panel
document.getElementById("gcode-listing-panel")?.addEventListener("dragover",  _onDragOver);
document.getElementById("gcode-listing-panel")?.addEventListener("dragleave", _onDragLeave);
document.getElementById("gcode-listing-panel")?.addEventListener("drop",      _onDrop);

// ---- Browse buttons ----

function _pickFile() { fileInput?.click(); }

browseBtn?.addEventListener("click", _pickFile);
openBtn?.addEventListener("click",   _pickFile);

fileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) _upload(file);
  e.target.value = "";
});

// ---- State updates ----

onUpdate((s) => {
  const prog = s.program;
  if (!prog) return;

  // If LinuxCNC has a file open that we haven't rendered yet, fetch it
  if (prog.file && prog.file !== _loadedPath) {
    _loadedPath = prog.file;
    const fname = prog.file.split("/").pop().split("\\").pop();
    if (programFile) programFile.textContent = fname;

    fetch(`/file?path=${encodeURIComponent(prog.file)}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.statusText))
      .then(text => _render(text))
      .catch(() => {
        // File is on the LinuxCNC machine but not accessible via /file
        // (e.g. outside UPLOAD_DIR) — show name only, no preview
        dropzone.classList.add("hidden");
        linesEl.textContent = `; File: ${prog.file}\n; (Preview not available — file is outside upload directory)`;
      });
  }

  // Track current line
  const line = prog.motion_line || prog.line || 0;
  if (programLine) programLine.textContent = line ? `line ${line}` : "—";
  _setActiveLine(line);
});

// ---- Auto-scroll toggle (click line numbers area to pause scroll) ----

linesEl?.addEventListener("scroll", () => {
  // If user scrolls manually, pause auto-scroll briefly then resume
  _autoScroll = false;
  clearTimeout(_scrollTimer);
  _scrollTimer = setTimeout(() => { _autoScroll = true; }, 3000);
});
