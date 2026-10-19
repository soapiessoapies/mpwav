// Real instruments for the keyboard: recorded notes from the free
// tonejs-instruments set (github.com/nbrosowsky/tonejs-instruments, samples
// CC BY 3.0, from VSO2, Karoryfer, the University of Iowa and Freesound; see
// CREDITS.md). Each instrument loads about eight of its recorded notes, spread
// across its range, the first time it's picked; a key plays the nearest one,
// re-pitched (never more than a few semitones). The service worker keeps
// the files, so an instrument used once also works offline.
//
// The list and the note choosing are plain data and maths (tested in Node);
// load() is the browser side.
(function (root) {
  "use strict";

  const BASE = "https://nbrosowsky.github.io/tonejs-instruments/samples/";
  const MAX_ZONES = 12; // at most this many notes loaded per instrument (about 1-2 MB)
  const LEVEL = 1.4;    // every loaded note is evened out to this peak (the recordings vary a lot)
  const SPACING = 8;    // semitones between loaded notes, so no key is re-pitched by more than 4

  // id: the folder in the set. notes: every recorded note it has.
  // program: the General MIDI instrument, for MIDI export (0-based).
  const LIST = [
    { id: "piano", name: "Piano", group: "Keys", program: 0, notes: "C1 Cs1 D1 Ds1 E1 F1 Fs1 G1 Gs1 A1 As1 B1 C2 Cs2 D2 Ds2 E2 F2 Fs2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5 Ds5 E5 F5 Fs5 G5 Gs5 A5 As5 B5 C6 Cs6 D6 Ds6 E6 F6 Fs6 G6 Gs6 A6 As6 B6 C7 Cs7 D7 Ds7 E7 F7 Fs7 G7 Gs7 A7 As7 B7 C8" },
    { id: "organ", name: "Organ", group: "Keys", program: 19, notes: "C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6" },
    { id: "harmonium", name: "Harmonium", group: "Keys", program: 20, notes: "C2 Cs2 D2 Ds2 E2 F2 Fs2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 G4 Gs4 A4 As4 B4 C5 Cs5 D5" },
    { id: "xylophone", name: "Xylophone", group: "Keys", program: 13, notes: "G4 C5 G5 C6 G6 C7 G7 C8" },
    { id: "guitar-acoustic", name: "Acoustic guitar", group: "Guitars and bass", program: 25, notes: "D2 Ds2 E2 F2 Fs2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5" },
    { id: "guitar-nylon", name: "Nylon guitar", group: "Guitars and bass", program: 24, notes: "B1 D2 E2 Fs2 Gs2 A2 B2 Cs3 D3 E3 Fs3 G3 A3 B3 Cs4 Ds4 E4 Fs4 Gs4 A4 B4 Cs5 D5 E5 Fs5 G5 Gs5 A5 As5" },
    { id: "guitar-electric", name: "Electric guitar", group: "Guitars and bass", program: 27, notes: "Cs2 E2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6" },
    { id: "bass-electric", name: "Electric bass", group: "Guitars and bass", program: 33, notes: "Cs1 E1 G1 As1 Cs2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 As4 Cs5" },
    { id: "violin", name: "Violin", group: "Strings", program: 40, notes: "G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7" },
    { id: "cello", name: "Cello", group: "Strings", program: 42, notes: "C2 D2 Ds2 E2 F2 G2 Gs2 A2 As2 B2 C3 Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 A3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 B4 C5" },
    { id: "contrabass", name: "Double bass", group: "Strings", program: 43, notes: "Fs1 G1 As1 C2 D2 E2 Fs2 Gs2 A2 Cs3 E3 Gs3 B3" },
    { id: "harp", name: "Harp", group: "Strings", program: 46, notes: "E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 B6 D7 F7" },
    { id: "flute", name: "Flute", group: "Woodwinds", program: 73, notes: "C4 E4 A4 C5 E5 A5 C6 E6 A6 C7" },
    { id: "clarinet", name: "Clarinet", group: "Woodwinds", program: 71, notes: "D3 F3 As3 D4 F4 As4 D5 F5 As5 D6 Fs6" },
    { id: "saxophone", name: "Saxophone", group: "Woodwinds", program: 65, notes: "Cs3 D3 Ds3 E3 F3 Fs3 G3 Gs3 As3 B3 C4 Cs4 D4 Ds4 E4 F4 Fs4 G4 Gs4 A4 As4 B4 C5 Cs5 D5 Ds5 E5 F5 Fs5 G5 Gs5 A5" },
    { id: "bassoon", name: "Bassoon", group: "Woodwinds", program: 70, notes: "G2 A2 C3 G3 A3 C4 E4 G4 A4 C5" },
    { id: "trumpet", name: "Trumpet", group: "Brass", program: 56, notes: "F3 A3 C4 Ds4 F4 G4 As4 D5 F5 A5 C6" },
    { id: "trombone", name: "Trombone", group: "Brass", program: 57, notes: "As1 Cs2 Ds2 F2 Gs2 As2 C3 D3 Ds3 F3 Gs3 As3 C4 Cs4 D4 Ds4 F4" },
    { id: "french-horn", name: "French horn", group: "Brass", program: 60, notes: "A1 C2 Ds2 G2 D3 F3 A3 C4 D5 F5" },
    { id: "tuba", name: "Tuba", group: "Brass", program: 58, notes: "F1 As1 Ds2 F2 As2 D3 F3 As3 D4" },
  ].map((x) => ({ ...x, notes: x.notes.split(" ") }));
  const BY_ID = Object.fromEntries(LIST.map((x) => [x.id, x]));
  const GROUPS = [...new Set(LIST.map((x) => x.group))];

  // "Cs4" -> 61 (MIDI, C4 = 60). Null for anything else.
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midiOf(name) {
    const m = /^([A-G])(s?)(-?\d)$/.exec(name);
    return m ? (Number(m[3]) + 1) * 12 + STEP[m[1]] + (m[2] ? 1 : 0) : null;
  }

  // The notes to load: walking up from the lowest recorded note, the highest
  // one within SPACING semitones of the last pick (or the next one up, across
  // a gap in the recordings), always ending on the highest. So no key is
  // re-pitched by more than SPACING / 2, except across a gap in the set.
  function pick(inst, max = MAX_ZONES) {
    const all = inst.notes.map((n) => ({ name: n, midi: midiOf(n) })).filter((z) => z.midi != null).sort((a, b) => a.midi - b.midi);
    if (all.length <= 2) return all;
    const out = [all[0]];
    for (let i = 0; out.at(-1) !== all.at(-1);) {
      let j = i + 1;
      while (j + 1 < all.length && all[j + 1].midi - all[i].midi <= SPACING) j++;
      out.push(all[j]);
      i = j;
    }
    // Too many for a very wide instrument: thin evenly, keeping both ends.
    if (out.length > max) return Array.from({ length: max }, (_, k) => out[Math.round((k * (out.length - 1)) / (max - 1))]);
    return out;
  }

  // The loaded zone that plays `midi`: the nearest recorded note (the lower
  // one on a tie, since pitching up sounds more natural than down).
  function nearest(zones, midi) {
    let best = null;
    for (const z of zones) if (!best || Math.abs(z.midi - midi) < Math.abs(best.midi - midi)) best = z;
    return best;
  }

  function peakOf(buffer) {
    let pk = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) if (v > pk || -v > pk) pk = Math.abs(v);
    return pk;
  }
  const urlOf = (id, note) => BASE + id + "/" + note + ".mp3";
  const find = (id) => BY_ID[id] || null;

  // --- the browser side: fetch + decode once, shared by live playing and export ---
  const loaded = new Map();  // id -> [{ midi, buffer }]
  const loading = new Map(); // id -> Promise
  // onProgress(done, total). Resolves to the zones, or rejects when nothing loads.
  function load(id, decode, onProgress) {
    if (loaded.has(id)) return Promise.resolve(loaded.get(id));
    if (loading.has(id)) return loading.get(id);
    const inst = find(id);
    if (!inst) return Promise.reject(new Error("No instrument " + id));
    const want = pick(inst);
    let done = 0;
    const job = Promise.all(want.map((z) => fetch(urlOf(id, z.name))
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(decode)
      .then((buffer) => ({ midi: z.midi, buffer, gain: Math.min(8, LEVEL / Math.max(1e-4, peakOf(buffer))) }), () => null)
      .finally(() => onProgress && onProgress(++done, want.length))))
      .then((zones) => {
        loading.delete(id);
        const ok = zones.filter(Boolean);
        if (!ok.length) throw new Error("Couldn't load " + inst.name);
        loaded.set(id, ok);
        return ok;
      }, (e) => { loading.delete(id); throw e; });
    loading.set(id, job);
    return job;
  }
  const zones = (id) => loaded.get(id) || null;

  const api = { LIST, GROUPS, BASE, MAX_ZONES, SPACING, find, midiOf, pick, nearest, urlOf, load, zones };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Instruments = api;
})(typeof window !== "undefined" ? window : globalThis);
