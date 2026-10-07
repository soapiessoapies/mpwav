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
  const at = (bar, step) => S.notesAtPos(s, lead(s), bar * 16 + step).map((n) => n.midi);
  assert.deepEqual(at(2, 4), [64]);
  assert.deepEqual(at(3, 4), [64], "second bar repeats the 1-bar content");
  assert.deepEqual(at(4, 4), [64]);
  assert.deepEqual(at(5, 4), [], "past the clip: silence");
  assert.deepEqual(at(1, 4), [], "before the clip: silence");
});

test("notes: add with a length and loudness, toggle, no duplicate starts, take back out", () => {
  const s = S.createSong();
  const c = S.content(s, S.addClip(s, lead(s), 0, 2));
  const n = S.addNote(c, 0, 60, 4);
  assert.deepEqual(n, { step: 0, midi: 60, len: 4, vel: S.VEL });
  assert.equal(S.addNote(c, 0, 60), null, "one note per start and pitch");
  assert.equal(S.noteAt(c, 3, 60), n, "a long note covers the steps after its start");
  assert.equal(S.noteAt(c, 4, 60), null);
  assert.equal(S.toggleNote(c, 2, 60), false, "toggling inside a long note removes it");
  assert.equal(S.toggleNote(c, 2, 60), true);
  S.addNote(c, 4, 62);
  S.addNote(c, 20, 64);
  S.removeNotes(c, [{ step: 4, midi: 62 }]);
  assert.deepEqual(c.notes.map((x) => x.step), [2, 20]);
  assert.equal(S.addNote(c, 30, 50, 8).len, 2, "a note can't run past the loop's end");
});

test("moving and stretching notes stays inside the loop and the range", () => {
  const s = S.createSong();
  const c = S.content(s, S.addClip(s, lead(s), 0, 1));
  const a = S.addNote(c, 0, 60, 4);
  const b = S.addNote(c, 8, 62, 2);
  assert.equal(S.moveNote(c, a, 14, 61), true);
  assert.deepEqual([a.step, a.midi], [12, 61], "4 steps long, so it can start no later than 12");
  assert.equal(S.moveNote(c, a, 8, 62), false, "b already starts there");
  S.moveNote(c, a, 0, 200);
  assert.equal(a.midi, S.HIGHEST);
  assert.equal(S.resizeNote(c, b, 30), 8, "up to the loop's end");
  assert.equal(S.resizeNote(c, b, 0), 1, "at least a step");
});

test("shrinking a clip's loop drops notes past the end and trims long ones", () => {
  const s = S.createSong();
  const c = S.content(s, S.addClip(s, lead(s), 0, 2));
  S.addNote(c, 12, 60, 10);
  S.addNote(c, 20, 64);
  S.setContentBars(c, 1);
  assert.deepEqual(c.notes, [{ step: 12, midi: 60, len: 4, vel: S.VEL }]);
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
  assert.deepEqual(S.notesAtPos(s, hat, 2 * 16 + 8).map((n) => n.midi), [72], "bar 3 plays pattern B");
  assert.equal(S.notesAtPos(s, hat, 2 * 16 + 8)[0].len, 1, "old notes keep the track's note length");
  assert.deepEqual(s.loop, { on: true, start: 0, end: 5 });
  assert.equal(s.selected, "hat");
});

test("a save from before slots: its notes become a 1-bar clip", () => {
  const s = S.sanitize({ tracks: [{ id: "lead", notes: [{ step: 2, midi: 60 }] }] });
  const c = lead(s).clips[0];
  assert.deepEqual([c.start, c.length], [0, 1]);
  assert.deepEqual(S.content(s, c).notes, [{ step: 2, midi: 60, len: 1, vel: S.VEL }]);
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
  assert.deepEqual(s.contents.n1, { id: "n1", trackId: "lead", name: "Clip", bars: 1, notes: [{ step: 0, midi: 60, len: 1, vel: S.VEL }] });
  assert.equal(s.contents.n3, undefined, "content no clip uses is dropped");
  assert.equal(t.color, "orange");
  assert.equal(t.volume, S.FADER.max);
  assert.equal(t.pan, -1);
  assert.equal(t.mute, false);
  assert.equal(t.solo, true);
  assert.deepEqual(s.loop, { on: true, start: 0, end: 4 }, "a backwards loop falls back to the default");
  assert.deepEqual(S.sanitize("nonsense"), S.createSong());
});

