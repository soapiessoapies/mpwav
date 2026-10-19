const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Slides = require("../src/ui/slides.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PANELS = ["playbox", "clip-editor", "note-edit", "keys-section"];

test("the slides: All first, then the steps of making a song, each with a name and a line to read out", () => {
  assert.deepEqual(Slides.LIST.map((s) => s.id), ["all", "make", "arrange", "edit", "sound", "mix"]);
  for (const s of Slides.LIST) {
    assert.ok(s.name && s.about, s.id);
    assert.ok(s.panels.length && s.panels.every((p) => PANELS.includes(p)), s.id + " shows real panels");
  }
  assert.deepEqual(Slides.find("all").panels, PANELS, "All shows everything");
});

test("an unknown slide falls back to All", () => {
  assert.equal(Slides.find("nope").id, "all");
  assert.equal(Slides.find(undefined).id, "all");
});

test("every slide's Note Edit page exists", () => {
  const html = read("index.html");
  for (const s of Slides.LIST) if (s.page) assert.ok(html.includes(`id="${s.page}"`), `${s.id}: ${s.page}`);
});

test("the stylesheet hides exactly the panels each slide leaves out", () => {
  const css = read("styles/main.css");
  for (const s of Slides.LIST) {
    for (const p of PANELS) {
      // The panel itself (not something inside it), alone or in a list of selectors.
      const hidden = new RegExp(`\\[data-slide="${s.id}"\\] #${p}\\s*(,[^{]*)?\\{[^}]*display: none`).test(css);
      assert.equal(hidden, !s.panels.includes(p), `${s.id} / ${p}`);
    }
  }
});

test("the switcher numbers the five steps; All is reached from Settings", () => {
  assert.deepEqual(Slides.STEPS.map((s) => s.id), ["make", "arrange", "edit", "sound", "mix"]);
  const html = read("index.html");
  assert.ok(html.includes('id="all-panels"'), "Settings has Show all panels at once");
});

test("each workspace offers only its own Note Edit pages, and opens on one of them", () => {
  const html = read("index.html");
  for (const s of Slides.STEPS) {
    assert.ok(Array.isArray(s.pages) && s.pages.length, s.id);
    assert.ok(s.pages.includes(s.page), `${s.id} opens on a page it offers`);
    for (const p of s.pages) assert.ok(html.includes(`id="${p}"`), `${s.id}: ${p}`);
  }
  assert.equal(Slides.find("all").pages, undefined, "All offers every page");
});

test("every workspace has its own color, and its text reads on it", () => {
  const css = read("styles/main.css");
  const hex = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i")) || [])[1];
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ink = hex("ws-ink");
  const seen = new Set();
  for (const s of Slides.STEPS) {
    const c = hex("ws-" + s.id);
    assert.ok(c, `--ws-${s.id} is set`);
    assert.ok(!seen.has(c), `${s.id} has a color of its own`);
    seen.add(c);
    const r = (Math.max(lum(c), lum(ink)) + 0.05) / (Math.min(lum(c), lum(ink)) + 0.05);
    assert.ok(r >= 4.5, `--ws-ink on --ws-${s.id}: ${r.toFixed(2)}:1`);
    assert.ok(css.includes(`.slide-btn[data-slide="${s.id}"]`), `${s.id}'s button wears its color`);
  }
});
