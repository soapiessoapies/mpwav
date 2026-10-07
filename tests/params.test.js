const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/audio/params.js");

test("every default is inside its range or among its options", () => {
  for (const d of P.DEFS) {
    if (d.kind === "choice") assert.ok(d.options.some((o) => o.id === d.def), d.id);
    else assert.ok(d.def >= d.min && d.def <= d.max, d.id);
  }
});

test("slider positions round-trip, and log sliders put the middle at the geometric mean", () => {
  const cutoff = P.BY_ID.cutoff;
  assert.equal(P.toPos(cutoff, cutoff.min), 0);
  assert.equal(P.toPos(cutoff, cutoff.max), P.STEPS);
  const mid = P.fromPos(cutoff, P.STEPS / 2);
  assert.ok(Math.abs(mid - Math.sqrt(cutoff.min * cutoff.max)) < 1);
  for (const v of [80, 440, 2500, 12000]) {
    const back = P.fromPos(cutoff, P.toPos(cutoff, v));
    assert.ok(Math.abs(back - v) / v < 0.01, `${v} -> ${back}`);
  }
});

test("stepped values snap to their step", () => {
  assert.equal(P.fromPos(P.BY_ID.octave, 520), 0);
  assert.equal(P.sanitize({ octave: 1.4 }).octave, 1);
  assert.equal(P.sanitize({ volume: -6.3 }).volume, -6.5);
});

test("format: short on screen, spelled out for screen readers", () => {
  const f = P.format;
  assert.equal(f(P.BY_ID.cutoff, 4000), "4 kHz");
  assert.equal(f(P.BY_ID.cutoff, 4000, true), "4 kilohertz");
  assert.equal(f(P.BY_ID.cutoff, 440), "440 Hz");
  assert.equal(f(P.BY_ID.attack, 0.005), "5 ms");
  assert.equal(f(P.BY_ID.release, 1.25, true), "1.25 seconds");
  assert.equal(f(P.BY_ID.sustain, 0.7), "70%");
  assert.equal(f(P.BY_ID.volume, -6, true), "minus 6 decibels");
  assert.equal(f(P.BY_ID.volume, -48), "−∞ dB");
  assert.equal(f(P.BY_ID.detune, 12), "+12 ct");
  assert.equal(f(P.BY_ID.octave, -1, true), "minus 1 octave");
  assert.equal(f(P.BY_ID.octave, 2, true), "plus 2 octaves");
  assert.equal(f(P.BY_ID.filterEnv, 0), "Off");
  assert.equal(f(P.BY_ID.wave, "pulse12", true), "Pulse 12.5 percent");
  assert.equal(f(P.BY_ID.wave, "sawtooth"), "Saw");
});

test("sanitize fills gaps and throws out junk", () => {
  const p = P.sanitize({ wave: "kazoo", cutoff: 99999, attack: "fast", resonance: NaN, filterType: "highpass" });
  assert.equal(p.wave, P.BY_ID.wave.def);
  assert.equal(p.cutoff, P.BY_ID.cutoff.max);
  assert.equal(p.attack, P.BY_ID.attack.def);
  assert.equal(p.resonance, P.BY_ID.resonance.def);
  assert.equal(p.filterType, "highpass");
  assert.deepEqual(P.sanitize(null), P.defaults());
});
