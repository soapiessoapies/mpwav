// The song: tempo, and a set of tracks. Each track is one synth sound with
// its pattern (notes on a 16-step grid) and its mixer settings (fader, pan,
// mute, solo). Plain data, so it can be saved as JSON and tested in Node.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Params = node ? require("../audio/params.js") : root.Params;
  const Presets = node ? require("./presets.js") : root.Presets;

  const STEPS = 16;
  const BPM = { min: 40, max: 240, def: 110 };
  const FADER = { min: -48, max: 6, step: 0.5, def: 0 }; // dB; the bottom is off
  const LOWEST = 24, HIGHEST = 108; // C1..C8, the range notes and grid rows can use
  const LENGTHS = [1, 2, 4, 8, 16]; // how many steps each note lasts

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

  function createTrack({ id, name, preset, gridBase = 60, length = 1 }) {
    return {
      id, name, preset,
      params: Params.sanitize(Presets.find(preset).params),
      notes: [], // { step, midi }
      gridBase,  // lowest row shown in the pattern grid (a C)
      length,    // steps each note lasts
      morph: { x: 0, y: 0 }, // the morph pad's point, -1..1 each way (0, 0 changes nothing)
      volume: FADER.def,
      pan: 0,
      mute: false,
      solo: false,
    };
  }

  const DEFAULT_TRACKS = [
    { id: "lead", name: "Lead", preset: "chip-lead", gridBase: 60 },
    { id: "bass", name: "Bass", preset: "chip-bass", gridBase: 48, length: 2 },
    { id: "pad", name: "Pad", preset: "warm-pad", gridBase: 60, length: 8 },
    { id: "hat", name: "Hat", preset: "noise-hat", gridBase: 60 },
  ];

  function createSong() {
    return {
      bpm: BPM.def,
      steps: STEPS,
      master: -4, // master fader, dB
      tracks: DEFAULT_TRACKS.map(createTrack),
      selected: DEFAULT_TRACKS[0].id,
    };
  }

  // A short starter loop, so pressing Play does something on the first visit.
  function demoSong() {
    const s = createSong();
    const t = (id) => s.tracks.find((x) => x.id === id);
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) t("hat").notes.push({ step, midi: 72 });
    for (const [step, midi] of [[0, 48], [3, 48], [6, 55], [8, 53], [11, 53], [14, 55]]) t("bass").notes.push({ step, midi });
    for (const [step, midi] of [[0, 72], [2, 67], [4, 69], [6, 72], [8, 71], [10, 72], [12, 69], [14, 67]]) t("lead").notes.push({ step, midi });
    for (const midi of [60, 64, 67]) t("pad").notes.push({ step: 0, midi });
    for (const midi of [57, 60, 64]) t("pad").notes.push({ step: 8, midi });
    t("lead").volume = -3;
    t("pad").volume = -6;
    return s;
  }

  const track = (song, id) => song.tracks.find((t) => t.id === id) || song.tracks[0];
  const hasNote = (t, step, midi) => t.notes.some((n) => n.step === step && n.midi === midi);
  const notesAt = (t, step) => t.notes.filter((n) => n.step === step).map((n) => n.midi);

  // Adds the note if it isn't there, removes it if it is. Returns whether it's on now.
  function toggleNote(t, step, midi) {
    const i = t.notes.findIndex((n) => n.step === step && n.midi === midi);
    if (i >= 0) { t.notes.splice(i, 1); return false; }
    t.notes.push({ step, midi });
    return true;
  }

  // Tracks you can hear: if anything is soloed, only the soloed ones;
  // otherwise everything that isn't muted.
  function audible(song) {
    const anySolo = song.tracks.some((t) => t.solo);
    return song.tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  }

  // A valid song from anything (a save from an older version, junk):
  // known tracks keep what they had, missing pieces come from the defaults.
  function sanitize(input) {
    const out = createSong();
    if (!input || typeof input !== "object") return out;
    out.master = clamp(Math.round(num(input.master, out.master) / FADER.step) * FADER.step, FADER.min, FADER.max);
    out.bpm = Math.round(clamp(num(input.bpm, BPM.def), BPM.min, BPM.max));
    const saved = Array.isArray(input.tracks) ? input.tracks : [];
    for (const t of out.tracks) {
      const s = saved.find((x) => x && x.id === t.id);
      if (!s) continue;
      if (Presets.find(s.preset)) t.preset = s.preset;
      t.params = Params.sanitize(s.params || Presets.find(t.preset).params);
      t.notes = (Array.isArray(s.notes) ? s.notes : [])
        .filter((n) => n && Number.isInteger(n.step) && Number.isInteger(n.midi))
        .filter((n) => n.step >= 0 && n.step < STEPS && n.midi >= LOWEST && n.midi <= HIGHEST)
        .filter((n, i, all) => all.findIndex((m) => m.step === n.step && m.midi === n.midi) === i);
      const base = num(s.gridBase, t.gridBase);
      t.gridBase = clamp(base - (((base % 12) + 12) % 12), LOWEST, HIGHEST - 12);
      if (LENGTHS.includes(s.length)) t.length = s.length;
      if (s.morph && typeof s.morph === "object") {
        t.morph = { x: clamp(num(s.morph.x, 0), -1, 1), y: clamp(num(s.morph.y, 0), -1, 1) };
      }
      t.volume = clamp(Math.round(num(s.volume, FADER.def) / FADER.step) * FADER.step, FADER.min, FADER.max);
      t.pan = clamp(num(s.pan, 0), -1, 1);
      t.mute = s.mute === true;
      t.solo = s.solo === true;
    }
    if (out.tracks.some((t) => t.id === input.selected)) out.selected = input.selected;
    return out;
  }

  const api = {
    STEPS, BPM, FADER, LOWEST, HIGHEST, LENGTHS,
    createSong, demoSong, track, hasNote, notesAt, toggleNote, audible, sanitize,
  };
  if (node) module.exports = api;
  else root.Song = api;
})(typeof window !== "undefined" ? window : globalThis);
