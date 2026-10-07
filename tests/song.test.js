const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/state/song.js");

const lead = (s) => S.track(s, "lead");

test("a new song: four empty tracks with colors, looping bars 1-4", () => {
  const s = S.createSong();
  assert.deepEqual(s.tracks.map((t) => t.id), ["lead", "bass", "pad", "hat"]);
  assert.equal(s.version, 3);
  for (const t of s.tracks) {
    assert.deepEqual(t.clips, []);
    assert.ok(S.COLORS.includes(t.color));
  }
  assert.deepEqual(s.loop, { on: true, start: 0, end: 4 });
  assert.equal(S.songBars(s), 0);
  assert.equal(S.viewBars(s), S.MIN_VIEW, "an empty song still shows 8 bars");
});

test("adding clips: new content each time, named after the track, never overlapping", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 1);
  const b = S.addClip(s, lead(s), 2, 4);
  assert.equal(S.content(s, a).name, "Lead 1");
  assert.equal(S.content(s, b).name, "Lead 2");
  assert.equal(S.content(s, b).bars, 4, "a 4-bar clip loops 4 bars of content");
  assert.equal(S.content(s, S.addClip(s, lead(s), 8, 3)).bars, 2, "3 bars loops the biggest that fits: 2");
  assert.equal(S.addClip(s, lead(s), 1, 2), null, "bars 2-3 would overlap the clip at bar 3");
  assert.deepEqual(lead(s).clips.map((c) => c.start), [0, 2, 8], "kept in order");
});

test("moving and stretching stop at the neighbours", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 1);
  S.addClip(s, lead(s), 4, 2);
  assert.equal(S.moveClip(lead(s), a, 10), 3, "slides up to the next clip");
  assert.equal(S.moveClip(lead(s), a, -5), 0, "and no further left than bar 1");
  assert.equal(S.resizeClip(lead(s), a, 9), 4, "stretches up to the next clip");
  assert.equal(S.resizeClip(lead(s), a, 0), 1, "never shorter than a bar");
});

test("linked clips share content; removing the last one removes the content", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 1);
  const b = S.addClip(s, lead(s), 1, 1, a.contentId);
  assert.equal(S.linkCount(s, a.contentId), 2);
  S.toggleNote(S.content(s, a), 0, 60);
  assert.ok(S.hasNote(S.content(s, b), 0, 60), "an edit shows in every linked clip");
  S.removeClip(s, lead(s), a);
  assert.ok(s.contents[b.contentId], "still used by b");
  S.removeClip(s, lead(s), b);
  assert.equal(s.contents[b.contentId], undefined);
});

test("a clip longer than its content repeats it", () => {
  const s = S.createSong();
  const clip = S.addClip(s, lead(s), 2, 1);
  S.resizeClip(lead(s), clip, 3);
  S.toggleNote(S.content(s, clip), 4, 64);
  const at = (bar, step) => S.notesAtPos(s, lead(s), bar * 16 + step);
  assert.deepEqual(at(2, 4), [64]);
  assert.deepEqual(at(3, 4), [64], "second bar repeats the 1-bar content");
  assert.deepEqual(at(4, 4), [64]);
  assert.deepEqual(at(5, 4), [], "past the clip: silence");
  assert.deepEqual(at(1, 4), [], "before the clip: silence");
});

test("notes: toggle, record without duplicates, undo a take, shrink the loop", () => {
  const s = S.createSong();
  const c = S.content(s, S.addClip(s, lead(s), 0, 2));
  assert.equal(S.toggleNote(c, 0, 60), true);
  assert.equal(S.addNote(c, 0, 60), false, "already there");
  S.addNote(c, 4, 62);
  S.addNote(c, 20, 64);
  S.removeNotes(c, [{ step: 4, midi: 62 }]);
  assert.deepEqual(c.notes.map((n) => n.step), [0, 20]);
  S.setContentBars(c, 1);
  assert.deepEqual(c.notes, [{ step: 0, midi: 60 }], "the note in bar 2 goes with it");
});

test("play range: the loop, or the cursor to the end of the song", () => {
  const s = S.createSong();
  S.addClip(s, lead(s), 0, 6);
  assert.deepEqual(S.playRange(s), { start: 0, end: 4, repeat: true });
  s.loop.on = false;
  s.cursor = 2;
  assert.deepEqual(S.playRange(s), { start: 2, end: 6, repeat: false });
  s.cursor = 9;
  assert.deepEqual(S.playRange(s), { start: 9, end: 10, repeat: false }, "past the end still plays a bar");
  assert.equal(S.viewBars(s), 10, "the timeline grows to show the cursor");
});

