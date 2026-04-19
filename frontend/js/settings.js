/**
 * settings.js — Settings tab behaviour.
 *
 * Phase 7a: tab shell only. Editable controls (theme, HAL monitor poll
 * rates, viewer defaults, etc.) arrive in later phases — each setting
 * will render its own control into this tab.
 *
 * Provides a "Reset UI Preferences" button that clears the entire prefs
 * blob after confirmation. Useful for clearing MDI history, viewer
 * layout, and any future app state in one operation.
 */

import * as prefs from "./prefs.js";

const resetBtn = document.getElementById("btn-settings-reset");

resetBtn?.addEventListener("click", () => {
  if (Object.keys(prefs.all()).length === 0) return;
  if (!window.confirm(
    `Reset all stored UI preferences?\n\n` +
    `This clears MDI history, viewer layout, and any other saved UI state.\n` +
    `The page will reload.`
  )) return;
  prefs.clear();
  window.location.reload();
});
