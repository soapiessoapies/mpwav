const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/audio/params.js");
const M = require("../src/audio/morph.js");

const base = () => P.sanitize({ cutoff: 1000, resonance: 2, attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 });

test("the middle of the pad changes nothing", () => {
  assert.deepEqual(M.apply(base(), { x: 0, y: 0 }), base());
  assert.deepEqual(M.apply(base(), null), base());
});

test("X moves from dark to bright through the filter", () => {
  const dark = M.apply(base(), { x: -1, y: 0 });
  const bright = M.apply(base(), { x: 1, y: 0 });
  assert.equal(dark.cutoff, 125);
  assert.equal(bright.cutoff, 8000);
  assert.equal(bright.resonance, 3);
  assert.equal(dark.resonance, 2);
  assert.equal(bright.release, base().release, "X leaves the envelope alone");
});

test("Y moves from tight to spacious through the envelope", () => {
  const tight = M.apply(base(), { x: 0, y: -1 });
  const spacious = M.apply(base(), { x: 0, y: 1 });
  assert.equal(tight.release, 0.05);
  assert.equal(spacious.release, 3.2);
  assert.equal(tight.attack, 0.01, "tight never sharpens the attack");
  assert.ok(Math.abs(spacious.attack - 0.16) < 1e-9);
  assert.ok(tight.sustain < 0.5 && spacious.sustain > 0.5);
  assert.equal(spacious.cutoff, 1000, "Y leaves the filter alone");
  assert.equal(spacious.reverb, 0.5, "spacious adds reverb");
  assert.equal(tight.reverb, 0, "tight doesn't remove the track's own reverb");
});

test("results always stay inside each parameter's range", () => {
  const extreme = P.sanitize({ cutoff: 17000, release: 3.5, decay: 2.5, attack: 1.5, sustain: 1 });
  for (const pos of [{ x: 1, y: 1 }, { x: -1, y: -1 }, { x: 5, y: -9 }]) {
    const q = M.apply(extreme, pos);
    for (const d of P.DEFS) if (d.kind === "range") assert.ok(q[d.id] >= d.min && q[d.id] <= d.max, `${d.id}=${q[d.id]}`);
  }
});

test("describe names the side and the amount", () => {
  assert.equal(M.describe("x", 0), "Middle");
  assert.equal(M.describe("x", -0.4), "Dark 40%");
  assert.equal(M.describe("y", 1, true), "Spacious 100 percent");
});
