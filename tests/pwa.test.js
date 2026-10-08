// The service worker must cache everything the app needs to start, or the
// installed app breaks offline. These keep sw.js in step with index.html.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const shell = () => {
  const m = read("sw.js").match(/const SHELL = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test("every script, stylesheet and icon index.html loads is in the offline cache", () => {
  const html = read("index.html");
  const used = [...html.matchAll(/<(?:script[^>]*src|link[^>]*href)="([^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/^https?:/.test(u));
  const cached = shell();
  for (const u of used) assert.ok(cached.includes(u), `${u} is missing from SHELL in sw.js`);
});

test("every file in the offline cache exists", () => {
  for (const u of shell()) {
    if (u === "./") continue;
    assert.ok(fs.existsSync(path.join(ROOT, u)), `${u} is in SHELL but not on disk`);
  }
});

test("the manifest's icons exist and include a maskable one", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.display, "standalone");
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  assert.ok(m.icons.some((i) => i.sizes === "512x512") && m.icons.some((i) => i.sizes === "192x192"));
});
