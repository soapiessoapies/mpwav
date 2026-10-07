const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/audio/voices.js");

test("holding and releasing notes", () => {
  const pool = V.createPool(4);
  pool.add(60, "a");
  pool.add(64, "b");
  assert.deepEqual(pool.held(), [60, 64]);
  assert.equal(pool.release(60), "a");
  assert.equal(pool.release(60), null, "a note can only be released once");
  assert.deepEqual(pool.held(), [64]);
  assert.equal(pool.size(), 2, "a released note keeps sounding until removed");
  pool.remove("a");
  assert.equal(pool.size(), 1);
});

test("playing a note that's already held retriggers it", () => {
  const pool = V.createPool(4);
  pool.add(60, "a");
  assert.deepEqual(pool.add(60, "b"), { release: ["a"], cut: [] });
  assert.equal(pool.release(60), "b");
});

test("out of voices: released tails are cut before held notes, oldest first", () => {
  const pool = V.createPool(3);
  pool.add(60, "a");
  pool.add(62, "b");
  pool.add(64, "c");
  pool.release(62);
  assert.deepEqual(pool.add(65, "d").cut, ["b"]);
  assert.deepEqual(pool.add(67, "e").cut, ["a"]);
  assert.deepEqual(pool.held(), [64, 65, 67]);
});
