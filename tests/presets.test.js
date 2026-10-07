const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/audio/params.js");
const { PRESETS, find } = require("../src/state/presets.js");

test("every preset uses real parameters with in-range values", () => {
  const ids = new Set();
  for (const pr of PRESETS) {
    assert.ok(!ids.has(pr.id), "duplicate id " + pr.id);
    ids.add(pr.id);
    for (const [k, v] of Object.entries(pr.params)) {
      assert.ok(P.BY_ID[k], `${pr.id}: unknown parameter ${k}`);
      assert.equal(P.sanitize({ [k]: v })[k], v, `${pr.id}.${k} gets changed by sanitize`);
    }
  }
});

test("find looks presets up by id", () => {
  assert.equal(find("chip-lead").name, "Chip Lead");
  assert.equal(find("nope"), null);
});
