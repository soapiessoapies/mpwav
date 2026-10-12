const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../src/audio/wave-ops.js");

const sound = (...chans) => chans.map((c) => Float32Array.from(c));
const list = (chans) => chans.map((d) => Array.from(d, (v) => +v.toFixed(4)));

test("edits return new channels and leave the sound they came from alone", () => {
  const src = sound([0.1, 0.2, 0.3, 0.4]);
  for (const out of [W.amplify(src, 0, 4, 6), W.fade(src, 0, 4, "in"), W.silence(src, 1, 3), W.reverse(src, 0, 4), W.remove(src, 1, 2), W.normalize(src, 0, 4).chans]) {
    assert.notEqual(out[0], src[0]);
  }
  assert.deepEqual(list(src), [[0.1, 0.2, 0.3, 0.4]]);
});

test("amplify changes only the stretch, on every channel", () => {
  const out = W.amplify(sound([0.1, 0.1, 0.1, 0.1], [0.2, 0.2, 0.2, 0.2]), 1, 3, 20 * Math.log10(2));
  assert.deepEqual(list(out), [[0.1, 0.2, 0.2, 0.1], [0.2, 0.4, 0.4, 0.2]]);
});

test("normalize brings the stretch's loudest sample to full scale and says by how much", () => {
  const { chans, db } = W.normalize(sound([0.9, 0.25, -0.5, 0.9]), 1, 3);
  assert.deepEqual(list(chans), [[0.9, 0.5, -1, 0.9]]);
  assert.ok(Math.abs(db - 6.0206) < 0.001);
});

test("normalize leaves silence alone", () => {
  const { chans, db } = W.normalize(sound([0, 0, 0]), 0, 3);
  assert.equal(db, 0);
  assert.deepEqual(list(chans), [[0, 0, 0]]);
});

test("fade in rises from silence, fade out falls to it", () => {
  assert.deepEqual(list(W.fade(sound([1, 1, 1, 1, 1]), 0, 4, "in")), [[0, 0.25, 0.5, 0.75, 1]]);
  assert.deepEqual(list(W.fade(sound([1, 1, 1, 1, 1]), 1, 5, "out")), [[1, 0.75, 0.5, 0.25, 0]]);
});

test("silence and reverse work on the stretch only", () => {
  assert.deepEqual(list(W.silence(sound([1, 2, 3, 4]), 1, 3)), [[1, 0, 0, 4]]);
  assert.deepEqual(list(W.reverse(sound([1, 2, 3, 4, 5]), 1, 4)), [[1, 4, 3, 2, 5]]);
});

test("remove cuts the stretch out and closes the gap", () => {
  assert.deepEqual(list(W.remove(sound([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]), 1, 3)), [[1, 4, 5], [6, 9, 10]]);
});

test("a stretch outside the sound is clamped to it", () => {
  assert.deepEqual(list(W.silence(sound([1, 2, 3]), -5, 99)), [[0, 0, 0]]);
  assert.deepEqual(list(W.remove(sound([1, 2, 3]), 2, 99)), [[1, 2]]);
  assert.deepEqual(list(W.silence(sound([1, 2, 3]), 2, 1)), [[1, 2, 3]], "a backwards stretch is empty");
});

test("afterCut moves trim points with a cut", () => {
  assert.equal(W.afterCut(0.5, 1, 2), 0.5, "before the cut: stays");
  assert.equal(W.afterCut(1.5, 1, 2), 1, "inside it: lands where the cut was");
  assert.equal(W.afterCut(3, 1, 2), 2, "after it: moves earlier by the cut's length");
});

test("peak finds the loudest sample of any channel in the stretch", () => {
  assert.ok(Math.abs(W.peak(sound([0.1, -0.7, 0.2], [0.3, 0.1, 0.9]), 0, 2) - 0.7) < 1e-6);
});

test("outline gives min and max per point across the stretch", () => {
  const out = W.outline(sound([0.5, -0.5, 1, -1, 0.2, 0.1, 9, 9]), 0, 6, 3);
  assert.deepEqual(Array.from(out, (v) => +v.toFixed(2)), [-0.5, 0.5, -1, 1, 0, 0.2]);
});

test("outline zoomed in past one sample per point still draws something", () => {
  const out = W.outline(sound([0.5, -0.5]), 0, 2, 4);
  assert.deepEqual(Array.from(out), [0, 0.5, 0, 0.5, -0.5, 0, -0.5, 0]);
});
