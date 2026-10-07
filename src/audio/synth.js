// A polyphonic subtractive synth: one oscillator (or noise) per note, through
// its own filter and envelope, into the synth's volume. Wave shapes include the
// NES-style pulse widths and a stepped noise channel for 8-bit sounds.
//
//   source -> filter (cutoff, resonance, envelope on detune) -> amp envelope -> volume -> out
(function (root) {
  "use strict";

  const MAX_VOICES = 12;
  const VOICE_GAIN = 0.3; // headroom so a chord doesn't slam the limiter
  const CUT_FADE = 0.005; // seconds; stolen voices fade this fast instead of clicking

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

  // Web Audio wants low/high-pass resonance in decibels, band-pass as a ratio.
  const filterQ = (type, r) => (type === "bandpass" ? r : 20 * Math.log10(r));

  function create(ctx, destination, initial) {
    let p = Params.sanitize(initial);
    const pool = Voices.createPool(MAX_VOICES);

    const out = ctx.createGain();
    out.gain.value = volumeGain(p.volume);
    out.connect(destination);

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

    function noteOn(midi, velocity = 1, when = ctx.currentTime) {
      const src = makeSource(midi);
      const filter = ctx.createBiquadFilter();
      filter.type = p.filterType;
      filter.frequency.value = p.cutoff;
      filter.Q.value = filterQ(p.filterType, p.resonance);
      const vca = ctx.createGain();
      vca.gain.value = 0;
      src.connect(filter);
      filter.connect(vca);
      vca.connect(out);

      const env = {
        start: when, attack: p.attack, decay: p.decay, sustain: p.sustain,
        release: p.release, peak: VOICE_GAIN * velocity,
      };
      Envelope.scheduleOn(vca.gain, env);
      // The filter envelope sweeps the cutoff up by `filterEnv` octaves,
      // following the same shape as the volume.
      const fenv = p.filterEnv > 0 ? { ...env, peak: p.filterEnv * 1200 } : null;
      if (fenv) Envelope.scheduleOn(filter.detune, fenv);

      const voice = { midi, src, filter, vca, env, fenv };
      src.onended = () => {
        src.disconnect(); filter.disconnect(); vca.disconnect();
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

    // Panic: everything silent now.
    function allOff() {
      for (const v of pool.all()) cutVoice(v);
    }

    // Changes a parameter. Filter, tuning and volume changes are heard on
    // notes already playing; the rest apply from the next note.
    function set(id, value) {
      p = Params.sanitize({ ...p, [id]: value });
      const now = ctx.currentTime;
      const glide = (param, v) => param.setTargetAtTime(v, now, 0.015);
      if (id === "volume") glide(out.gain, volumeGain(p.volume));
      for (const v of pool.all()) {
        if (id === "cutoff") glide(v.filter.frequency, p.cutoff);
        else if (id === "resonance") glide(v.filter.Q, filterQ(v.filter.type, p.resonance));
        else if (id === "detune") glide(v.src.detune, p.detune);
      }
    }

    // Replaces every parameter at once (a preset).
    function load(params) {
      const next = Params.sanitize(params);
      for (const d of Params.DEFS) set(d.id, next[d.id]);
    }

    return {
      noteOn, noteOff, voiceOff, allOff, set, load,
      held: () => pool.held(),
      get params() { return { ...p }; },
      output: out,
    };
  }

  root.Synth = { create, MAX_VOICES };
})(window);