test("solo beats mute; with nothing soloed, muted tracks drop out", () => {
  const s = S.createSong();
  S.track(s, "bass").mute = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["lead", "pad", "hat"]);
  S.track(s, "hat").solo = true;
  S.track(s, "bass").solo = true;
  assert.deepEqual(S.audible(s).map((t) => t.id), ["bass", "hat"]);
});

test("the demo: 8 bars on every track, hats change clip at bar 5, loop over all 8", () => {
  const s = S.demoSong();
  assert.equal(S.songBars(s), 8);
  const hat = S.track(s, "hat");
  assert.equal(S.content(s, S.clipAt(hat, 2)).name, "Hats");
  assert.equal(S.content(s, S.clipAt(hat, 5)).name, "Hats busy");
  assert.deepEqual(s.loop, { on: true, start: 0, end: 8 });
  assert.deepEqual(S.sanitize(JSON.parse(JSON.stringify(s))), s, "survives a save and load unchanged");
});

test("an arrangement-era save becomes linked clips and sounds the same", () => {
  const old = {
    bpm: 120, mode: "song", selected: "hat",
    tracks: [{
      id: "hat", slot: "B",
      patterns: { A: [{ step: 0, midi: 72 }], B: [{ step: 0, midi: 72 }, { step: 8, midi: 72 }], C: [], D: [] },
      arrange: ["A", "A", "B", null, "A", ...Array(11).fill(null)],
    }],
  };
  const s = S.sanitize(old);
  const hat = S.track(s, "hat");
  assert.deepEqual(hat.clips.map((c) => [c.start, c.length]), [[0, 2], [2, 1], [4, 1]], "runs of one pattern merge");
  assert.equal(hat.clips[0].contentId, hat.clips[2].contentId, "both A clips are linked");
  assert.deepEqual(S.notesAtPos(s, hat, 2 * 16 + 8), [72], "bar 3 plays pattern B");
  assert.deepEqual(s.loop, { on: true, start: 0, end: 5 });
  assert.equal(s.selected, "hat");
});

test("a save from before slots: its notes become a 1-bar clip", () => {
  const s = S.sanitize({ tracks: [{ id: "lead", notes: [{ step: 2, midi: 60 }] }] });
  const c = lead(s).clips[0];
  assert.deepEqual([c.start, c.length], [0, 1]);
  assert.deepEqual(S.content(s, c).notes, [{ step: 2, midi: 60 }]);
});

test("sanitize repairs a damaged save", () => {
  const s = S.sanitize({
    version: 3, bpm: 999, master: -3.2, title: "  My song  ", nextId: 50,
    contents: {
      n1: { trackId: "lead", name: "", bars: 3, notes: [{ step: 0, midi: 60 }, { step: 0, midi: 60 }, { step: 99, midi: 60 }, "junk"] },
      n2: { trackId: "ghost", bars: 1, notes: [] },
      n3: { trackId: "lead", name: "Unused", bars: 1, notes: [] },
    },
    tracks: [{
      id: "lead", color: "plaid", volume: 30, pan: -2, mute: "yes", solo: true,
      clips: [{ id: "c1", contentId: "n1", start: 0, length: 2 }, { id: "c2", contentId: "n1", start: 1, length: 1 }, { contentId: "n2", start: 4, length: 1 }],
    }],
    loop: { on: false, start: 3, end: 2 },
  });
  assert.equal(s.bpm, S.BPM.max);
  assert.equal(s.master, -3);
  assert.equal(s.title, "My song");
  const t = lead(s);
  assert.deepEqual(t.clips.map((c) => c.id), ["c1"], "the overlapping clip and the other track's content are dropped");
  assert.deepEqual(s.contents.n1, { id: "n1", trackId: "lead", name: "Clip", bars: 1, notes: [{ step: 0, midi: 60 }] });
  assert.equal(s.contents.n3, undefined, "content no clip uses is dropped");
  assert.equal(t.color, "orange");
  assert.equal(t.volume, S.FADER.max);
  assert.equal(t.pan, -1);
  assert.equal(t.mute, false);
  assert.equal(t.solo, true);
  assert.deepEqual(s.loop, { on: true, start: 0, end: 4 }, "a backwards loop falls back to the default");
  assert.deepEqual(S.sanitize("nonsense"), S.createSong());
});
