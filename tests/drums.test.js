// Drum tracks: the kit's notes, keys to drums, starting beats, and a drum
// track surviving a save and load.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Drums = require("../src/audio/drums.js");
const Song = require("../src/state/song.js");

test("the kit is eight drums on General MIDI notes, kick at the bottom", () => {
  assert.equal(Drums.KIT.length, 8);
  assert.equal(Drums.KIT.at(-1).name, "Kick");
  assert.equal(Drums.KIT.at(-1).midi, 36);
  assert.ok(Drums.isDrum(38) && Drums.isDrum(42) && !Drums.isDrum(60));
  assert.equal(Drums.nameOf(46), "Open hat");
});

test("keys play drums: white keys from the keyboard's C, K crashes, pads play themselves", () => {
  const base = 60;
  const at = (offset) => Drums.nameOf(Drums.fromKey(base + offset, base));
  assert.deepEqual([0, 2, 4, 5, 7, 9, 11, 12].map(at), ["Kick", "Snare", "Clap", "Closed hat", "Open hat", "Low tom", "High tom", "Crash"]);
  assert.equal(at(1), "Kick"); // a black key plays the white key below
  assert.equal(Drums.fromKey(46, base), 46); // a MIDI drum pad's open hat
  assert.equal(Drums.nameOf(Drums.fromKey(48, 48)), "Kick"); // the keyboard's own lowest C is never the crash
});

test("every beat is drum hits inside one bar, repeated per bar", () => {
  for (const beat of Drums.BEATS) {
    const one = Drums.beatNotes(beat, 1);
    assert.ok(one.length > 0, beat.name);
    for (const n of one) {
      assert.ok(Drums.isDrum(n.midi), `${beat.name}: ${n.midi}`);
      assert.ok(n.step >= 0 && n.step < 16);
    }
    assert.equal(Drums.beatNotes(beat, 2).length, one.length * 2);
  }
});

test("a drum track keeps its kind and hits through a save and load", () => {
  const song = Song.createSong();
  const t = Song.addTrack(song, { kind: "drums" });
  assert.equal(t.kind, "drums");
  assert.equal(t.name, "Drums");
  const c = Song.makeContent(song, t.id, "Beat", 1, Drums.beatNotes(Drums.BEATS[1], 1));
  Song.addClip(song, t, 0, 4, c.id);
  const back = Song.sanitize(JSON.parse(JSON.stringify(song)));
  const t2 = back.tracks.find((x) => x.id === t.id);
  assert.equal(t2.kind, "drums");
  assert.equal(back.contents[c.id].notes.length, c.notes.length);
  assert.equal(t2.sampler, null);
});
