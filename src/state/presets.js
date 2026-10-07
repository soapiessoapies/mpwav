// Starting sounds, so a beginner can play something good before touching a
// single knob. Anything a preset leaves out uses the parameter's default.
(function (root) {
  "use strict";

  const PRESETS = [
    {
      id: "chip-lead", name: "Chip Lead",
      params: { wave: "pulse25", attack: 0.002, decay: 0.12, sustain: 0.6, release: 0.08, cutoff: 12000, volume: -9 },
    },
    {
      id: "chip-bass", name: "Chip Bass",
      params: { wave: "triangle", octave: -1, attack: 0.002, decay: 0.08, sustain: 0.9, release: 0.05, cutoff: 18000, volume: -4 },
    },
    {
      id: "warm-pad", name: "Warm Pad",
      params: { wave: "sawtooth", detune: -7, attack: 0.6, decay: 1.2, sustain: 0.8, release: 1.4, cutoff: 1200, resonance: 0.8, volume: -10, vibrato: 6, lfoRate: 5, reverb: 0.35 },
    },
    {
      id: "pluck", name: "Pluck",
      params: { wave: "sawtooth", attack: 0.002, decay: 0.3, sustain: 0, release: 0.3, cutoff: 300, resonance: 4, filterEnv: 3, volume: -6 },
    },
    {
      id: "sub-bass", name: "Sub Bass",
      params: { wave: "sine", octave: -2, attack: 0.01, decay: 0.2, sustain: 1, release: 0.15, cutoff: 18000, volume: -3 },
    },
    {
      id: "acid", name: "Acid Squelch",
      params: { wave: "square", octave: -1, attack: 0.002, decay: 0.25, sustain: 0.2, release: 0.1, cutoff: 180, resonance: 14, filterEnv: 3.5, volume: -10 },
    },
    {
      id: "noise-hat", name: "Noise Hat",
      params: { wave: "noise", octave: 2, attack: 0.001, decay: 0.06, sustain: 0, release: 0.04, filterType: "highpass", cutoff: 6000, volume: -12 },
    },
    {
      id: "wobble-bass", name: "Wobble Bass",
      params: { wave: "sawtooth", octave: -1, attack: 0.005, decay: 0.3, sustain: 0.9, release: 0.1, cutoff: 260, resonance: 6, wobble: 2.5, lfoRate: 3, drive: 0.3, volume: -8 },
    },
    {
      id: "crunch-lead", name: "Crunchy Lead",
      params: { wave: "square", attack: 0.003, decay: 0.15, sustain: 0.7, release: 0.12, cutoff: 6000, crush: 0.65, echo: 0.3, volume: -12 },
    },
    {
      id: "dream-bell", name: "Dreamy Bell",
      params: { wave: "triangle", octave: 1, attack: 0.002, decay: 0.8, sustain: 0, release: 1.2, cutoff: 9000, vibrato: 8, lfoRate: 5.5, echo: 0.35, reverb: 0.6, volume: -8 },
    },
    {
      id: "init", name: "Blank (default)",
      params: {},
    },
  ];

  const find = (id) => PRESETS.find((x) => x.id === id) || null;

  const api = { PRESETS, find };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Presets = api;
})(typeof window !== "undefined" ? window : globalThis);
