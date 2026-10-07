const test = require("node:test");
const assert = require("node:assert/strict");
const { VERSION } = require("../src/version.js");

test("the version shown in Credits matches package.json", () => {
  assert.equal(VERSION, require("../package.json").version);
});
