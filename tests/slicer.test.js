const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/audio/slicer.js");

const RATE = 22050;
// Hits at the given times: a quick attack and a decay, silence between.
function hits(times, dur, { level = 0.8, decay = 14, quietBed = 0 } = {}) {
  const d = new Float32Array(Math.round(dur * RATE));
  for (let i = 0; i < d.length; i++) {
    const t = i / RATE;
    let v = quietBed * Math.sin(2 * Math.PI * 97 * t);
    for (const h of times) if (t >= h) v += level * Math.exp(-(t - h) * decay) * Math.sin(2 * Math.PI * 180 * (t - h));
    d[i] = v;
  }
  return [d];
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test("equal parts and bars", () => {
  assert.deepEqual(S.equal(2, 4), [0.5, 1, 1.5]);
  assert.deepEqual(S.equal(2, 1), []);
  assert.deepEqual(S.bars(5, 2, 1), [2, 4]);
  assert.deepEqual(S.bars(5, 1, 2), [2, 4]);
  assert.deepEqual(S.bars(5, 0), []);
});

test("cuts are tidied: sorted, inside, not doubled", () => {
  assert.deepEqual(S.tidy([1.5, 0, 0.5, 0.505, 3, 2], 3), [0.5, 1.5, 2]);
  assert.deepEqual(S.slicesOf([1, 2], 3), [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }]);
  assert.deepEqual(S.slicesOf([], 3), [{ from: 0, to: 3 }]);
});

test("by beats: a cut just before each hit", () => {
  const at = [0.25, 0.75, 1.25, 1.6];
  const cuts = S.beats(hits(at, 2.2), RATE);
  assert.equal(cuts.length, at.length, JSON.stringify(cuts));
  cuts.forEach((c, i) => assert.ok(near(c, at[i], 0.02) && c <= at[i] + 0.006, `${c} vs ${at[i]}`));
});

test("by beats: quiet background hum doesn't make extra cuts", () => {
  const cuts = S.beats(hits([0.3, 1.0], 1.6, { quietBed: 0.02 }), RATE);
  assert.equal(cuts.length, 2, JSON.stringify(cuts));
});

test("by beats: lower sensitivity finds fewer of the soft hits", () => {
  const d = hits([0.3], 1.6)[0];
  const soft = hits([0.9], 1.6, { level: 0.08 })[0];
  for (let i = 0; i < d.length; i++) d[i] += soft[i];
  assert.ok(S.beats([d], RATE, { sensitivity: 1 }).length >= S.beats([d], RATE, { sensitivity: 0 }).length);
});

test("by silences: a cut in the middle of each gap between sounds", () => {
  const d = new Float32Array(Math.round(2 * RATE));
  const on = (a, b) => { for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) d[i] = 0.5 * Math.sin(i / 3); };
  on(0.1, 0.6); on(1.0, 1.4); on(1.6, 1.9);
  const cuts = S.silences([d], RATE);
  assert.equal(cuts.length, 2, JSON.stringify(cuts));
  assert.ok(near(cuts[0], 0.8, 0.02) && near(cuts[1], 1.5, 0.02), JSON.stringify(cuts));
  assert.deepEqual(S.silences([d], RATE, { minGap: 0.3 }).length, 1, "a shorter gap than minGap isn't a cut");
});

test("the nearest zero crossing", () => {
  const d = new Float32Array(RATE);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 100 * i) / RATE); // zero every 5 ms
  const z = S.nearestZero([d], RATE, 0.0123);
  assert.ok(near(z, 0.01, 0.0005) || near(z, 0.015, 0.0005), String(z));
});
