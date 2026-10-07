const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/state/song.js");

test("a new song: four tracks, four empty slots each, an empty 16-bar arrangement, looping", () => {
  const s = S.createSong();
  assert.deepEqual(s.tracks.map((t) => t.id), ["lead", "bass", "pad", "hat"]);
  assert.equal(s.steps, 16);
  assert.equal(s.mode, "loop");
  for (const t of s.tracks) {
    assert.deepEqual(Object.keys(t.patterns), ["A", "B", "C", "D"]);
    for (const slot of S.SLOTS) assert.deepEqual(t.patterns[slot], []);
    assert.equal(t.slot, "A");
    assert.equal(t.arrange.length, 16);
    assert.ok(t.arrange.every((x) => x === null));
    assert.equal(t.volume, 0);
  }
  assert.equal(S.track(s, "hat").params.wave, "noise");
  assert.equal(S.track(s, "pad").length, 8);
});

test("notes go into the slot being edited", () => {
  const t = S.createSong().tracks[0];
  assert.equal(S.toggleNote(t, 3, 64), true);
  assert.deepEqual(S.notesAt(t, 3), [64]);
  t.slot = "B";
  assert.deepEqual(S.notesAt(t, 3), [], "slot B is its own pattern");
  assert.equal(S.hasNote(t, 3, 64, "A"), true);
  assert.equal(S.toggleNote(t, 3, 64, "A"), false);
  assert.deepEqual(t.patterns.A, []);
});

test("recording adds without duplicating, and a take can be taken back out", () => {
  const t = S.createSong().tracks[0];
  S.toggleNote(t, 0, 60);
  assert.equal(S.addNote(t, 0, 60), false, "already there");
  assert.equal(S.addNote(t, 4, 62), true);
  assert.equal(S.addNote(t, 8, 64), true);
  S.removeNotes(t, "A", [{ step: 4, midi: 62 }, { step: 8, midi: 64 }]);
  assert.deepEqual(t.patterns.A, [{ step: 0, midi: 60 }], "only the take's notes go");
});

test("tapping a bar cycles empty, A, B, C, D, empty", () => {
  const seen = [];
  let s = null;
  for (let i = 0; i < 6; i++) { s = S.nextSlot(s); seen.push(s); }
  assert.deepEqual(seen, ["A", "B", "C", "D", null, "A"]);
});

test("loop mode plays each track's edited slot; song mode follows the arrangement", () => {
  const s = S.createSong();
  const t = s.tracks[0];
  t.slot = "C";
  t.arrange[2] = "B";
  assert.equal(S.slotFor(s, t, 2), "C");
  assert.equal(S.loopSteps(s), 16);
  s.mode = "song";
  assert.equal(S.slotFor(s, t, 2), "B");
  assert.equal(S.slotFor(s, t, 0), null);
  assert.equal(S.songBars(s), 3, "runs to the last bar used");
  assert.equal(S.loopSteps(s), 48);
  t.arrange[2] = null;
  assert.equal(S.loopSteps(s), 16, "an empty arrangement still ticks one bar");
});

test("solo beats mute; with nothing soloed, muted tracks drop out", () => {
  const s = S.createSong();
  S.track(s, "bass").mute = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["lead", "pad", "hat"]);
  S.track(s, "hat").solo = true;
  S.track(s, "bass").solo = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["bass", "hat"]);
});

test("the demo has a pattern on every track and an 8-bar arrangement using slot B", () => {
  const s = S.demoSong();
  for (const t of s.tracks) assert.ok(t.patterns.A.length > 0, t.id);
  assert.equal(S.songBars(s), 8);
  assert.equal(S.track(s, "hat").arrange[5], "B");
  assert.deepEqual(S.sanitize(JSON.parse(JSON.stringify(s))), s, "survives a save and load unchanged");
});

test("a save from before slots: its notes become pattern A", () => {
  const s = S.sanitize({ tracks: [{ id: "lead", notes: [{ step: 2, midi: 60 }] }] });
  assert.deepEqual(S.track(s, "lead").patterns.A, [{ step: 2, midi: 60 }]);
  assert.equal(s.mode, "loop");
});

test("sanitize keeps good saved values and repairs bad ones", () => {
  const s = S.sanitize({
    bpm: 999, master: -3.2, selected: "bass", mode: "party",
    tracks: [
      {
        id: "bass", preset: "sub-bass", params: { wave: "sine", cutoff: 500 }, gridBase: 41, length: 4, slot: "Z",
        patterns: { A: [{ step: 0, midi: 36 }, { step: 0, midi: 36 }, { step: 99, midi: 36 }, { step: 2, midi: 7 }, "junk"], B: "nope" },
        arrange: ["A", "Q", null, "D"],
        volume: 30, pan: -2, mute: "yes", solo: true,
      },
      { id: "ghost", notes: [{ step: 1, midi: 60 }] },
    ],
  });
  assert.equal(s.bpm, S.BPM.max);
  assert.equal(s.master, -3);
  assert.equal(s.mode, "loop");
  assert.equal(s.selected, "bass");
  const b = S.track(s, "bass");
  assert.equal(b.preset, "sub-bass");
  assert.equal(b.params.cutoff, 500);
  assert.equal(b.gridBase, 36, "rows start on a C");
  assert.equal(b.length, 4);
  assert.equal(b.slot, "A");
  assert.deepEqual(b.patterns.A, [{ step: 0, midi: 36 }], "duplicates and out-of-range notes dropped");
  assert.deepEqual(b.patterns.B, []);
  assert.deepEqual(b.arrange.slice(0, 5), ["A", null, null, "D", null]);
  assert.equal(b.arrange.length, 16);
  assert.equal(b.volume, S.FADER.max);
  assert.equal(b.pan, -1);
  assert.equal(b.mute, false);
  assert.equal(b.solo, true);
  assert.ok(!s.tracks.some((t) => t.id === "ghost"));
  assert.deepEqual(S.sanitize("nonsense"), S.createSong());
});
