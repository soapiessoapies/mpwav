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
