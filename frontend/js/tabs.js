/**
 * tabs.js — tab switching for the shared-viewer layout.
 *
 * Tabs are split into two categories:
 *
 *   viewer tabs  (manual | mdi | auto)
 *     The shared toolpath canvas stays visible.
 *     A per-tab control strip is shown below the canvas.
 *     Manual has no strip (the viewer fills the entire area).
 *
 *   full-panel tabs  (offsets | status)
 *     The viewer is hidden; the full-panel tab-panel takes all space.
 *
 * DOM:
 *   #shared-viewer        — the persistent canvas area
 *   #tab-panel-{name}     — per-tab control strip or full panel
 *   .tab-panel-full       — marks a full-panel tab (replaces viewer)
 */

// Tabs where the shared toolpath canvas is shown
const VIEWER_TABS = new Set(["manual", "mdi", "auto"]);

// Tabs that have a control strip below the canvas (all viewer tabs now do)
// manual  → gcode listing + drop zone
// mdi     → MDI input bar + history
// auto    → program controls (run/pause/stop/…)
// offsets → full panel (replaces viewer)
// status  → full panel (replaces viewer)

const tabBar        = document.getElementById("tab-bar");
const sharedViewer  = document.getElementById("shared-viewer");
const allPanels     = document.querySelectorAll(".tab-panel");

function _switchTab(target) {
  // ---- Update tab button active state ----
  tabBar.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === target);
  });

  // ---- Show / hide the shared viewer ----
  const showViewer = VIEWER_TABS.has(target);
  sharedViewer?.classList.toggle("hidden", !showViewer);

  // ---- Show the matching tab panel(s), hide all others ----
  // A panel may declare data-tabs="manual auto" to appear in multiple tabs.
  // Falls back to matching against the panel's own id (tab-panel-{name}).
  allPanels.forEach(panel => {
    const tabs = panel.dataset.tabs
      ? panel.dataset.tabs.split(" ")
      : [panel.id.replace("tab-panel-", "")];
    panel.classList.toggle("visible", tabs.includes(target));
  });
}

// Wire up tab-bar clicks
tabBar.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  _switchTab(btn.dataset.tab);
});

// Apply initial state (Manual tab active on load)
_switchTab("manual");

// Expose for other modules (e.g. auto-switch to Auto when file opens)
export { _switchTab as switchTab };
