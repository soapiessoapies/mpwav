// The song: tempo, and a set of tracks. Each track is one synth sound with
//   - four pattern slots (A-D), each a 1-bar pattern of notes on a 16-step grid,
//     and which slot is being edited;
//   - its arrangement: which slot plays in each of the song's 16 bars;
//   - its mixer settings (fader, pan, mute, solo).
// The song plays either the edited patterns on repeat ("loop") or the
// arrangement from bar 1 ("song"). Plain data, so it can be saved as JSON
// and tested in Node.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Params = node ? require("../audio/params.js") : root.Params;
  const Presets = node ? require("./presets.js") : root.Presets;

  const STEPS = 16; // per bar (sixteenth notes)
  const BARS = 16;  // in the arrangement
  const SLOTS = ["A", "B", "C", "D"];
  const MODES = ["loop", "song"];
  const BPM = { min: 40, max: 240, def: 110 };
  const FADER = { min: -48, max: 6, step: 0.5, def: 0 }; // dB; the bottom is off
  const LOWEST = 24, HIGHEST = 108; // C1..C8, the range notes and grid rows can use
  const LENGTHS = [1, 2, 4, 8, 16]; // how many steps each note lasts

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const emptyPatterns = () => Object.fromEntries(SLOTS.map((s) => [s, []]));

  function createTrack({ id, name, preset, gridBase = 60, length = 1 }) {
    return {
      id, name, preset,
      params: Params.sanitize(Presets.find(preset).params),
      patterns: emptyPatterns(), // slot -> [{ step, midi }]
      slot: "A",                 // the pattern being edited (and looped)
      arrange: new Array(BARS).fill(null), // bar -> slot or null
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
      bars: BARS,
      mode: "loop",
      master: -4, // master fader, dB
      tracks: DEFAULT_TRACKS.map(createTrack),
      selected: DEFAULT_TRACKS[0].id,
    };
  }

  // A starter song, so Play does something on the first visit and the
  // arrangement has an example in it: 4 bars of everything on A, then 4
  // more with the hats doubled up (pattern B).
  function demoSong() {
    const s = createSong();
    const t = (id) => s.tracks.find((x) => x.id === id);
    const put = (id, slot, notes) => t(id).patterns[slot].push(...notes.map(([step, midi]) => ({ step, midi })));
    put("hat", "A", [0, 2, 4, 6, 8, 10, 12, 14].map((st) => [st, 72]));
    put("hat", "B", [...Array(16).keys()].map((st) => [st, 72]));
    put("bass", "A", [[0, 48], [3, 48], [6, 55], [8, 53], [11, 53], [14, 55]]);
    put("lead", "A", [[0, 72], [2, 67], [4, 69], [6, 72], [8, 71], [10, 72], [12, 69], [14, 67]]);
    put("pad", "A", [[0, 60], [0, 64], [0, 67], [8, 57], [8, 60], [8, 64]]);
    for (let bar = 0; bar < 8; bar++) {
      for (const id of ["lead", "bass", "pad"]) t(id).arrange[bar] = "A";
      t("hat").arrange[bar] = bar < 4 ? "A" : "B";
    }
    t("lead").volume = -3;
    t("pad").volume = -6;
    return s;
  }

  const track = (song, id) => song.tracks.find((t) => t.id === id) || song.tracks[0];
  const notesOf = (t, slot = t.slot) => t.patterns[slot];
  const hasNote = (t, step, midi, slot = t.slot) => notesOf(t, slot).some((n) => n.step === step && n.midi === midi);
  const notesAt = (t, step, slot = t.slot) => notesOf(t, slot).filter((n) => n.step === step).map((n) => n.midi);

  // Adds the note if it isn't there, removes it if it is. Returns whether it's on now.
  function toggleNote(t, step, midi, slot = t.slot) {
    const notes = notesOf(t, slot);
    const i = notes.findIndex((n) => n.step === step && n.midi === midi);
    if (i >= 0) { notes.splice(i, 1); return false; }
    notes.push({ step, midi });
    return true;
  }

  // Adds a note unless it's already there (recording). Returns whether it was added.
  function addNote(t, step, midi, slot = t.slot) {
    if (hasNote(t, step, midi, slot)) return false;
    notesOf(t, slot).push({ step, midi });
    return true;
  }

  // Takes notes back out (undoing a recorded take).
  function removeNotes(t, slot, notes) {
    t.patterns[slot] = t.patterns[slot].filter((n) => !notes.some((m) => m.step === n.step && m.midi === n.midi));
  }

  // The next choice when a bar in the arrangement is tapped: empty, A, B, C, D, empty...
  function nextSlot(slot) {
    const i = SLOTS.indexOf(slot);
    return i < 0 ? SLOTS[0] : i === SLOTS.length - 1 ? null : SLOTS[i + 1];
  }

  // How many bars the song runs: up to the last bar anything plays in.
  function songBars(song) {
    let last = -1;
    for (const t of song.tracks) t.arrange.forEach((s, bar) => { if (s && bar > last) last = bar; });
    return last + 1;
  }

  // The slot a track plays in a given bar: its edited pattern when looping,
  // the arrangement's choice in song mode (null: silent that bar).
  const slotFor = (song, t, bar) => (song.mode === "song" ? t.arrange[bar] : t.slot);

  // How many steps the transport runs before going round again.
  const loopSteps = (song) => (song.mode === "song" ? Math.max(1, songBars(song)) : 1) * STEPS;

  // Tracks you can hear: if anything is soloed, only the soloed ones;
  // otherwise everything that isn't muted.
  function audible(song) {
    const anySolo = song.tracks.some((t) => t.solo);
    return song.tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  }

  function cleanNotes(list) {
    return (Array.isArray(list) ? list : [])
      .filter((n) => n && Number.isInteger(n.step) && Number.isInteger(n.midi))
      .filter((n) => n.step >= 0 && n.step < STEPS && n.midi >= LOWEST && n.midi <= HIGHEST)
      .filter((n, i, all) => all.findIndex((m) => m.step === n.step && m.midi === n.midi) === i)
      .map((n) => ({ step: n.step, midi: n.midi }));
  }

  // A valid song from anything (a save from an older version, junk):
  // known tracks keep what they had, missing pieces come from the defaults.
  // Saves from before pattern slots had one `notes` list; it becomes slot A,
  // looping as before.
  function sanitize(input) {
    const out = createSong();
    if (!input || typeof input !== "object") return out;
    out.master = clamp(Math.round(num(input.master, out.master) / FADER.step) * FADER.step, FADER.min, FADER.max);
    out.bpm = Math.round(clamp(num(input.bpm, BPM.def), BPM.min, BPM.max));
    if (MODES.includes(input.mode)) out.mode = input.mode;
    const saved = Array.isArray(input.tracks) ? input.tracks : [];
    for (const t of out.tracks) {
      const s = saved.find((x) => x && x.id === t.id);
      if (!s) continue;
      if (Presets.find(s.preset)) t.preset = s.preset;
      t.params = Params.sanitize(s.params || Presets.find(t.preset).params);
      if (s.patterns && typeof s.patterns === "object") {
        for (const slot of SLOTS) t.patterns[slot] = cleanNotes(s.patterns[slot]);
      } else {
        t.patterns.A = cleanNotes(s.notes);
      }
      if (SLOTS.includes(s.slot)) t.slot = s.slot;
      if (Array.isArray(s.arrange)) {
        t.arrange = t.arrange.map((_, bar) => (SLOTS.includes(s.arrange[bar]) ? s.arrange[bar] : null));
      }
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
    STEPS, BARS, SLOTS, MODES, BPM, FADER, LOWEST, HIGHEST, LENGTHS,
    createSong, demoSong, track, notesOf, hasNote, notesAt, toggleNote, addNote, removeNotes,
    nextSlot, songBars, slotFor, loopSteps, audible, sanitize,
  };
  if (node) module.exports = api;
  else root.Song = api;
})(typeof window !== "undefined" ? window : globalThis);
