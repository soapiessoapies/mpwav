// Uploaded sounds (.wav, .mp3 and anything else the browser can decode).
// The files themselves live in IndexedDB, which holds far more than
// localStorage; songs only keep a sound's id. Decoded audio, reversed
// copies and waveform outlines are cached in memory by id.
//
//   add(file)        stores a File/Blob, returns its id ("snd-...")
//   load(ids)        makes sure those sounds are decoded (call before playing)
//   buffer(id, rev)  the decoded AudioBuffer (reversed if asked), or null
//   peaks(id)        a waveform outline: [min, max] pairs, or null
//   info(id)         { name, duration } once loaded
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
  const pending = new Map();   // id -> Promise while decoding
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
  const info = (id) => (decoded.has(id) ? { name: names.get(id), duration: decoded.get(id).duration } : null);

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

  root.Samples = { add, load, buffer, peaks, info, isMissing, exportAll, importAll, PEAKS };
})(window);
