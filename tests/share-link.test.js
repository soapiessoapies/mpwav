// Share links: a song survives the trip through a link, songs with sound
// files are refused, and the fragment is found in a location.hash.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Song = require("../src/state/song.js");
const ShareLink = require("../src/state/share-link.js");

test("a song round-trips through a link, compressed", async () => {
  const song = Song.createSong();
  song.title = "Link test";
  const text = await ShareLink.encode(song);
  assert.ok(text.startsWith("v1."));
  assert.match(text, /^[A-Za-z0-9._-]+$/, "safe in a URL fragment");
  assert.deepEqual(await ShareLink.decode(text), JSON.parse(JSON.stringify(song)));
  assert.ok(text.length < JSON.stringify(song).length);
});

test("broken links are rejected", async () => {
  await assert.rejects(ShareLink.decode("v1.notasong"));
  await assert.rejects(ShareLink.decode("hello"));
});

test("finds the song in a hash and builds the link", () => {
  assert.equal(ShareLink.fromHash("#song=v1.abc"), "v1.abc");
  assert.equal(ShareLink.fromHash("#x=1&song=v1.abc"), "v1.abc");
  assert.equal(ShareLink.fromHash("#other"), null);
  assert.equal(ShareLink.linkFor("v1.abc", "https://x.io/mpwav/#old"), "https://x.io/mpwav/#song=v1.abc");
});

test("songs with sound files are shared as files instead", () => {
  const song = Song.createSong();
  assert.equal(ShareLink.usesSounds(song), false);
  song.tracks[0].sampler = { sampleId: "s1" };
  assert.equal(ShareLink.usesSounds(song), true);
});
