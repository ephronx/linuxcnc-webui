/**
 * settings.js — populates the Settings tab with current UI preferences.
 *
 * Phase 7a: read-only view of the prefs blob, grouped by key prefix.
 * Includes a Reset UI Preferences button that clears the blob after
 * confirmation and reloads the page.
 *
 * Editable controls and user-facing settings (theme, poll rates, etc.)
 * land in later phases (7b, HAL monitor sprint, #6 theme).
 */

import * as prefs from "./prefs.js";

const listEl   = document.getElementById("settings-prefs-list");
const resetBtn = document.getElementById("btn-settings-reset");
const tabBar   = document.getElementById("tab-bar");

// Human-readable labels for known prefix groups.
const GROUP_LABELS = {
  "mdi":    "MDI",
  "viewer": "Viewer",
};

function _groupOf(key) {
  const dot = key.indexOf(".");
  return dot === -1 ? "" : key.slice(0, dot);
}

function _subOf(key) {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(dot + 1);
}

function _formatValue(v) {
  if (v == null) return "—";
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "entry" : "entries"}`;
  if (typeof v === "object") return `${Object.keys(v).length} keys`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function _escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function _render() {
  if (!listEl) return;
  const all = prefs.all();
  const keys = Object.keys(all).sort();

  if (keys.length === 0) {
    listEl.innerHTML =
      `<div class="dim" style="font-size:0.72rem">No preferences stored yet.</div>`;
    return;
  }

  const groups = new Map();
  for (const k of keys) {
    const g = _groupOf(k);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(k);
  }

  const rows = [];
  for (const [g, gKeys] of groups) {
    const label = GROUP_LABELS[g] ?? (g || "Other");
    rows.push(`<div class="settings-group-title">${_escape(label)}</div>`);
    for (const k of gKeys) {
      rows.push(
        `<div class="settings-row">` +
          `<span class="settings-key">${_escape(_subOf(k))}</span>` +
          `<span class="settings-value mono">${_escape(_formatValue(all[k]))}</span>` +
        `</div>`
      );
    }
  }
  listEl.innerHTML = rows.join("");
}

// Re-render every time the Settings tab is clicked so values stay fresh
// after the user interacts with other tabs (MDI history, splitter, etc.).
tabBar?.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn?.dataset.tab === "settings") _render();
});

resetBtn?.addEventListener("click", () => {
  const keyCount = Object.keys(prefs.all()).length;
  if (keyCount === 0) return;   // nothing to reset — skip dialog
  if (!window.confirm(
    `Reset all ${keyCount} stored UI preference${keyCount === 1 ? "" : "s"}?\n\n` +
    `This clears MDI history, viewer layout, and any other saved UI state.\n` +
    `The page will reload.`
  )) return;
  prefs.clear();
  window.location.reload();
});

// Initial render so the tab shows values immediately if switched to
// without a click (e.g. via a future keyboard shortcut).
_render();
