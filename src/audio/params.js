// The synth's parameters, described once so the audio code, the controls and
// the presets all agree. Sliders are native range inputs running 0..STEPS;
// toPos / fromPos map that onto each parameter's real range (log for times and
// frequencies, so the useful low end gets most of the slider). format() gives
// the value as text: short for the screen, spelled out for screen readers.
(function (root) {
  "use strict";

  const STEPS = 1000;

  const WAVES = [
    { id: "sine", label: "Sine" },
    { id: "triangle", label: "Triangle" },
    { id: "square", label: "Square" },
    { id: "pulse25", label: "Pulse 25%", spoken: "Pulse 25 percent" },
    { id: "pulse12", label: "Pulse 12.5%", spoken: "Pulse 12.5 percent" },
    { id: "sawtooth", label: "Saw", spoken: "Sawtooth" },
    { id: "noise", label: "Noise" },
  ];

  const FILTERS = [
    { id: "lowpass", label: "Low-pass" },
    { id: "highpass", label: "High-pass" },
    { id: "bandpass", label: "Band-pass" },
  ];

  const DEFS = [
    { id: "wave", label: "Waveform", group: "osc", kind: "choice", options: WAVES, def: "sawtooth" },
    { id: "octave", label: "Octave", group: "osc", kind: "range", min: -3, max: 3, step: 1, def: 0, unit: "oct" },
    { id: "detune", label: "Fine tune", group: "osc", kind: "range", min: -100, max: 100, step: 1, def: 0, unit: "cents" },
    { id: "attack", label: "Attack", group: "env", kind: "range", min: 0.001, max: 2, scale: "log", def: 0.005, unit: "s" },
    { id: "decay", label: "Decay", group: "env", kind: "range", min: 0.01, max: 3, scale: "log", def: 0.2, unit: "s" },
    { id: "sustain", label: "Sustain", group: "env", kind: "range", min: 0, max: 1, def: 0.7, unit: "%" },
    { id: "release", label: "Release", group: "env", kind: "range", min: 0.01, max: 4, scale: "log", def: 0.25, unit: "s" },
    { id: "filterType", label: "Filter type", group: "filter", kind: "choice", options: FILTERS, def: "lowpass" },
    { id: "cutoff", label: "Cutoff", group: "filter", kind: "range", min: 40, max: 18000, scale: "log", def: 4000, unit: "Hz" },
    { id: "resonance", label: "Resonance", group: "filter", kind: "range", min: 0.1, max: 20, scale: "log", def: 1, unit: "q" },
    { id: "filterEnv", label: "Envelope amount", group: "filter", kind: "range", min: 0, max: 4, def: 0, unit: "octaves" },
    { id: "volume", label: "Volume", group: "out", kind: "range", min: -48, max: 0, step: 0.5, def: -6, unit: "dB" },
    // Warp: movement and effects. Every one is off at its default.
    { id: "lfoRate", label: "Wobble speed", group: "warp", kind: "range", min: 0.1, max: 16, scale: "log", def: 4, unit: "rate" },
    { id: "vibrato", label: "Vibrato", group: "warp", kind: "range", min: 0, max: 100, step: 1, def: 0, unit: "depth" },
    { id: "wobble", label: "Filter wobble", group: "warp", kind: "range", min: 0, max: 4, def: 0, unit: "octaves" },
    { id: "drive", label: "Drive", group: "warp", kind: "range", min: 0, max: 1, def: 0, unit: "amount" },
    { id: "crush", label: "Bit crush", group: "warp", kind: "range", min: 0, max: 1, def: 0, unit: "amount" },
    { id: "echo", label: "Echo", group: "warp", kind: "range", min: 0, max: 1, def: 0, unit: "amount" },
    { id: "reverb", label: "Reverb", group: "warp", kind: "range", min: 0, max: 1, def: 0, unit: "amount" },
  ];

  const BY_ID = Object.fromEntries(DEFS.map((d) => [d.id, d]));

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function snap(def, v) {
    v = clamp(v, def.min, def.max);
    return def.step ? Math.round(v / def.step) * def.step : v;
  }

  // Slider position (0..STEPS) for a value.
  function toPos(def, value) {
    const v = clamp(value, def.min, def.max);
    const t = def.scale === "log"
      ? Math.log(v / def.min) / Math.log(def.max / def.min)
      : (v - def.min) / (def.max - def.min);
    return Math.round(t * STEPS);
  }

  // Value for a slider position.
  function fromPos(def, pos) {
    const t = clamp(pos, 0, STEPS) / STEPS;
    const v = def.scale === "log"
      ? def.min * Math.pow(def.max / def.min, t)
      : def.min + t * (def.max - def.min);
    return snap(def, v);
  }

  // Up to 3 significant figures, without trailing zeros.
  const num = (v) => String(Number(v.toPrecision(3)));
  const signed = (v, s) => (v > 0 ? (s ? "plus " : "+") : v < 0 ? (s ? "minus " : "−") : "") + num(Math.abs(v));

  function format(def, value, spoken) {
    if (def.kind === "choice") {
      const o = def.options.find((x) => x.id === value) || def.options[0];
      return spoken && o.spoken ? o.spoken : o.label;
    }
    const s = !!spoken;
    switch (def.unit) {
      case "s":
        return value < 1
          ? num(value * 1000) + (s ? " milliseconds" : " ms")
          : num(value) + (s ? " seconds" : " s");
      case "Hz":
        return value < 1000
          ? Math.round(value) + (s ? " hertz" : " Hz")
          : num(value / 1000) + (s ? " kilohertz" : " kHz");
      case "%":
        return Math.round(value * 100) + (s ? " percent" : "%");
      case "dB":
        return value === def.min ? (s ? "silent" : "−∞ dB") : signed(value, s) + (s ? " decibels" : " dB");
      case "cents":
        return signed(value, s) + (s ? " cents" : " ct");
      case "oct":
        return value === 0 ? (s ? "no shift" : "0") : signed(value, s) + (s ? (Math.abs(value) === 1 ? " octave" : " octaves") : "");
      case "rate":
        return num(value) + (s ? " hertz" : " Hz");
      case "depth":
        return value === 0 ? (s ? "off" : "Off") : Math.round(value) + (s ? " cents" : " ct");
      case "amount":
        return value === 0 ? (s ? "off" : "Off") : Math.round(value * 100) + (s ? " percent" : "%");
      case "octaves":
        return value === 0 ? (s ? "off" : "Off") : num(value) + (s ? " octaves" : " oct");
      default:
        return num(value);
    }
  }

  function defaults() {
    return Object.fromEntries(DEFS.map((d) => [d.id, d.def]));
  }

  // A full, in-range parameter set from anything (a preset, a saved file):
  // missing or bad values fall back to the defaults.
  function sanitize(input) {
    const out = defaults();
    if (!input || typeof input !== "object") return out;
    for (const d of DEFS) {
      const v = input[d.id];
      if (d.kind === "choice") {
        if (d.options.some((o) => o.id === v)) out[d.id] = v;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        out[d.id] = snap(d, v);
      }
    }
    return out;
  }

  // One parameter's value made valid (cheaper than sanitizing the whole set,
  // for things that change many times a second like the morph pad).
  function clean(id, value) {
    const d = BY_ID[id];
    if (!d) return undefined;
    if (d.kind === "choice") return d.options.some((o) => o.id === value) ? value : d.def;
    return typeof value === "number" && Number.isFinite(value) ? snap(d, value) : d.def;
  }

  const dbToGain = (db) => Math.pow(10, db / 20);

  const api = { STEPS, WAVES, FILTERS, DEFS, BY_ID, toPos, fromPos, format, defaults, sanitize, clean, dbToGain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Params = api;
})(typeof window !== "undefined" ? window : globalThis);
