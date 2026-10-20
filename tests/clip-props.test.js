const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/state/song.js");

function songWithClip() {
  const s = S.createSong();
  const t = S.track(s, "lead");
  const clip = S.addClip(s, t, 0, 2);
  const c = S.content(s, clip);
  S.addNote(c, 0, 60, 2, 0.5);
  S.addNote(c, 1, 64, 4, 0.8, { tune: 10 });
  return { s, t, clip, c };
}

test("properties change how notes play, not the notes", () => {
  const { s, t, clip, c } = songWithClip();
  S.addProp(clip, "transpose", 5);
  S.addProp(clip, "loud", 50);
  S.addProp(clip, "tune", 20);
  S.addProp(clip, "swing", 40);
  const [first] = S.notesAtPos(s, t, 0);
  assert.deepEqual([first.midi, first.vel, first.fx.tune, first.shift], [65, 0.25, 20, undefined]);
  const [second] = S.notesAtPos(s, t, 1);
  assert.equal(second.fx.tune, 30, "adds to the note's own fine tune");
  assert.equal(second.shift, 0.4, "an offbeat sixteenth swings late");
  assert.deepEqual(c.notes.map((n) => n.midi), [60, 64], "the notes themselves are unchanged");
  // Turned off, or removed: plays as before.
  clip.props.forEach((p) => { p.off = true; });
  assert.equal(S.notesAtPos(s, t, 0)[0].midi, 60);
  for (const id of ["transpose", "loud", "tune", "swing"]) S.removeProp(clip, id);
  assert.equal(clip.props, undefined);
});

test("humanize is the same every time a note plays, and stays small", () => {
  const { s, t, clip } = songWithClip();
  S.addProp(clip, "human", 100);
  const a = S.notesAtPos(s, t, 0)[0], b = S.notesAtPos(s, t, 0)[0];
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.shift) <= 0.25 && a.vel > 0 && a.vel <= 1);
});

test("properties are cleaned, saved and loaded, and kept by copies, pastes and snips", () => {
  const { s, t, clip } = songWithClip();
  clip.props = [{ id: "transpose", v: 99 }, { id: "nope", v: 1 }, { id: "transpose", v: 3 }, { id: "loud", v: 37, off: true }];
  const back = S.sanitize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(S.track(back, "lead").clips[0].props, [{ id: "transpose", v: 24 }, { id: "loud", v: 35, off: true }]);
  clip.props = S.cleanProps(clip.props);
  const dup = S.duplicateClip(s, t, clip, true);
  assert.deepEqual(dup.props, clip.props);
  dup.props[0].v = -7;
  assert.equal(clip.props[0].v, 24, "a copy's properties are its own");
  const pasted = S.pasteClip(s, t, S.copyClip(s, clip), 20);
  assert.deepEqual(pasted.props, clip.props);
  const right = S.splitApart(s, t, pasted, pasted.start + 1);
  assert.deepEqual(right.props, clip.props);
});

test("bake writes the properties into the notes, and unlinks a linked clip first", () => {
  const { s, t, clip, c } = songWithClip();
  const linked = S.duplicateClip(s, t, clip, true);
  S.addProp(linked, "transpose", 2);
  S.addProp(linked, "lenx", 50);
  S.addProp(linked, "swing", 30);
  const baked = S.bakeProps(s, t, linked);
  assert.deepEqual(baked.map((p) => p.id), ["transpose", "lenx"]);
  const own = S.content(s, linked);
  assert.notEqual(own, c, "it got its own notes");
  assert.deepEqual(own.notes.map((n) => [n.midi, n.len]), [[62, 1], [66, 2]]);
  assert.deepEqual(c.notes.map((n) => n.midi), [60, 64], "the original is untouched");
  assert.deepEqual(linked.props, [{ id: "swing", v: 30 }], "swing stays a property");
});

test("an audio clip's gain property adds to its sound's gain", () => {
  const s = S.createSong();
  const t = S.addTrack(s, { kind: "audio" });
  const clip = S.addClip(s, t, 0, 1);
  S.content(s, clip).audio = { sampleId: "snd-abc", start: 0, end: null, fadeIn: 0, fadeOut: 0, reverse: false, gain: -3, fit: false };
  S.addProp(clip, "gain", 6);
  const seg = S.audioSegment(s, t, 0, 0, () => 2, 0.125);
  assert.equal(seg.gain, 3);
});
