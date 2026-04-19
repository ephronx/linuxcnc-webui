/**
 * prefs.js — client-side preferences store.
 *
 * Unified API for values persisted across page loads. All prefs live in a
 * single localStorage blob at `webui:prefs`, keyed by dot-notation paths
 * (e.g. "mdi.history", "viewer.splitterHeightPx").
 *
 * Legacy per-feature keys from before this module are migrated into the
 * blob on first load and then removed, so existing state is preserved.
 *
 * All operations are safe against storage being unavailable (private mode,
 * quota exceeded) — values fall back to in-memory for the session.
 *
 * Usage:
 *   import { get, set, reset, clear, all } from "./prefs.js";
 *   const history = get("mdi.history", []);
 *   set("viewer.splitterHeightPx", 420);
 */

const STORAGE_KEY = "webui:prefs";

let _prefs = _load();

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
  } catch {
    // Private mode / quota exceeded — continue with in-memory state only.
  }
}

export function get(key, defaultValue = undefined) {
  return Object.prototype.hasOwnProperty.call(_prefs, key) ? _prefs[key] : defaultValue;
}

export function set(key, value) {
  _prefs[key] = value;
  _persist();
}

export function reset(key) {
  delete _prefs[key];
  _persist();
}

export function clear() {
  _prefs = {};
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// Returns a shallow copy so callers can't mutate the internal store.
export function all() {
  return { ...(_prefs) };
}

// ---- Legacy key migration (one-shot, idempotent) ----

function _migrate(legacyKey, newKey, parser) {
  let raw;
  try { raw = localStorage.getItem(legacyKey); } catch { return; }
  if (raw == null) return;
  let parsed;
  try { parsed = parser(raw); } catch { parsed = undefined; }
  if (parsed !== undefined) set(newKey, parsed);
  // Always drop the legacy key — bad data shouldn't block migration forever.
  try { localStorage.removeItem(legacyKey); } catch {}
}

_migrate("webui:mdiHistory", "mdi.history", (v) => {
  const parsed = JSON.parse(v);
  return Array.isArray(parsed) ? parsed.filter(s => typeof s === "string") : undefined;
});

_migrate("webui:viewerHeightPx", "viewer.splitterHeightPx", (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
});