test("duplicating a clip: a copy right after it, with its own notes unless linked", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 2);
  S.toggleNote(S.content(s, a), 0, 60);
  const copy = S.duplicateClip(s, lead(s), a, false);
  assert.deepEqual([copy.start, copy.length], [2, 2]);
  assert.notEqual(copy.contentId, a.contentId);
  assert.equal(S.content(s, copy).name, "Lead 1 copy");
  S.toggleNote(S.content(s, copy), 4, 62);
  assert.equal(S.content(s, a).notes.length, 1, "the original doesn't change");
  const linked = S.duplicateClip(s, lead(s), a, true);
  assert.equal(linked.start, 4, "the next free space after the first copy");
  assert.equal(linked.contentId, a.contentId);
});

test("copy and paste a clip onto another track, at the first free bar from the cursor", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 2);
  S.toggleNote(S.content(s, a), 0, 60);
  const data = S.copyClip(s, a);
  const bass = S.track(s, "bass");
  S.addClip(s, bass, 3, 1);
  const pasted = S.pasteClip(s, bass, data, 2);
  assert.equal(pasted.start, 4, "bars 3-4 aren't free (a clip at bar 4), so it goes after");
  assert.equal(S.content(s, pasted).trackId, "bass");
  assert.deepEqual(S.content(s, pasted).notes, S.content(s, a).notes);
  assert.notEqual(pasted.contentId, a.contentId, "a pasted clip is independent");
});

test("splitting a clip keeps the music where it was", () => {
  const s = S.createSong();
  const a = S.addClip(s, lead(s), 0, 4, S.makeContent(s, "lead", "Two-bar", 2, [{ step: 20, midi: 64, len: 1, vel: 1 }]).id);
  const right = S.splitClip(s, lead(s), a, 1);
  assert.deepEqual([a.length, right.start, right.length, right.offset], [1, 1, 3, 1]);
  assert.deepEqual(S.notesAtPos(s, lead(s), 16 + 4).map((n) => n.midi), [64], "bar 2 still plays the content's second bar");
  assert.deepEqual(S.notesAtPos(s, lead(s), 48 + 4).map((n) => n.midi), [64], "and bar 4 too");
});

test("insert bars: everything from there on moves right; a clip across it is split", () => {
  const s = S.createSong();
  S.addClip(s, lead(s), 0, 4);
  S.addClip(s, S.track(s, "bass"), 5, 1);
  s.cursor = 5;
  S.insertBars(s, 2, 3);
  assert.deepEqual(lead(s).clips.map((c) => [c.start, c.length]), [[0, 2], [5, 2]]);
  assert.equal(S.track(s, "bass").clips[0].start, 8);
  assert.equal(s.cursor, 8);
  assert.deepEqual(s.loop, { on: true, start: 0, end: 7 }, "a loop around the insert grows");
});

test("delete bars: the range goes, what follows moves left", () => {
  const s = S.createSong();
  S.addClip(s, lead(s), 0, 6);
  S.addClip(s, S.track(s, "bass"), 3, 1);
  S.addClip(s, S.track(s, "bass"), 7, 1);
  S.deleteBars(s, 2, 5);
  assert.deepEqual(lead(s).clips.map((c) => [c.start, c.length, c.offset]), [[0, 2, 0], [2, 1, 1]], "the 4-bar loop carries on from its 2nd bar (offset 1)");
  assert.deepEqual(S.track(s, "bass").clips.map((c) => c.start), [4], "the clip inside the range is gone");
});

