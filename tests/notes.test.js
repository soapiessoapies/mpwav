const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../src/audio/notes.js");

test("A4 is 440 Hz and an octave doubles it", () => {
  assert.equal(N.mtof(69), 440);
  assert.equal(N.mtof(81), 880);
  assert.ok(Math.abs(N.mtof(60) - 261.6256) < 1e-3);
});

test("names: MIDI 60 is C4, spoken names spell out sharps", () => {
  assert.equal(N.noteName(60), "C4");
  assert.equal(N.noteName(61), "C#4");
  assert.equal(N.noteName(59), "B3");
  assert.equal(N.spokenName(70), "A sharp 4");
  assert.equal(N.noteName(21), "A0");
});

test("black keys are the sharps", () => {
  const blacks = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].filter(N.isBlack).map(N.noteName);
  assert.deepEqual(blacks, ["C#4", "D#4", "F#4", "G#4", "A#4"]);
});

test("computer keys: A is the base C, K is the C above, W and E are black", () => {
  const K = N.KEY_OFFSETS;
  assert.equal(K.KeyA, 0);
  assert.equal(K.KeyK, 12);
  assert.ok(N.isBlack(60 + K.KeyW) && N.isBlack(60 + K.KeyE));
  assert.ok(!N.isBlack(60 + K.KeyF));
  const offs = Object.values(K);
  assert.equal(new Set(offs).size, offs.length, "each offset is used once");
});
