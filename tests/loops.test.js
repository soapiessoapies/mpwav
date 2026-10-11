// Starter loops: every genre's parts are valid 4-bar clips, melodic parts
// follow the song's key, and a song built from a genre survives a save.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Loops = require("../src/state/loops.js");
const Song = require("../src/state/song.js");
const Presets = require("../src/state/presets.js");

test("every genre has drums, bass, chords and lead as valid 4-bar parts", () => {
  assert.ok(Loops.GENRES.length >= 5);
  for (const g of Loops.GENRES) {
    assert.deepEqual(g.parts.map((p) => p.id), ["drums", "bass", "chords", "lead"], g.id);
    for (const p of g.parts) {
      if (p.preset) assert.ok(Presets.find(p.preset), `${g.id} ${p.id}: ${p.preset}`);
      const notes = Loops.partNotes(p, g.key);
      assert.ok(notes.length > 0);
      for (const n of notes) {
        assert.ok(n.step >= 0 && n.step < Loops.BARS * 16, `${g.id} ${p.id} step ${n.step}`);
        assert.ok(n.len >= 1 && n.midi >= Song.LOWEST && n.midi <= Song.HIGHEST, `${g.id} ${p.id} ${n.midi}`);
      }
    }
  }
});

test("melodic parts land in the song's key", () => {
  const g = Loops.GENRES.find((x) => x.id === "synthwave");
  const lead = g.parts.find((p) => p.id === "lead");
  const song = Song.createSong();
  song.key = { root: 2, scale: "major", keep: false }; // D major
  const key = Loops.keyFor(song, g);
  assert.deepEqual(key, { root: 2, scale: "major" });
  const dMajor = new Set([2, 4, 6, 7, 9, 11, 1]);
  for (const n of Loops.partNotes(lead, key)) assert.ok(dMajor.has(n.midi % 12), `${n.midi} not in D major`);
});

test("a song with no scale takes the genre's scale on its root", () => {
  const g = Loops.GENRES.find((x) => x.id === "house"); // minor
  const song = Song.createSong(); // C, no scale
  assert.deepEqual(Loops.keyFor(song, g), { root: g.key.root, scale: "minor" });
});

test("a song built from a genre keeps its tracks and clips through a save", () => {
  const g = Loops.GENRES[0];
  const s = Song.createSong();
  s.tracks = [];
  for (const part of g.parts) {
    const t = part.kind === "drums" ? Song.addTrack(s, { kind: "drums" }) : Song.addTrack(s, { name: part.name, preset: part.preset });
    const c = Song.makeContent(s, t.id, part.name, Loops.BARS, Loops.partNotes(part, g.key));
    assert.ok(Song.addClip(s, t, 0, Loops.BARS, c.id));
  }
  s.selected = s.tracks[0].id;
  const back = Song.sanitize(JSON.parse(JSON.stringify(s)));
  assert.equal(back.tracks.length, 4);
  assert.equal(back.tracks[0].kind, "drums");
  for (const t of back.tracks) assert.equal(t.clips.length, 1);
});