test("duplicate bars: the range is repeated right after itself with its own copies", () => {
  const s = S.demoSong();
  S.duplicateBars(s, 4, 8);
  const hat = S.track(s, "hat");
  assert.equal(S.songBars(s), 12);
  assert.deepEqual(hat.clips.map((c) => [c.start, c.length]), [[0, 4], [4, 4], [8, 4]]);
  assert.equal(S.content(s, hat.clips[2]).name, "Hats busy copy");
  assert.notEqual(hat.clips[2].contentId, hat.clips[1].contentId);
  assert.deepEqual(S.notesAtPos(s, hat, 8 * 16 + 1).map((n) => n.midi), [72], "the copy plays the busy hats");
});

test("notes: copy from the earliest, paste at a step, duplicate after the selection", () => {
  const s = S.createSong();
  const c = S.content(s, S.addClip(s, lead(s), 0, 2));
  const a = S.addNote(c, 4, 60, 2), b = S.addNote(c, 6, 64, 2);
  const data = S.copyNotes([a, b]);
  assert.deepEqual(data.notes.map((n) => n.step), [0, 2]);
  const pasted = S.pasteNotes(c, data, 12);
  assert.deepEqual(pasted.map((n) => [n.step, n.midi]), [[12, 60], [14, 64]]);
  assert.deepEqual(S.pasteNotes(c, data, 31).map((n) => n.step), [31], "the second would land past the loop");
  const dup = S.duplicateNotes(c, [a, b]);
  assert.deepEqual(dup.map((n) => n.step), [8, 10], "right after the last note ends");
});

test("duplicating the loop's bars leaves the loop on the original bars", () => {
  const s = S.demoSong(); // loop 1-8
  S.duplicateBars(s, 0, 8);
  assert.deepEqual(s.loop, { on: true, start: 0, end: 8 });
  assert.equal(S.songBars(s), 16);
});

test("deleting the loop's bars keeps a loop of the same length on what moved in", () => {
  const s = S.demoSong();
  S.duplicateBars(s, 0, 8);
  S.deleteBars(s, 0, 8);
  assert.deepEqual(s.loop, { on: true, start: 0, end: 8 });
  assert.equal(S.songBars(s), 8);
});

test("tempo changes: a jump at a bar, or a ramp arriving at it", () => {
  const s = S.createSong();
  s.bpm = 100;
  S.setTempo(s, 4, 140);
  assert.equal(S.bpmAt(s, 3 * 16 + 15), 100);
  assert.equal(S.bpmAt(s, 4 * 16), 140, "a jump");
  S.setTempo(s, 4, 140, true);
  assert.equal(S.bpmAt(s, 2 * 16), 120, "halfway through the ramp from bar 1 to bar 5");
  assert.equal(S.bpmAt(s, 4 * 16), 140);
  assert.equal(S.stepSeconds(s, 9 * 16), 60 / 140 / 4);
  S.setTempo(s, 0, 90);
  assert.equal(s.bpm, 90, "bar 1 is the song's own tempo");
  S.removeTempo(s, 4);
  assert.deepEqual(s.tempos, []);
});

test("tempo changes follow inserted and deleted bars", () => {
  const s = S.createSong();
  S.setTempo(s, 4, 140);
  S.setTempo(s, 8, 90);
  S.insertBars(s, 2, 2);
  assert.deepEqual(s.tempos.map((m) => m.bar), [6, 10]);
  S.deleteBars(s, 5, 8);
  assert.deepEqual(s.tempos.map((m) => m.bar), [7], "the change inside the deleted bars goes; the later one moves left");
  const back = S.sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.tempos, s.tempos);
  assert.deepEqual(S.sanitize({ tempos: [{ bar: 0, bpm: 99 }, { bar: 3, bpm: 999 }, { bar: 3, bpm: 50 }, "x"] }).tempos, [{ bar: 3, bpm: S.BPM.max, ramp: false }]);
});

