// Chord buttons: the right triads for a key, voiced near the keyboard.
const { test } = require("node:test");
const assert = require("node:assert/strict");
global.Notes = require("../src/audio/notes.js");
const Chords = require("../src/ui/chords.js");

test("C major gives C Dm Em F G Am Bdim with numerals", () => {
  const c = Chords.diatonic(0, "major");
  assert.deepEqual(c.map((x) => x.name), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
  assert.deepEqual(c.map((x) => x.roman), ["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
});

test("A minor gives Am Bdim C Dm Em F G", () => {
  assert.deepEqual(Chords.diatonic(9, "minor").map((x) => x.name), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
});

test("no scale and pentatonic fall back to the major key's chords; blues to minor", () => {
  assert.equal(Chords.diatonic(7, "none")[0].name, "G");
  assert.equal(Chords.diatonic(7, "pentatonic-major")[4].name, "D");
  assert.equal(Chords.diatonic(9, "blues")[0].name, "Am");
});

test("voicing puts the root within a half octave of the keyboard", () => {
  const g = Chords.diatonic(0, "major")[4];
  assert.deepEqual(Chords.voice(g, 62), [67, 71, 74]); // G B D just above D4
  for (const c of Chords.diatonic(0, "major")) {
    const v = Chords.voice(c, 62);
    assert.ok(Math.abs(v[0] - 62) <= 6, c.name);
    assert.equal(v.length, 3);
  }
});
