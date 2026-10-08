const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/state/library.js");

let clock = 1000;
const tick = () => (clock += 10);

test("add, list newest first, load, save, remove", () => {
  const store = L.memoryStorage();
  const lib = L.create(store, tick);
  const a = lib.add({ title: "First" });
  const b = lib.add({ title: "Second" });
  assert.deepEqual(lib.list().map((e) => e.title), ["Second", "First"]);
  assert.deepEqual(lib.load(a), { title: "First" });
  lib.save(a, JSON.stringify({ title: "First, edited" }));
  assert.deepEqual(lib.list().map((e) => e.title), ["First, edited", "Second"], "saving moves it to the top");
  lib.remove(b);
  assert.deepEqual(lib.list().map((e) => e.id), [a]);
  assert.equal(lib.load(b), null);
  assert.equal(store.getItem("sound-studio.song." + b), null, "its data is gone too");
});

test("the library survives a reload", () => {
  const store = L.memoryStorage();
  const id = L.create(store, tick).add({ title: "Kept" });
  const again = L.create(store, tick);
  assert.deepEqual(again.list().map((e) => [e.id, e.title]), [[id, "Kept"]]);
  assert.deepEqual(again.load(id), { title: "Kept" });
});

test("a one-song save from before the library becomes its first song", () => {
  const store = L.memoryStorage();
  store.setItem("sound-studio.song", JSON.stringify({ title: "Old song" }));
  const lib = L.create(store, tick);
  const id = lib.adoptLegacy();
  assert.deepEqual(lib.list().map((e) => e.title), ["Old song"]);
  assert.deepEqual(lib.load(id), { title: "Old song" });
  assert.equal(store.getItem("sound-studio.song"), null);
  assert.equal(lib.adoptLegacy(), null, "nothing left to adopt");
});

test("songs without a title are listed as Untitled song; unknown ids load nothing", () => {
  const lib = L.create(L.memoryStorage(), tick);
  lib.add({});
  assert.equal(lib.list()[0].title, "Untitled song");
  assert.equal(lib.load("nope"), null);
  assert.equal(lib.save("nope", {}), false);
});
