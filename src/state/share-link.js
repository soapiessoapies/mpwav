// Share by link, after Chrome Music Lab's Song Maker: the whole song,
// compressed, rides in the link's #fragment, so sending a song is copying a
// link (the fragment never reaches a server). Opening the link adds a copy
// of the song to the opener's own library.
//
// Sound files are too big for a link, so a song that uses them is shared as
// a song file instead (Home › Save song file).
//
//   ShareLink.usesSounds(song)   whether the song plays any sound file
//   ShareLink.encode(song)       the fragment text (Promise)
//   ShareLink.decode(text)       the song object back (Promise; rejects if broken)
//   ShareLink.fromHash(hash)     the encoded text in a location.hash, or null
//   ShareLink.linkFor(text, url) the full link to share
(function (root) {
  "use strict";

  const PREFIX = "v1.";

  function usesSounds(song) {
    return (song.tracks || []).some((t) => t.kind === "audio" || (t.sampler && t.sampler.sampleId)) ||
      Object.values(song.contents || {}).some((c) => c && c.audio && c.audio.sampleId);
  }

  async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  function toBase64Url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encode(song) {
    const json = new TextEncoder().encode(JSON.stringify(song));
    return PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
  }

  async function decode(text) {
    if (!text || !text.startsWith(PREFIX)) throw new Error("not an mpwav song link");
    const json = await pipe(fromBase64Url(text.slice(PREFIX.length)), new DecompressionStream("deflate-raw"));
    const song = JSON.parse(new TextDecoder().decode(json));
    if (!song || typeof song !== "object" || !Array.isArray(song.tracks)) throw new Error("not a song");
    return song;
  }

  function fromHash(hash) {
    const m = /(?:^#|&)song=([^&]+)/.exec(hash || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  function linkFor(text, url) {
    return url.split("#")[0] + "#song=" + text;
  }

  const ShareLink = { usesSounds, encode, decode, fromHash, linkFor };
  if (typeof module !== "undefined" && module.exports) module.exports = ShareLink;
  else root.ShareLink = ShareLink;
})(typeof window !== "undefined" ? window : globalThis);