test("adding tracks: named in order, the next unused color, up to the limit", () => {
  const s = S.createSong();
  const t = S.addTrack(s);
  assert.equal(t.name, "Track 5");
  assert.equal(t.color, "rose", "orange, mint, violet and sky are taken");
  assert.equal(t.preset, "chip-lead");
  assert.ok(/^t\d+$/.test(t.id));
  while (S.addTrack(s)) { /* fill up */ }
  assert.equal(s.tracks.length, S.MAX_TRACKS);
});

test("removing a track takes its clips with it, but never the last track", () => {
  const s = S.demoSong();
  s.selected = "pad";
  assert.equal(S.removeTrack(s, "pad"), true);
  assert.deepEqual(s.tracks.map((t) => t.id), ["lead", "bass", "hat"]);
  assert.ok(!Object.values(s.contents).some((c) => c.trackId === "pad"));
  assert.equal(s.selected, "hat", "the selection moves to a neighbour");
  S.removeTrack(s, "lead"); S.removeTrack(s, "bass");
  assert.equal(S.removeTrack(s, "hat"), false);
  assert.equal(s.tracks.length, 1);
});

test("moving tracks up and down", () => {
  const s = S.createSong();
  assert.equal(S.moveTrack(s, "pad", -1), true);
  assert.deepEqual(s.tracks.map((t) => t.id), ["lead", "pad", "bass", "hat"]);
  assert.equal(S.moveTrack(s, "lead", -1), false, "already first");
});

test("a saved song keeps its own tracks, names, colors and order", () => {
  const s = S.demoSong();
  const t = S.addTrack(s, { name: "Strings", preset: "warm-pad", color: "gold" });
  S.addClip(s, t, 2, 1);
  for (let i = 0; i < 4; i++) S.moveTrack(s, t.id, -1);
  S.removeTrack(s, "bass");
  s.tracks[1].name = "Main riff";
  s.key = { root: 9, scale: "minor", keep: true };
  s.snap = 4;
  s.swing = 0.3;
  const back = S.sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.deepEqual(back.tracks.map((x) => x.name), ["Strings", "Main riff", "Pad", "Hat"]);
});

test("key: which notes fit, and the nearest that does", () => {
  const s = S.createSong();
  assert.equal(S.inKey(s, 61), true, "no scale: everything fits");
  s.key = { root: 9, scale: "minor", keep: false }; // A minor: A B C D E F G
  assert.equal(S.inKey(s, 69), true);
  assert.equal(S.inKey(s, 70), false, "A#");
  assert.equal(S.nearestInKey(s, 70, 1), 71, "up to B");
  assert.equal(S.nearestInKey(s, 70, -1), 69, "down to A");
  assert.equal(S.nearestInKey(s, 66, 0), 67, "F# -> G, trying up first");
});

test("snap rounds a step down onto the grid", () => {
  const s = S.createSong();
  s.snap = 4;
  assert.equal(S.snapStep(s, 7), 4);
  assert.equal(S.snapStep(s, 8), 8);
});

test("sanitize repairs bad track lists, keys, snaps and swings", () => {
  const bad = S.sanitize({
    version: 3, contents: {},
    tracks: [{ id: "Bad Id!" }, { id: "x1", name: "  A very long name that goes on and on  ", color: "plaid", preset: "nope" }, { id: "x1" }],
    key: { root: 14, scale: "lydian-ish", keep: "yes" }, snap: 3, swing: 9,
  });
  assert.deepEqual(bad.tracks.map((t) => [t.id, t.name, t.color, t.preset]), [["x1", "A very long name that go", "orange", "init"]]);
  assert.deepEqual(bad.key, { root: 0, scale: "none", keep: false });
  assert.equal(bad.snap, 1);
  assert.equal(bad.swing, S.SWING_MAX);
});
