const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/state/song.js");
global.Notes = require("../src/audio/notes.js");
const C = require("../src/ui/colors.js");

const lum = (rgb) => {
  const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("colors: named ones and #rrggbb are kept, anything else isn't", () => {
  assert.equal(S.cleanColor("orange"), "orange");
  assert.equal(S.cleanColor("#3FA7B0"), "#3fa7b0");
  for (const bad of ["red", "#fff", "#12345g", "", null, 7, "var(--x)"]) assert.equal(S.cleanColor(bad), null);
});

test("custom track, clip and note colors survive saving and loading", () => {
  const s = S.createSong();
  const t = S.track(s, "lead");
  t.color = "#3fa7b0";
  const clip = S.addClip(s, t, 0, 1);
  const c = S.content(s, clip);
  c.color = "#ff00aa";
  const n = S.addNote(c, 0, 60, 2, 0.8);
  n.color = "#123456";
  S.addNote(c, 4, 62, 2, 0.8).color = "not a color";
  const back = S.sanitize(JSON.parse(JSON.stringify(s)));
  const bt = S.track(back, "lead");
  assert.equal(bt.color, "#3fa7b0");
  const bc = S.content(back, bt.clips[0]);
  assert.equal(bc.color, "#ff00aa");
  assert.equal(bc.notes.find((x) => x.step === 0).color, "#123456");
  assert.equal(bc.notes.find((x) => x.step === 4).color, undefined);
});

test("copies keep a clip's color and its notes' colors", () => {
  const s = S.createSong();
  const t = S.track(s, "lead");
  const clip = S.addClip(s, t, 0, 1);
  const c = S.content(s, clip);
  c.color = "#ff00aa";
  S.addNote(c, 0, 60, 2, 0.8).color = "#123456";
  const dup = S.duplicateClip(s, t, clip, false);
  assert.equal(S.content(s, dup).color, "#ff00aa");
  const pasted = S.pasteClip(s, t, S.copyClip(s, clip), 8);
  assert.equal(S.content(s, pasted).color, "#ff00aa");
  assert.equal(S.content(s, pasted).notes[0].color, "#123456");
  const notes = S.pasteNotes(c, S.copyNotes(c.notes), 8);
  assert.equal(notes[0].color, "#123456");
});

test("text on any color reads at 4.5:1 or better (custom colors can be anything)", () => {
  let worst = Infinity;
  for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
    const ink = rgb(C.inkFor([r, g, b]));
    worst = Math.min(worst, ratio([r, g, b], ink));
  }
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}:1`);
});

test("note names read on every key's shade of every palette color", () => {
  // The palette lives in color-pick.js (a browser file): its hexes, read from the source.
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/ui/color-pick.js"), "utf8");
  const hexes = [...src.matchAll(/\["(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.equal(hexes.length, 24);
  for (const hex of hexes) {
    for (let pc = 0; pc < 12; pc++) {
      const shade = C.shades(hex)[pc];
      const r = ratio(shade, rgb(C.inkFor(shade)));
      assert.ok(r >= 4.5, `${hex}, key ${pc}: ${r.toFixed(2)}:1`);
    }
  }
  assert.equal(C.cssOf("#3fa7b0"), "#3fa7b0");
  assert.equal(C.cssOf("mint"), "var(--c-mint)");
});
