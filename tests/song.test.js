const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/state/song.js");

test("a new song has four tracks with their presets, an empty pattern and centred faders", () => {
  const s = S.createSong();
  assert.deepEqual(s.tracks.map((t) => t.id), ["lead", "bass", "pad", "hat"]);
  assert.equal(s.steps, 16);
  for (const t of s.tracks) {
    assert.deepEqual(t.notes, []);
    assert.equal(t.volume, 0);
    assert.equal(t.pan, 0);
  }
  assert.equal(S.track(s, "hat").params.wave, "noise");
  assert.equal(S.track(s, "pad").length, 8);
});

test("toggling a note adds it, toggling again removes it", () => {
  const t = S.createSong().tracks[0];
  assert.equal(S.toggleNote(t, 3, 64), true);
  assert.equal(S.hasNote(t, 3, 64), true);
  assert.deepEqual(S.notesAt(t, 3), [64]);
  assert.equal(S.toggleNote(t, 3, 64), false);
  assert.deepEqual(t.notes, []);
});

test("solo beats mute; with nothing soloed, muted tracks drop out", () => {
  const s = S.createSong();
  S.track(s, "bass").mute = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["lead", "pad", "hat"]);
  S.track(s, "hat").solo = true;
  S.track(s, "bass").solo = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["bass", "hat"]);
});

test("the demo song has notes on every track, all inside the grid", () => {
  const s = S.demoSong();
  for (const t of s.tracks) {
    assert.ok(t.notes.length > 0, t.id);
    for (const n of t.notes) assert.ok(n.step >= 0 && n.step < s.steps);
  }
  assert.deepEqual(S.sanitize(JSON.parse(JSON.stringify(s))), s, "survives a save and load unchanged");
});

test("sanitize keeps good saved values and repairs bad ones", () => {
  const s = S.sanitize({
    bpm: 999, master: -3.2, selected: "bass",
    tracks: [
      {
        id: "bass", preset: "sub-bass", params: { wave: "sine", cutoff: 500 }, gridBase: 41, length: 4,
        notes: [{ step: 0, midi: 36 }, { step: 0, midi: 36 }, { step: 99, midi: 36 }, { step: 2, midi: 7 }, "junk"],
        volume: 30, pan: -2, mute: "yes", solo: true,
      },
      { id: "ghost", notes: [{ step: 1, midi: 60 }] },
    ],
  });
  assert.equal(s.bpm, S.BPM.max);
  assert.equal(s.master, -3);
  assert.equal(s.selected, "bass");
  const b = S.track(s, "bass");
  assert.equal(b.preset, "sub-bass");
  assert.equal(b.params.cutoff, 500);
  assert.equal(b.gridBase, 36, "rows start on a C");
  assert.equal(b.length, 4);
  assert.deepEqual(b.notes, [{ step: 0, midi: 36 }], "duplicates and out-of-range notes dropped");
  assert.equal(b.volume, S.FADER.max);
  assert.equal(b.pan, -1);
  assert.equal(b.mute, false);
  assert.equal(b.solo, true);
  assert.ok(!s.tracks.some((t) => t.id === "ghost"));
  assert.deepEqual(S.sanitize("nonsense"), S.createSong());
});
