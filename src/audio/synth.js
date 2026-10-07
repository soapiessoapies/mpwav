// A polyphonic subtractive synth: one oscillator (or noise) per note, through
// its own filter and envelope, into the synth's volume and warp effects.
// Wave shapes include the NES-style pulse widths and a stepped noise channel
// for 8-bit sounds.
//
//   source -> filter -> amp envelope -> volume -> drive -> bit crush -> out
//                                                                  +-> echo -> out
//                                                                  +-> reverb send
// One LFO per synth wobbles every voice's pitch (vibrato) and filter (wobble).
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
    drive.oversample = "2x"; // less harsh aliasing when driven hard
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
    post.connect(echoSend);
    echoSend.connect(delay);
    delay.connect(echoTone);
    echoTone.connect(feedback);
    feedback.connect(delay);
    echoTone.connect(destination);

    const reverbSend = ctx.createGain();
    post.connect(reverbSend);
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
      vib.connect(src.detune);
      wob.connect(filter.detune);

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
        vib.disconnect(src.detune); wob.disconnect(filter.detune);
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
          glide(post.gain, 1 / (1 + v * DRIVE_MAKEUP));
          break;
        case "crush": crush.curve = curve("crush", v); break;
        case "echo": glide(echoSend.gain, v * 0.7); break;
        case "reverb": glide(reverbSend.gain, v); break;
        case "cutoff": for (const x of pool.all()) glide(x.filter.frequency, v); break;
        case "resonance": for (const x of pool.all()) glide(x.filter.Q, filterQ(x.filter.type, v)); break;
        case "detune": for (const x of pool.all()) glide(x.src.detune, v); break;
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

    return {
      noteOn, noteOff, voiceOff, allOff, set, load, setTempo,
      held: () => pool.held(),
      get params() { return { ...p }; },
      output: out,
    };
  }

  root.Synth = { create, MAX_VOICES };
})(window);
