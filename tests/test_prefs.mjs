// Smoke tests for frontend/js/prefs.js — stubs localStorage and exercises
// the public API plus legacy-key migration.
//
// Run: node --test tests/test_prefs.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

function _makeMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    mock: {
      getItem:    (k) => (k in store ? store[k] : null),
      setItem:    (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear:      () => { for (const k in store) delete store[k]; },
    },
  };
}

async function loadPrefs(initialStorage = {}) {
  const { store, mock } = _makeMockStorage(initialStorage);
  globalThis.localStorage = mock;
  // Cache-bust the module so migration runs fresh on each import.
  const url = new URL(
    `../frontend/js/prefs.js?t=${Math.random()}`, import.meta.url
  );
  const prefs = await import(url.href);
  return { prefs, store };
}

test("empty storage — all() returns {}", async () => {
  const { prefs } = await loadPrefs();
  assert.deepEqual(prefs.all(), {});
});

test("set + get roundtrip", async () => {
  const { prefs, store } = await loadPrefs();
  prefs.set("foo.bar", 42);
  assert.equal(prefs.get("foo.bar"), 42);
  const raw = JSON.parse(store["webui:prefs"]);
  assert.equal(raw["foo.bar"], 42);
});

test("get returns default when key missing", async () => {
  const { prefs } = await loadPrefs();
  assert.equal(prefs.get("missing", "fallback"), "fallback");
  assert.equal(prefs.get("missing"), undefined);
});

test("reset removes a single key", async () => {
  const { prefs } = await loadPrefs();
  prefs.set("a", 1);
  prefs.set("b", 2);
  prefs.reset("a");
  assert.equal(prefs.get("a"), undefined);
  assert.equal(prefs.get("b"), 2);
});

test("clear wipes everything", async () => {
  const { prefs, store } = await loadPrefs();
  prefs.set("a", 1);
  prefs.clear();
  assert.deepEqual(prefs.all(), {});
  assert.equal(store["webui:prefs"], undefined);
});

test("reload reads existing blob", async () => {
  const blob = JSON.stringify({ x: 1, y: 2 });
  const { prefs } = await loadPrefs({ "webui:prefs": blob });
  assert.equal(prefs.get("x"), 1);
  assert.equal(prefs.get("y"), 2);
});

test("malformed blob is ignored", async () => {
  const { prefs } = await loadPrefs({ "webui:prefs": "{bad json" });
  assert.deepEqual(prefs.all(), {});
});

test("all() returns a copy — callers can't mutate internal store", async () => {
  const { prefs } = await loadPrefs();
  prefs.set("a", 1);
  const snapshot = prefs.all();
  snapshot.a = 99;
  assert.equal(prefs.get("a"), 1);
});

test("migration: webui:mdiHistory → mdi.history", async () => {
  const history = ["G0 X0", "M3 S1000"];
  const { prefs, store } = await loadPrefs({
    "webui:mdiHistory": JSON.stringify(history),
  });
  assert.deepEqual(prefs.get("mdi.history"), history);
  assert.equal(store["webui:mdiHistory"], undefined, "legacy key removed");
});

test("migration: webui:viewerHeightPx → viewer.splitterHeightPx", async () => {
  const { prefs, store } = await loadPrefs({ "webui:viewerHeightPx": "420" });
  assert.equal(prefs.get("viewer.splitterHeightPx"), 420);
  assert.equal(store["webui:viewerHeightPx"], undefined);
});

test("migration: malformed legacy values are dropped without crashing", async () => {
  const { prefs, store } = await loadPrefs({
    "webui:mdiHistory":    "{not valid json",
    "webui:viewerHeightPx": "abc",
  });
  assert.equal(prefs.get("mdi.history"), undefined);
  assert.equal(prefs.get("viewer.splitterHeightPx"), undefined);
  // Legacy keys are always removed so migration doesn't retry forever.
  assert.equal(store["webui:mdiHistory"],    undefined);
  assert.equal(store["webui:viewerHeightPx"], undefined);
});

test("migration survives reload (idempotent)", async () => {
  const history = ["test"];
  const { store } = await loadPrefs({
    "webui:mdiHistory": JSON.stringify(history),
  });
  // Second load uses the migrated storage; legacy key is gone.
  const { prefs } = await loadPrefs({ ...store });
  assert.deepEqual(prefs.get("mdi.history"), history);
});

test("migration rejects non-array mdi history", async () => {
  const { prefs, store } = await loadPrefs({
    "webui:mdiHistory": JSON.stringify({ not: "an array" }),
  });
  assert.equal(prefs.get("mdi.history"), undefined);
  assert.equal(store["webui:mdiHistory"], undefined);
});

test("migration filters non-string entries from mdi history", async () => {
  const { prefs } = await loadPrefs({
    "webui:mdiHistory": JSON.stringify(["G0 X0", 42, null, "M5"]),
  });
  assert.deepEqual(prefs.get("mdi.history"), ["G0 X0", "M5"]);
});
