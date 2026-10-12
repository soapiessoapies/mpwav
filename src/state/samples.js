// Uploaded sounds (.wav, .mp3 and anything else the browser can decode).
// The files themselves live in IndexedDB, which holds far more than
// localStorage; songs only keep a sound's id. Decoded audio, reversed
// copies and waveform outlines are cached in memory by id.
//
//   add(file)        stores a File/Blob, returns its id ("snd-...")
//   load(ids)        makes sure those sounds are decoded (call before playing)
//   buffer(id, rev)  the decoded AudioBuffer (reversed if asked), or null
//   peaks(id)        a waveform outline: [min, max] pairs, or null
//   info(id)         { name, duration, rate, channels } once loaded
//   addEdited(id, chans)  stores an edited copy of sound `id` (new channels,
//                    see src/audio/wave-ops.js) and returns the copy's id
//   outline(id, rev, from, to, n)  a waveform outline of seconds from..to
//   peak(id)         the sound's loudest sample, 0..1
//   usage(keep)      what's stored: { count, bytes, unused, unusedBytes },
//                    where unused means not in `keep` (a Set of ids)
//   tidy(keep, all)  removes every stored sound not in `keep`; returns
//                    { removed, bytes }. Sounds added in the last few
//                    seconds are left alone (a song may be about to use
//                    them) unless `all` is true.
//   exportAll(ids)   { id: { name, type, data (base64) } } for a song file
//   importAll(map)   stores sounds from a song file
// Without IndexedDB (some private windows) sounds stay in memory for the visit.
(function (root) {
  "use strict";

  const DB = "mpwav", STORE = "sounds";
  const PEAKS = 1200; // points in a waveform outline
  const mem = new Map();       // id -> { name, type, bytes } (no IndexedDB)
  const decoded = new Map();   // id -> AudioBuffer
  const reversed = new Map();  // id -> AudioBuffer, played backwards
  const outlines = new Map();  // id -> Float32Array of min/max pairs
  const names = new Map();     // id -> name
  const loudest = new Map();   // id -> peak, worked out when asked
  const pending = new Map();   // id -> Promise while decoding
  const fresh = new Map();     // id -> when it was added in this visit
  const FRESH_MS = 15000;
  const missing = new Set();   // ids looked for and not found (or not decodable)

  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbp;
  }
  async function put(id, rec) {
    const d = await db();
    if (!d) { mem.set(id, rec); return; }
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).catch(() => mem.set(id, rec)); // full or blocked: keep it for this visit
  }
  async function get(id) {
    if (mem.has(id)) return mem.get(id);
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  // Decoding doesn't need sound to be on: a tiny offline context will do.
  // (Older Safari: the offline context has a webkit prefix, and decoding
  // only answers through callbacks, which every browser still supports.)
  let decoder = null;
  const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  const decoderCtx = () => (decoder = decoder || new Offline(1, 1, 44100));
  const decode = (bytes) => new Promise((resolve, reject) => {
    if (!Offline) { reject(new Error("this browser can't play sounds")); return; }
    decoderCtx().decodeAudioData(bytes.slice(0), resolve, (e) => reject(e || new Error("not a sound this browser can read")));
  });

  function outline(buf) {
    const out = new Float32Array(PEAKS * 2);
    const chans = [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c));
    const per = Math.max(1, Math.floor(buf.length / PEAKS));
    for (let i = 0; i < PEAKS; i++) {
      let lo = 0, hi = 0;
      const from = Math.floor((i * buf.length) / PEAKS);
      for (let j = from; j < Math.min(buf.length, from + per); j += Math.max(1, Math.floor(per / 64))) {
        for (const d of chans) { if (d[j] < lo) lo = d[j]; if (d[j] > hi) hi = d[j]; }
      }
      out[i * 2] = lo;
      out[i * 2 + 1] = hi;
    }
    return out;
  }

  function remember(id, rec, buf) {
    decoded.set(id, buf);
    names.set(id, rec.name);
    outlines.set(id, outline(buf));
  }

  // Stores a file and decodes it. Throws if the browser can't decode it.
  async function add(file) {
    const bytes = await file.arrayBuffer();
    const buf = await decode(bytes); // fails here for files that aren't sound
    const id = "snd-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const rec = { name: (file.name || "Sound").replace(/\.[a-z0-9]+$/i, "").slice(0, 40), type: file.type || "", bytes };
    fresh.set(id, Date.now());
    await put(id, rec);
    remember(id, rec, buf);
    return id;
  }

  // Decodes every sound in `ids` that isn't ready yet.
  function load(ids) {
    return Promise.all([...new Set(ids)].filter(Boolean).map((id) => {
      if (decoded.has(id)) return Promise.resolve(true);
      if (!pending.has(id)) {
        pending.set(id, get(id).then(async (rec) => {
          if (!rec) { missing.add(id); return false; }
          remember(id, rec, await decode(rec.bytes));
          missing.delete(id);
          return true;
        }).catch(() => { missing.add(id); return false; }).finally(() => pending.delete(id)));
      }
      return pending.get(id);
    }));
  }

  function buffer(id, rev) {
    const buf = decoded.get(id);
    if (!buf || !rev) return buf || null;
    if (!reversed.has(id)) {
      // createBuffer, not new AudioBuffer(): older Safari has no AudioBuffer constructor.
      const r = decoderCtx().createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
      reversed.set(id, r);
    }
    return reversed.get(id);
  }

  const peaks = (id) => outlines.get(id) || null;
  // Is the sound known to be absent from this browser (rather than still loading)?
  const isMissing = (id) => missing.has(id);
  const info = (id) => {
    const buf = decoded.get(id);
    return buf ? { name: names.get(id), duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels } : null;
  };
  const channels = (buf) => [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c));

  // An edit never changes a sound: it makes a copy with a new id, so undo
  // (which puts the old id back in the song) still finds the old sound.
  // The copy is ready to play straight away; storing it carries on behind.
  function addEdited(id, chans) {
    const src = decoded.get(id);
    if (!src || !chans.length || !chans[0].length) return null;
    const buf = decoderCtx().createBuffer(chans.length, chans[0].length, src.sampleRate);
    // Clipped to full scale, as the stored file will be.
    chans.forEach((d, c) => buf.getChannelData(c).set(d.map((v) => Math.max(-1, Math.min(1, v)))));
    const next = "snd-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const rec = { name: names.get(id), type: "audio/wav", bytes: Wav.encode(buf) };
    fresh.set(next, Date.now());
    remember(next, rec, buf);
    put(next, rec);
    return next;
  }

  // --- what's stored, and clearing what no song uses ---
  // Every stored sound as [id, bytes], read one at a time.
  async function stored() {
    const out = new Map([...mem].map(([id, rec]) => [id, rec.bytes.byteLength]));
    const d = await db();
    if (!d) return out;
    const keys = await new Promise((resolve) => {
      const req = d.transaction(STORE).objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    for (const id of keys) {
      const rec = await get(id);
      if (rec && rec.bytes) out.set(id, rec.bytes.byteLength);
    }
    return out;
  }
  async function usage(keep) {
    const out = { count: 0, bytes: 0, unused: 0, unusedBytes: 0 };
    for (const [id, bytes] of await stored()) {
      out.count++;
      out.bytes += bytes;
      if (!keep.has(id)) { out.unused++; out.unusedBytes += bytes; }
    }
    return out;
  }
  async function tidy(keep, all) {
    const out = { removed: 0, bytes: 0 }, now = Date.now();
    const gone = [...await stored()].filter(([id]) => !keep.has(id) && (all || !(now - (fresh.get(id) || 0) < FRESH_MS)));
    if (!gone.length) return out;
    const d = await db();
    if (d) {
      await new Promise((resolve) => {
        const tx = d.transaction(STORE, "readwrite");
        for (const [id] of gone) tx.objectStore(STORE).delete(id);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      });
    }
    for (const [id, bytes] of gone) {
      for (const m of [mem, decoded, reversed, outlines, names, loudest, fresh]) m.delete(id);
      out.removed++;
      out.bytes += bytes;
    }
    return out;
  }

  // The outline of part of a sound (seconds), as it shows when zoomed in.
  function outlineOf(id, rev, from, to, n) {
    const buf = buffer(id, rev);
    return buf ? WaveOps.outline(channels(buf), from * buf.sampleRate, to * buf.sampleRate, n) : null;
  }
  function peak(id) {
    const buf = decoded.get(id);
    if (!buf) return 0;
    if (!loudest.has(id)) loudest.set(id, WaveOps.peak(channels(buf), 0, buf.length));
    return loudest.get(id);
  }

  // --- song files carry their sounds ---
  function toBase64(bytes) {
    const u8 = new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8.buffer;
  }
  async function exportAll(ids) {
    const out = {};
    for (const id of new Set(ids)) {
      const rec = await get(id);
      if (rec) out[id] = { name: rec.name, type: rec.type, data: toBase64(rec.bytes) };
    }
    return out;
  }
  async function importAll(map) {
    if (!map || typeof map !== "object") return;
    for (const [id, s] of Object.entries(map)) {
      if (!/^snd-[a-z0-9]{1,24}$/.test(id) || !s || typeof s.data !== "string") continue;
      if (await get(id)) continue; // already here
      await put(id, { name: String(s.name || "Sound").slice(0, 40), type: String(s.type || ""), bytes: fromBase64(s.data) });
    }
  }

  root.Samples = { add, addEdited, usage, tidy, load, buffer, peaks, outline: outlineOf, peak, channels, info, isMissing, exportAll, importAll, PEAKS };
})(window);
