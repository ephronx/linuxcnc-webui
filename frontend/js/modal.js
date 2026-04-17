/**
 * modal.js — active modal G-codes strip.
 *
 * Renders the list of currently active modal G-codes pushed in
 * state.modal.gcodes (list of ints where value = G-code × 10,
 * -1 = inactive, slot 0 = sequence number).
 */

import { state, onUpdate } from "./state.js";

const root = document.getElementById("modal-codes");

function formatGcode(n) {
  if (n < 0) return null;
  const major = Math.floor(n / 10);
  const minor = n % 10;
  return minor ? `G${major}.${minor}` : `G${major}`;
}

function render() {
  if (!root) return;
  const raw = state.modal?.gcodes || [];
  // Slot 0 is the sequence number, skip it. Drop inactive (-1) slots.
  const codes = raw.slice(1).filter(n => n >= 0).map(formatGcode);
  root.textContent = codes.length ? codes.join("  ") : "—";
}

onUpdate(render);
render();
