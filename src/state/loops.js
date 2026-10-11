// Starter loops, after BandLab's Looper packs: a few genres, each a matching
// set of 4-bar parts (drums, bass, chords, lead) to start a song from or
// drop into one. Melodic parts are written in scale degrees, so they land
// in the song's key; a genre also brings its own tempo, key and swing for a
// song started from it.
//
//   Loops.GENRES                 [{ id, name, blurb, bpm, key, swing, parts[] }]
//   Loops.keyFor(song, genre)    the key a part is placed in: the song's, or
//                                the genre's scale on the song's root when
//                                the song has no 7-note scale
//   Loops.partNotes(part, key)   the part's notes in that key
(function (root) {
  "use strict";

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
  };
  const KICK = 36, SNARE = 38, CLAP = 39, HAT = 42, OPEN_HAT = 46, CRASH = 49;
  const BARS = 4;

  // --- builders: each returns { step, deg | midi, len, vel } lists ---
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  // A drum beat repeated over the bars: { midi: steps in a bar }.
  const beat = (hits, extra = []) => [
    ...range(BARS).flatMap((b) => Object.entries(hits).flatMap(([m, steps]) =>
      steps.map((st) => ({ step: b * 16 + st, midi: Number(m), len: 1, vel: Number(m) === HAT ? 0.55 : 0.85 })))),
    ...extra,
  ];
  // One chord per bar: the progression's degree plus the voicing above it.
  const chords = (prog, voicing, steps = [0], len = 16) =>
    prog.flatMap((d, b) => steps.flatMap((st) => voicing.map((v) => ({ step: b * 16 + st, deg: d + v, len, vel: 0.6 }))));
  // The chord root on the given steps of each bar.
  const roots = (prog, steps, len, octave = 0) =>
    prog.flatMap((d, b) => steps.map((st) => ({ step: b * 16 + st, deg: d + octave * 7, len, vel: 0.8 })));
  // An explicit line: [step, degree, length] across the four bars.
  const line = (notes, vel = 0.75) => notes.map(([step, deg, len]) => ({ step, deg, len, vel }));

  const GENRES = [
    {
      id: "chiptune", name: "Chiptune", blurb: "Fast 8-bit game music: bouncing bass, bright arpeggios.",
      bpm: 140, key: { root: 9, scale: "minor" }, swing: 0,
      parts: [
        { id: "drums", name: "Drums", kind: "drums", notes: beat({ [KICK]: [0, 8], [SNARE]: [4, 12], [HAT]: [0, 2, 4, 6, 8, 10, 12, 14] }) },
        { id: "bass", name: "Bass", preset: "chip-bass", base: 33, notes: roots([0, 5, 2, 6], [0, 2, 4, 6, 8, 10, 12, 14], 2).map((n, i) => ({ ...n, deg: n.deg + (i % 2) * 7 })) },
        { id: "chords", name: "Arpeggio", preset: "pluck", base: 57, notes: [0, 5, 2, 6].flatMap((d, b) => range(16).map((i) => ({ step: b * 16 + i, deg: d + [0, 2, 4, 7][i % 4], len: 1, vel: 0.5 }))) },
        { id: "lead", name: "Lead", preset: "chip-lead", base: 69, notes: line([[0, 4, 2], [2, 3, 2], [4, 2, 4], [10, 0, 2], [12, 2, 4], [16, 5, 4], [22, 4, 2], [24, 2, 8], [32, 2, 2], [34, 3, 2], [36, 4, 4], [42, 6, 2], [44, 7, 4], [48, 6, 4], [52, 4, 4], [56, 3, 8]]) },
      ],
    },
    {
      id: "lofi", name: "Lo-fi", blurb: "Slow and warm: lazy swung drums, soft seventh chords.",
      bpm: 78, key: { root: 5, scale: "major" }, swing: 0.25,
      parts: [
        { id: "drums", name: "Drums", kind: "drums", notes: beat({ [KICK]: [0, 7, 10], [SNARE]: [4, 12], [HAT]: [0, 2, 4, 6, 8, 10, 12, 14] }) },
        { id: "bass", name: "Bass", preset: "sub-bass", base: 41, notes: roots([0, 5, 1, 4], [0, 10], 6, -1) },
        { id: "chords", name: "Chords", preset: "warm-pad", base: 60, notes: chords([0, 5, 1, 4], [0, 2, 4, 6], [0], 14) },
        { id: "lead", name: "Melody", preset: "dream-bell", base: 72, notes: line([[2, 4, 2], [6, 2, 4], [18, 5, 2], [22, 4, 4], [34, 3, 2], [38, 1, 4], [42, 2, 2], [50, 6, 2], [54, 4, 6]], 0.55) },
      ],
    },
    {
      id: "house", name: "House", blurb: "Four on the floor, offbeat bass and chord stabs.",
      bpm: 124, key: { root: 7, scale: "minor" }, swing: 0,
      parts: [
        { id: "drums", name: "Drums", kind: "drums", notes: beat({ [KICK]: [0, 4, 8, 12], [CLAP]: [4, 12], [HAT]: [0, 4, 8, 12], [OPEN_HAT]: [2, 6, 10, 14] }) },
        { id: "bass", name: "Bass", preset: "acid", base: 31, notes: roots([0, 0, 5, 3], [2, 6, 10, 14], 2) },
        { id: "chords", name: "Stabs", preset: "warm-pad", base: 55, notes: chords([0, 0, 5, 3], [0, 2, 4], [3, 6, 11], 2) },
        { id: "lead", name: "Riff", preset: "pluck", base: 67, notes: line([[0, 7, 2], [3, 6, 1], [6, 4, 2], [10, 2, 2], [16, 7, 2], [19, 6, 1], [22, 4, 2], [26, 3, 2], [32, 5, 2], [35, 4, 1], [38, 2, 2], [42, 0, 2], [48, 3, 2], [51, 4, 1], [54, 6, 2], [58, 7, 4]], 0.6) },
      ],
    },
    {
      id: "hiphop", name: "Hip-hop", blurb: "Boom-bap drums, deep bass, a dusty loop on top.",
      bpm: 90, key: { root: 2, scale: "minor" }, swing: 0.15,
      parts: [
        { id: "drums", name: "Drums", kind: "drums", notes: beat({ [KICK]: [0, 3, 10], [SNARE]: [4, 12], [HAT]: [0, 2, 4, 6, 8, 10, 12, 14] }, [{ step: 63, midi: OPEN_HAT, len: 1, vel: 0.6 }]) },
        { id: "bass", name: "Bass", preset: "sub-bass", base: 38, notes: roots([0, 3, 5, 4], [0, 3, 10], 3, -1) },
        { id: "chords", name: "Keys", preset: "dream-bell", base: 62, notes: chords([0, 3, 5, 4], [0, 2, 4], [0, 8], 6) },
        { id: "lead", name: "Hook", preset: "crunch-lead", base: 74, notes: line([[0, 4, 3], [4, 3, 2], [8, 2, 6], [32, 4, 3], [36, 5, 2], [40, 4, 2], [44, 2, 4], [52, 1, 2], [56, 0, 8]], 0.6) },
      ],
    },
    {
      id: "synthwave", name: "Synthwave", blurb: "80s night drive: pulsing bass, big pads, a soaring lead.",
      bpm: 100, key: { root: 4, scale: "minor" }, swing: 0,
      parts: [
        { id: "drums", name: "Drums", kind: "drums", notes: beat({ [KICK]: [0, 8], [SNARE]: [4, 12], [HAT]: [0, 2, 4, 6, 8, 10, 12, 14] }, [{ step: 0, midi: CRASH, len: 1, vel: 0.7 }]) },
        { id: "bass", name: "Bass", preset: "chip-bass", base: 40, notes: roots([0, 5, 2, 6], range(16).map((i) => i), 1, -1) },
        { id: "chords", name: "Pad", preset: "warm-pad", base: 64, notes: chords([0, 5, 2, 6], [0, 2, 4], [0], 16) },
        { id: "lead", name: "Lead", preset: "crunch-lead", base: 76, notes: line([[0, 0, 4], [4, 2, 4], [8, 4, 6], [16, 5, 4], [20, 4, 4], [24, 2, 8], [32, 2, 4], [36, 4, 4], [40, 6, 6], [48, 7, 8], [56, 6, 8]], 0.65) },
      ],
    },
  ];

  function keyFor(song, genre) {
    const k = song && song.key;
    if (k && SCALES[k.scale]) return { root: k.root, scale: k.scale };
    return { root: k && typeof k.root === "number" && k.scale !== "none" ? k.root : genre.key.root, scale: genre.key.scale };
  }

  // Degrees counted up from the key's root nearest the part's register
  // (`base`, a MIDI note: bass low, lead high).
  function partNotes(part, key) {
    if (part.kind === "drums") return part.notes.map((n) => ({ ...n }));
    const sc = SCALES[key.scale] || SCALES.major;
    let rootNote = part.base - (((part.base % 12) + 12) % 12) + key.root;
    if (rootNote - part.base > 6) rootNote -= 12;
    if (part.base - rootNote > 6) rootNote += 12;
    return part.notes.map(({ step, deg, len, vel }) => {
      const oct = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7;
      return { step, midi: Math.max(24, Math.min(108, rootNote + sc[d] + 12 * oct)), len, vel };
    });
  }

  const Loops = { GENRES, BARS, keyFor, partNotes };
  if (typeof module !== "undefined" && module.exports) module.exports = Loops;
  else root.Loops = Loops;
})(typeof window !== "undefined" ? window : globalThis);
