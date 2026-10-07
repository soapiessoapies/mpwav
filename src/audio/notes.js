// Note math: MIDI numbers to frequencies and names, and the computer-keyboard
// layout for playing notes (the same rows Ableton uses: A W S E D F T G Y H U J K).
(function (root) {
  "use strict";

  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const SPOKEN = ["C", "C sharp", "D", "D sharp", "E", "F", "F sharp", "G", "G sharp", "A", "A sharp", "B"];

  // Semitones above the keyboard's base C, keyed by KeyboardEvent.code so the
  // layout stays put on non-QWERTY keyboards.
  const KEY_OFFSETS = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
  };

  const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const octaveOf = (midi) => Math.floor(midi / 12) - 1; // MIDI 60 is C4
  const pitchClass = (midi) => ((midi % 12) + 12) % 12;
  const isBlack = (midi) => NAMES[pitchClass(midi)].length === 2;
  const noteName = (midi) => NAMES[pitchClass(midi)] + octaveOf(midi);
  const spokenName = (midi) => SPOKEN[pitchClass(midi)] + " " + octaveOf(midi);

  const api = { NAMES, KEY_OFFSETS, mtof, octaveOf, pitchClass, isBlack, noteName, spokenName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Notes = api;
})(typeof window !== "undefined" ? window : globalThis);
