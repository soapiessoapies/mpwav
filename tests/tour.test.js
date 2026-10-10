// The guided tour points at real controls: every step's element must exist
// in index.html, and each step has a title and a short text.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Tour = require("../src/ui/tour.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("every tour step points at a control that exists", () => {
  for (const step of Tour.STEPS) {
    const id = step.el.replace(/^#/, "");
    assert.ok(html.includes(`id="${id}"`), `missing #${id} for "${step.title}"`);
  }
});

test("tour steps are short and complete", () => {
  assert.ok(Tour.STEPS.length >= 5);
  for (const step of Tour.STEPS) {
    assert.ok(step.title && step.text, step.el);
    assert.ok(step.text.length <= 220, `"${step.title}" is too long to read at a glance`);
  }
});

test("Settings offers the tour again", () => {
  assert.ok(html.includes('id="tour-btn"'));
});
