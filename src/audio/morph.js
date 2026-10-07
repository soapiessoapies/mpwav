// The morph pad's math: one point on a square moves several synth settings
// at once, between opposites.
//   X: dark  <-> bright    (filter cutoff, a little resonance on the bright side)
//   Y: tight <-> spacious  (attack, decay, sustain and release; spacious adds reverb)
// The middle of the pad leaves the track's own settings exactly as they are,
// so the pad always works on top of whatever the sliders say.
// Positions run -1..1 on each axis; 0, 0 is the middle.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Params = node ? require("./params.js") : root.Params;

  const CUTOFF_OCTAVES = 3;  // the edges move the cutoff 3 octaves either way
  const RELEASE_RANGE = 3;   // ...release up to 8x longer or shorter
  const DECAY_RANGE = 2;     // ...decay up to 4x
  const ATTACK_RANGE = 4;    // spacious softens the attack up to 16x (never sharper)

  // The settings that the pad changes (the synth refreshes just these).
  const AFFECTS = ["cutoff", "resonance", "attack", "decay", "sustain", "release", "reverb"];

  const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

  function apply(p, pos) {
    const x = clamp1(pos && pos.x), y = clamp1(pos && pos.y);
    if (!x && !y) return { ...p };
    const q = { ...p };
    q.cutoff = p.cutoff * Math.pow(2, x * CUTOFF_OCTAVES);
    if (x > 0) q.resonance = p.resonance * (1 + x * 0.5);
    q.release = p.release * Math.pow(2, y * RELEASE_RANGE);
    q.decay = p.decay * Math.pow(2, y * DECAY_RANGE);
    if (y > 0) q.attack = p.attack * Math.pow(2, y * ATTACK_RANGE);
    // Tight notes also drop their sustain (more staccato); spacious lifts it.
    q.sustain = y < 0 ? p.sustain * (1 + y * 0.7) : p.sustain + (1 - p.sustain) * y * 0.4;
    if (y > 0) q.reverb = p.reverb + (1 - p.reverb) * y * 0.5;
    return Params.sanitize(q);
  }

  // "Dark 40%", "Middle", "Bright 100%" (or spelled out for screen readers).
  function describe(axis, v, spoken) {
    const [neg, pos] = axis === "x" ? ["Dark", "Bright"] : ["Tight", "Spacious"];
    const n = Math.round(Math.abs(clamp1(v)) * 100);
    if (n === 0) return "Middle";
    return `${v < 0 ? neg : pos} ${n}${spoken ? " percent" : "%"}`;
  }

  const api = { apply, describe, AFFECTS, clamp1 };
  if (node) module.exports = api;
  else root.Morph = api;
})(typeof window !== "undefined" ? window : globalThis);
