// The drum kit for drum tracks: eight synthesized drums (no sound files),
// each on its General MIDI note so a MIDI drum pad plays the right drum.
// A drum track's notes are drum hits; the clip editor shows one row per
// drum, and the piano keys play drums (white keys C to the next C).
//
//   Drums.KIT              the drums, top row first: { midi, name, key }
//   Drums.BEATS            starting patterns: { id, name, hits: { midi: steps[] } }
//   Drums.isDrum(midi)     whether a note is one of the kit's drums
//   Drums.fromKey(midi, base)  the drum a piano / computer key plays
//   Drums.beatNotes(beat, bars)  that pattern's notes for a clip of `bars` bars
//   Drums.hit(ctx, out, midi, vel, at, noise, playing)  plays one hit into
//                          `out`; its nodes go in the `playing` Set until done
(function (root) {
  "use strict";

  const KICK = 36, SNARE = 38, CLAP = 39, HAT = 42, LOW_TOM = 45, OPEN_HAT = 46, HIGH_TOM = 50, CRASH = 49;

  // Top row first, as the clip editor shows them.
  const KIT = [
    { midi: CRASH, name: "Crash", key: "C (next octave)" },
    { midi: OPEN_HAT, name: "Open hat", key: "G" },
    { midi: HAT, name: "Closed hat", key: "F" },
    { midi: HIGH_TOM, name: "High tom", key: "B" },
    { midi: LOW_TOM, name: "Low tom", key: "A" },
    { midi: CLAP, name: "Clap", key: "E" },
    { midi: SNARE, name: "Snare", key: "D" },
    { midi: KICK, name: "Kick", key: "C" },
  ];
  const BY_MIDI = new Map(KIT.map((d) => [d.midi, d]));

  // Pitch class -> drum: white keys C D E F G A B, black keys play the
  // white key below them.
  const BY_CLASS = [KICK, KICK, SNARE, SNARE, CLAP, HAT, HAT, OPEN_HAT, OPEN_HAT, LOW_TOM, LOW_TOM, HIGH_TOM];

  const isDrum = (midi) => BY_MIDI.has(midi);
  const nameOf = (midi) => (BY_MIDI.get(midi) || {}).name || "Drum";

  // A kit note (a MIDI drum pad) plays itself; any other key plays by its
  // place in the octave above the keyboard's lowest C (`base`), and the C an
  // octave up (computer key K) plays the crash.
  function fromKey(midi, base = 60) {
    if (isDrum(midi)) return midi;
    const rel = midi - base;
    if (rel > 0 && ((rel % 24) + 24) % 24 === 12) return CRASH;
    return BY_CLASS[((midi % 12) + 12) % 12];
  }

  // Starting patterns, one bar of 16 steps each.
  const s = (...steps) => steps;
  const BEATS = [
    { id: "four", name: "Four on the floor", hits: { [KICK]: s(0, 4, 8, 12), [CLAP]: s(4, 12), [HAT]: s(2, 6, 10, 14) } },
    { id: "rock", name: "Rock", hits: { [KICK]: s(0, 8, 10), [SNARE]: s(4, 12), [HAT]: s(0, 2, 4, 6, 8, 10, 12, 14) } },
    { id: "hiphop", name: "Hip-hop", hits: { [KICK]: s(0, 3, 10), [SNARE]: s(4, 12), [HAT]: s(0, 2, 4, 6, 8, 10, 12, 14), [OPEN_HAT]: s(15) } },
    { id: "halftime", name: "Half-time", hits: { [KICK]: s(0, 6), [SNARE]: s(8), [HAT]: s(0, 2, 4, 6, 8, 10, 12, 14) } },
    { id: "break", name: "Breakbeat", hits: { [KICK]: s(0, 10), [SNARE]: s(4, 12, 15), [HAT]: s(0, 2, 4, 6, 8, 10, 12, 14) } },
    { id: "march", name: "Toms", hits: { [KICK]: s(0, 8), [LOW_TOM]: s(10, 14), [HIGH_TOM]: s(12, 13), [SNARE]: s(4) } },
  ];

  function beatNotes(beat, bars = 1) {
    const notes = [];
    for (let bar = 0; bar < bars; bar++) {
      for (const [midi, steps] of Object.entries(beat.hits)) {
        for (const st of steps) notes.push({ step: bar * 16 + st, midi: Number(midi), len: 1, vel: Number(midi) === HAT ? 0.6 : 0.85 });
      }
    }
    return notes.sort((a, b) => a.step - b.step || a.midi - b.midi);
  }

  // --- sound ---
  function env(g, at, peak, decay) {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    return at + decay;
  }

  function noiseHit(ctx, out, noise, at, { type, freq, q = 0.7, peak, decay }, nodes) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(out);
    const end = env(g, at, peak, decay);
    src.start(at);
    src.stop(end + 0.02);
    nodes.push({ src, g });
    return end;
  }

  function toneHit(ctx, out, at, { type = "sine", from, to, sweep, peak, decay }, nodes) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + sweep);
    const g = ctx.createGain();
    osc.connect(g).connect(out);
    const end = env(g, at, peak, decay);
    osc.start(at);
    osc.stop(end + 0.02);
    nodes.push({ src: osc, g });
    return end;
  }

  let openHat = null; // the ringing open hat, so a closed hat chokes it

  function hit(ctx, out, midi, vel, at, noise, playing) {
    // Level matched to a synth track playing chords (peaks, not loudness:
    // drums are all attack).
    const v = Math.max(0.05, Math.min(1, vel)) * 0.5;
    const nodes = [];
    switch (midi) {
      case KICK:
        toneHit(ctx, out, at, { from: 150, to: 42, sweep: 0.12, peak: v, decay: 0.45 }, nodes);
        noiseHit(ctx, out, noise, at, { type: "highpass", freq: 3000, peak: v * 0.15, decay: 0.012 }, nodes);
        break;
      case SNARE:
        noiseHit(ctx, out, noise, at, { type: "highpass", freq: 1200, peak: v * 0.7, decay: 0.18 }, nodes);
        toneHit(ctx, out, at, { type: "triangle", from: 220, to: 160, sweep: 0.05, peak: v * 0.5, decay: 0.1 }, nodes);
        break;
      case CLAP:
        for (const t of [0, 0.011, 0.022]) noiseHit(ctx, out, noise, at + t, { type: "bandpass", freq: 1500, q: 1.2, peak: v * 0.6, decay: 0.03 }, nodes);
        noiseHit(ctx, out, noise, at + 0.03, { type: "bandpass", freq: 1500, q: 1.2, peak: v * 0.6, decay: 0.16 }, nodes);
        break;
      case HAT:
        if (openHat) { try { openHat.g.gain.cancelScheduledValues(at); openHat.g.gain.setTargetAtTime(0.0001, at, 0.01); } catch (e) { /* gone */ } openHat = null; }
        noiseHit(ctx, out, noise, at, { type: "highpass", freq: 7500, peak: v * 0.8, decay: 0.05 }, nodes);
        break;
      case OPEN_HAT:
        noiseHit(ctx, out, noise, at, { type: "highpass", freq: 7000, peak: v * 0.7, decay: 0.38 }, nodes);
        openHat = nodes[0];
        break;
      case LOW_TOM:
        toneHit(ctx, out, at, { from: 130, to: 80, sweep: 0.2, peak: v * 0.9, decay: 0.38 }, nodes);
        break;
      case HIGH_TOM:
        toneHit(ctx, out, at, { from: 220, to: 140, sweep: 0.18, peak: v * 0.85, decay: 0.3 }, nodes);
        break;
      case CRASH:
        noiseHit(ctx, out, noise, at, { type: "highpass", freq: 5000, peak: v * 0.4, decay: 1.3 }, nodes);
        noiseHit(ctx, out, noise, at, { type: "bandpass", freq: 9000, q: 0.5, peak: v * 0.25, decay: 0.9 }, nodes);
        break;
      default:
        return;
    }
    if (playing) {
      for (const n of nodes) {
        playing.add(n);
        n.src.onended = () => playing.delete(n);
      }
    }
  }

  const Drums = { KIT, BEATS, isDrum, nameOf, fromKey, beatNotes, hit };
  if (typeof module !== "undefined" && module.exports) module.exports = Drums;
  else root.Drums = Drums;
})(typeof window !== "undefined" ? window : globalThis);
