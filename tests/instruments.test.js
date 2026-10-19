const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/audio/instruments.js");
const S = require("../src/state/song.js");
const MidiFile = require("../src/state/midi-file.js");

test("note names: C4 is 60, sharps are written with s", () => {
  assert.equal(I.midiOf("C4"), 60);
  assert.equal(I.midiOf("Cs4"), 61);
  assert.equal(I.midiOf("A0"), 21);
  assert.equal(I.midiOf("H4"), null);
});

test("every instrument: known notes, a General MIDI program, a group", () => {
  assert.ok(I.LIST.length >= 19);
  for (const x of I.LIST) {
    assert.ok(x.notes.length >= 5, x.id);
    assert.ok(x.notes.every((n) => I.midiOf(n) != null), x.id);
    assert.ok(Number.isInteger(x.program) && x.program >= 0 && x.program < 128, x.id);
    assert.ok(I.GROUPS.includes(x.group));
  }
});

test("pick: a spread of notes, no key re-pitched by more than about 4 semitones", () => {
  for (const x of I.LIST) {
    const z = I.pick(x);
    assert.ok(z.length >= 2 && z.length <= I.MAX_ZONES, x.id);
    const all = x.notes.map(I.midiOf).sort((a, b) => a - b);
    assert.equal(z[0].midi, all[0], x.id + " keeps its lowest note");
    assert.equal(z.at(-1).midi, all.at(-1), x.id + " keeps its highest note");
    // No farther than half the spacing, or half the widest gap in the recordings themselves.
    const gap = Math.max(...all.slice(1).map((m, i) => m - all[i]));
    const limit = Math.max(I.SPACING / 2, Math.ceil(gap / 2));
    for (let m = all[0]; m <= all.at(-1); m++) assert.ok(Math.abs(I.nearest(z, m).midi - m) <= limit, `${x.id} ${m}`);
  }
});

test("nearest picks the closest recorded note", () => {
  const zones = [{ midi: 48 }, { midi: 60 }, { midi: 72 }];
  assert.equal(I.nearest(zones, 61).midi, 60);
  assert.equal(I.nearest(zones, 70).midi, 72);
  assert.equal(I.nearest(zones, 20).midi, 48);
});

test("a track keeps its instrument through a save; unknown ones are dropped; a sound file wins", () => {
  const s = S.createSong();
  s.tracks[0].instrument = "violin";
  s.tracks[1].instrument = "kazoo";
  const out = S.sanitize(JSON.parse(JSON.stringify(s)));
  assert.equal(out.tracks[0].instrument, "violin");
  assert.equal(out.tracks[1].instrument, null);
  const both = JSON.parse(JSON.stringify(s));
  both.tracks[0].sampler = { sampleId: "snd-abc", root: 60 };
  assert.equal(S.sanitize(both).tracks[0].instrument, null);
});

test("MIDI export names the instrument with a program change", () => {
  const s = S.createSong();
  const t = s.tracks[0];
  t.instrument = "violin";
  const c = S.addClip(s, t, 0, 1);
  S.addNote(s.contents[c.contentId], 0, 60, 4);
  const bytes = Array.from(MidiFile.encode(s, { from: 0, to: 1 }));
  const at = bytes.findIndex((b, i) => (b & 0xf0) === 0xc0 && bytes[i + 1] === 40);
  assert.ok(at > 0, "program 40 (violin) is set");
});
