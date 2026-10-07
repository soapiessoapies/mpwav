const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../src/state/history.js");

test("undo and redo walk back and forth through saved versions", () => {
  const h = H.create();
  h.commit("a");
  assert.equal(h.canUndo, false, "the first version is the starting point");
  h.commit("b");
  h.commit("c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), "a");
  assert.equal(h.undo(), null, "nothing before the start");
  assert.equal(h.redo(), "b");
  assert.equal(h.redo(), "c");
  assert.equal(h.redo(), null);
});

test("saving the same version twice isn't a step", () => {
  const h = H.create();
  h.commit("a");
  assert.equal(h.commit("a"), false);
  h.commit("b");
  assert.equal(h.commit("b"), false);
  assert.equal(h.undo(), "a");
  assert.equal(h.canUndo, false);
});

test("a new change after undoing drops the redo steps", () => {
  const h = H.create();
  h.commit("a");
  h.commit("b");
  h.undo();
  h.commit("x");
  assert.equal(h.canRedo, false);
  assert.equal(h.undo(), "a");
});

test("only the last `limit` steps are kept", () => {
  const h = H.create(3);
  for (const v of ["a", "b", "c", "d", "e"]) h.commit(v);
  assert.equal(h.undo(), "d");
  assert.equal(h.undo(), "c");
  assert.equal(h.undo(), "b");
  assert.equal(h.undo(), null);
});
