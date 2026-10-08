// A polyphonic subtractive synth: one oscillator (or noise) per note, through
// its own filter and envelope, into the synth's volume and warp effects.
// Wave shapes include the NES-style pulse widths and a stepped noise channel
// for 8-bit sounds.
//
//   source -> filter -> amp envelope -> volume -> drive -> bit crush -> out
//                                                                  +-> echo -> out
//                                                                  +-> reverb send
// One LFO per synth wobbles every voice's pitch (vibrato) and filter (wobble).
//
// A note from the timeline can carry its own sound on top (`fx`, see
// Song.NOTE_FX): a pitch slide over its length, a fast pitch sweep at the
// start, fine tuning, its own vibrato, a brighter or darker filter, a pan,
// retriggering, and a burst of noise at the start. playNote() handles all
// of it; live playing from the keyboard uses noteOn() without fx.
(function (root) {
  "use strict";

  const MAX_VOICES = 12;
  const VOICE_GAIN = 0.3; // headroom so a chord doesn't slam the limiter
  const CUT_FADE = 0.005; // seconds; stolen voices fade this fast instead of clicking
  const SWEEP_TIME = 0.03; // seconds; how fast a pitch sweep falls onto its note (time constant)
  const NOTE_VIB_HZ = 6;   // a note's own vibrato rate
  const BURST = 0.06;      // seconds of noise in a noise burst
  const clampHz = (f) => Math.min(20000, Math.max(20, f));

  // Per-context caches: pulse waves and the noise buffer only need making once.
  const caches = new WeakMap();
  function cacheFor(ctx) {
    if (!caches.has(ctx)) caches.set(ctx, { pulses: {}, noise: null });
    return caches.get(ctx);
  }

  // A pulse wave of the given duty cycle, from its Fourier series.
  function pulseWave(ctx, duty) {
    const c = cacheFor(ctx);
    if (!c.pulses[duty]) {
      const n = 64;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        real[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
        imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
      }
      c.pulses[duty] = ctx.createPeriodicWave(real, imag);
    }
    return c.pulses[duty];
  }

  // Two seconds of stepped noise: each random value is held for a few
  // samples, which gives it a pitch that playbackRate can move, like the
  // NES noise channel.
  function noiseBuffer(ctx) {
    const c = cacheFor(ctx);
    if (!c.noise) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const hold = 6;
      let v = 0;
      for (let i = 0; i < len; i++) {
        if (i % hold === 0) v = Math.random() * 2 - 1;
        d[i] = v;
      }
      c.noise = buf;
    }
    return c.noise;
  }

  // Shaper curves, cached by amount so dragging a slider doesn't rebuild them
  // over and over. Amount 0 means no curve at all: the shaper passes the
  // sound straight through, costing nothing.
  const curves = new Map();
  function curve(kind, amount) {
    if (amount <= 0) return null;
    const key = kind + Math.round(amount * 100);
    if (!curves.has(key)) {
      const n = 4096, c = new Float32Array(n);
      if (kind === "drive") {
        const k = 1 + amount * 20;
        const norm = Math.tanh(k);
        for (let i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / norm;
      } else {
        // Fewer volume steps the more it's crushed: 12 bits down to 2. The
        // synth's signal sits well below full scale (around a quarter), so
        // the steps are sized to that, or quiet notes would just turn into
        // loud square waves.
        const levels = Math.pow(2, Math.round(12 - amount * 10) - 1) * CRUSH_SCALE;
        for (let i = 0; i < n; i++) c[i] = Math.round((i / (n - 1) * 2 - 1) * levels) / levels;
      }
      curves.set(key, c);
    }
    return curves.get(key);
  }

  const CRUSH_SCALE = 4;
  // Driving a quiet signal into the curve makes it much louder; this much
  // turn-down keeps a fully driven sound close to the clean one's level.
  const DRIVE_MAKEUP = 7;
  const ECHO_STEPS = 3;      // echo every 3 sixteenths (a dotted eighth), in time with the song
  const ECHO_FEEDBACK = 0.38;

  // Web Audio wants low/high-pass resonance in decibels, band-pass as a ratio.
  const filterQ = (type, r) => (type === "bandpass" ? r : 20 * Math.log10(r));

  // opts: { reverb: the shared reverb's input, bpm: the song's tempo }
  function create(ctx, destination, initial, opts = {}) {
    let p = Params.sanitize(initial);
    const pool = Voices.createPool(MAX_VOICES);

    // --- output chain ---
    const out = ctx.createGain(); // the synth's volume
    out.gain.value = volumeGain(p.volume);
    const drive = ctx.createWaveShaper();
    drive.oversample = "none"; // "2x" once drive is turned up (less harsh aliasing then)
    const crush = ctx.createWaveShaper();
    const post = ctx.createGain();
    out.connect(drive);
    drive.connect(crush);
    crush.connect(post);
    post.connect(destination);

    const echoSend = ctx.createGain();
    const delay = ctx.createDelay(2);
    const echoTone = ctx.createBiquadFilter(); // each repeat a little darker
    echoTone.type = "lowpass";
    echoTone.frequency.value = 3500;
    const feedback = ctx.createGain();
    feedback.gain.value = ECHO_FEEDBACK;
    // The echo loop is plugged in only once Echo is turned up: left running
    // at zero it would still cost CPU on every track, live and in export.
    let echoPlugged = false;
    echoSend.connect(delay);
    delay.connect(echoTone);
    echoTone.connect(feedback);
    feedback.connect(delay);
    echoTone.connect(destination);

    const reverbSend = ctx.createGain();
    let reverbPlugged = false; // the same goes for the reverb send
    if (opts.reverb) reverbSend.connect(opts.reverb);

    // --- the LFO ---
    const lfo = ctx.createOscillator();
    const vib = ctx.createGain(); // cents of pitch wobble
    const wob = ctx.createGain(); // cents of filter wobble
    lfo.connect(vib);
    lfo.connect(wob);
    lfo.start();

    let bpm = opts.bpm || 120;

    function volumeGain(db) {
      return db <= Params.BY_ID.volume.min ? 0 : Params.dbToGain(db);
    }

    function makeSource(midi) {
      const freq = Notes.mtof(midi + p.octave * 12);
      if (p.wave === "noise") {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        src.loop = true;
        src.loopStart = Math.random() * 1.5; // so repeated hits don't sound identical
        src.playbackRate.value = Math.min(16, Math.max(1 / 16, freq / Notes.mtof(72)));
        src.detune.value = p.detune;
        return src;
      }
      const osc = ctx.createOscillator();
      if (p.wave === "pulse25") osc.setPeriodicWave(pulseWave(ctx, 0.25));
      else if (p.wave === "pulse12") osc.setPeriodicWave(pulseWave(ctx, 0.125));
      else osc.type = p.wave;
      osc.frequency.value = freq;
      osc.detune.value = p.detune;
      return osc;
    }

    // fx: the note's own sound (or null); length: seconds it's held, which
    // a pitch slide spreads over.
    function noteOn(midi, velocity = 1, when = ctx.currentTime, fx = null, length = 0) {
      const f = fx || {};
      const src = makeSource(midi);
      const filter = ctx.createBiquadFilter();
      filter.type = p.filterType;
      const cutMul = f.cut ? Math.pow(2, f.cut) : 1;
      filter.frequency.value = clampHz(p.cutoff * cutMul);
      filter.Q.value = filterQ(p.filterType, p.resonance);
      const vca = ctx.createGain();
      vca.gain.value = 0;
      src.connect(filter);
      filter.connect(vca);
      // A panned note gets its own panner; the rest go straight out.
      const panner = f.pan ? ctx.createStereoPanner() : null;
      if (panner) {
        panner.pan.value = f.pan;
        vca.connect(panner);
        panner.connect(out);
      } else vca.connect(out);

      // Pitch: tuning (and where a retriggered slide has got to) on detune,
      // a sweep falling onto the note, a slide across its length.
      const tune = (f.tune || 0) + (f.from || 0);
      const baseDetune = p.detune + tune;
      if (f.sweep) {
        src.detune.setValueAtTime(baseDetune + f.sweep * 100, when);
        src.detune.setTargetAtTime(baseDetune, when, SWEEP_TIME);
      } else src.detune.value = baseDetune;
      if (f.bend && length > 0) {
        const pitch = p.wave === "noise" ? src.playbackRate : src.frequency;
        const from = pitch.value, to = from * Math.pow(2, f.bend / 12);
        pitch.setValueAtTime(from, when);
        pitch.exponentialRampToValueAtTime(p.wave === "noise" ? Math.min(16, Math.max(1 / 16, to)) : clampHz(to), when + length);
      }
      // The note's own vibrato: a little LFO of its own, only when asked for.
      let noteLfo = null;
      if (f.vib) {
        noteLfo = ctx.createOscillator();
        noteLfo.frequency.value = NOTE_VIB_HZ;
        const depth = ctx.createGain();
        depth.gain.value = f.vib;
        noteLfo.connect(depth);
        depth.connect(src.detune);
        noteLfo.start(when);
      }
      // A noise burst: a short hiss at the start, outside the note's envelope.
      if (f.noise) {
        const hiss = ctx.createBufferSource();
        hiss.buffer = noiseBuffer(ctx);
        const g = ctx.createGain();
        g.gain.setValueAtTime(VOICE_GAIN * velocity * f.noise, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + BURST);
        hiss.connect(g);
        g.connect(panner || out);
        hiss.onended = () => { hiss.disconnect(); g.disconnect(); };
        hiss.start(when, Math.random() * 1.5);
        hiss.stop(when + BURST + 0.01);
      }
      // Only wire the LFO in when vibrato / wobble are turned up: a connected
      // modulator makes the filter recalculate on every sample, which costs a
      // lot of CPU (live, and when exporting) for no audible change at zero.
      const vibOn = p.vibrato > 0, wobOn = p.wobble > 0;
      if (vibOn) vib.connect(src.detune);
      if (wobOn) wob.connect(filter.detune);

      const env = {
        start: when, attack: p.attack, decay: p.decay, sustain: p.sustain,
        release: p.release, peak: VOICE_GAIN * velocity,
      };
      Envelope.scheduleOn(vca.gain, env);
      // The filter envelope sweeps the cutoff up by `filterEnv` octaves,
      // following the same shape as the volume.
      const fenv = p.filterEnv > 0 ? { ...env, peak: p.filterEnv * 1200 } : null;
      if (fenv) Envelope.scheduleOn(filter.detune, fenv);

      const voice = { midi, src, filter, vca, env, fenv, tune, cutMul, noteLfo };
      src.onended = () => {
        if (vibOn) vib.disconnect(src.detune);
        if (wobOn) wob.disconnect(filter.detune);
        if (noteLfo) { try { noteLfo.stop(); } catch (e) { /* not started yet */ } noteLfo.disconnect(); }
        src.disconnect(); filter.disconnect(); vca.disconnect();
        if (panner) panner.disconnect();
        pool.remove(voice);
      };

      const { release, cut } = pool.add(midi, voice);
      for (const v of release) releaseVoice(v, when);
      for (const v of cut) cutVoice(v);

      src.start(when);
      return voice;
    }

    function releaseVoice(v, at) {
      at = Math.max(at, ctx.currentTime);
      const end = Envelope.scheduleOff(v.vca.gain, v.env, at);
      if (v.fenv) Envelope.scheduleOff(v.filter.detune, v.fenv, at);
      v.src.stop(end + 0.02);
    }

    function cutVoice(v) {
      const now = ctx.currentTime;
      const g = v.vca.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, CUT_FADE);
      try { v.src.stop(now + CUT_FADE * 6); } catch (e) { /* already stopping */ }
    }

    function noteOff(midi, when = ctx.currentTime) {
      const v = pool.release(midi);
      if (v) releaseVoice(v, when);
    }

    // Lets go of one voice that noteOn returned (used by the sequencer).
    function voiceOff(v, when = ctx.currentTime) {
      if (pool.releaseVoice(v)) releaseVoice(v, when);
    }

    // Plays a note from a clip: { midi, vel, len, fx } starting `at`, each
    // step `stepDur` seconds long. Retrigger splits it into quick repeats,
    // with a pitch slide carried across them (each repeat picks up where
    // the last left off).
    function playNote(n, at, stepDur) {
      const fx = n.fx || null;
      const times = fx && fx.ratchet > 1 ? fx.ratchet : 1;
      if (times === 1) {
        const len = stepDur * (n.len - 0.08);
        voiceOff(noteOn(n.midi, n.vel, at, fx, len), at + len);
        return;
      }
      const each = (stepDur * n.len) / times;
      const bend = fx.bend || 0;
      for (let i = 0; i < times; i++) {
        const start = at + i * each, len = each * 0.8;
        const part = { ...fx, bend: bend / times, from: (bend * 100 * i) / times };
        voiceOff(noteOn(n.midi, n.vel, start, part, len), start + len);
      }
    }

    // Panic: everything silent now.
    function allOff() {
      for (const v of pool.all()) cutVoice(v);
    }

    // Changes a parameter. Filter, tuning, volume and warp changes are heard
    // on notes already playing; the rest apply from the next note.
    function set(id, value) {
      const v = Params.clean(id, value);
      if (v === undefined) return;
      p[id] = v;
      const now = ctx.currentTime;
      const glide = (param, x) => param.setTargetAtTime(x, now, 0.015);
      switch (id) {
        case "volume": glide(out.gain, volumeGain(v)); break;
        case "lfoRate": glide(lfo.frequency, v); break;
        case "vibrato": glide(vib.gain, v); break;
        case "wobble": glide(wob.gain, v * 1200); break;
        case "drive":
          drive.curve = curve("drive", v);
          drive.oversample = v > 0 ? "2x" : "none";
          glide(post.gain, 1 / (1 + v * DRIVE_MAKEUP));
          break;
        case "crush": crush.curve = curve("crush", v); break;
        case "echo":
          if (v > 0 && !echoPlugged) { post.connect(echoSend); echoPlugged = true; }
          glide(echoSend.gain, v * 0.7);
          break;
        case "reverb":
          if (v > 0 && !reverbPlugged) { post.connect(reverbSend); reverbPlugged = true; }
          glide(reverbSend.gain, v);
          break;
        case "cutoff": for (const x of pool.all()) glide(x.filter.frequency, clampHz(v * (x.cutMul || 1))); break;
        case "resonance": for (const x of pool.all()) glide(x.filter.Q, filterQ(x.filter.type, v)); break;
        case "detune": for (const x of pool.all()) glide(x.src.detune, v + (x.tune || 0)); break;
      }
    }

    // Keeps the echo in time when the tempo changes.
    function setTempo(newBpm) {
      bpm = newBpm;
      delay.delayTime.setTargetAtTime(Math.min(2, (ECHO_STEPS * 60) / bpm / 4), ctx.currentTime, 0.05);
    }

    // Replaces every parameter at once (a preset).
    function load(params) {
      const next = Params.sanitize(params);
      for (const d of Params.DEFS) set(d.id, next[d.id]);
    }

    // Start with every effect where the settings say.
    for (const id of ["lfoRate", "vibrato", "wobble", "drive", "crush", "echo", "reverb"]) set(id, p[id]);
    setTempo(bpm);
    delay.delayTime.value = Math.min(2, (ECHO_STEPS * 60) / bpm / 4);

    // The track was removed: silence it and unplug everything it owns.
    function dispose() {
      allOff();
      try { lfo.stop(); } catch (e) { /* already stopped */ }
      for (const n of [out, post, echoTone, reverbSend, lfo]) n.disconnect();
    }

    return {
      noteOn, noteOff, voiceOff, playNote, allOff, set, load, setTempo, dispose,
      held: () => pool.held(),
      get params() { return { ...p }; },
      output: out,
    };
  }

  root.Synth = { create, MAX_VOICES };
})(window);
