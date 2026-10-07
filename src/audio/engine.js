// The audio engine: one AudioContext for the whole studio, and the master bus
// every instrument plays into (master volume -> limiter -> meter -> speakers).
//
// Browsers only allow sound after the user taps or presses something, so the
// context is made on the first gesture (start()). On iPhones Web Audio is also
// muted by the silent switch unless the page asks for "playback" audio, which
// start() handles too.
(function (root) {
  "use strict";

  let ctx = null;
  let bus = null; // { input, master, limiter, analyser }
  const listeners = new Set();

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function create() {
    const AC = root.AudioContext || root.webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });

    const input = ctx.createGain(); // instruments connect here
    const master = ctx.createGain();
    master.gain.value = 0.8;
    // A fast, hard limiter so stacked notes never clip the speakers.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    input.connect(master);
    master.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);
    bus = { input, master, limiter, analyser };

    ctx.onstatechange = emit;
  }

  // Lets iPhones play through the silent switch. Newer Safari has a setting
  // for it; older ones switch over once an <audio> element is playing.
  let iosUnlocked = false;
  function unlockIOS() {
    if (iosUnlocked || !isIOS()) return;
    iosUnlocked = true;
    if (navigator.audioSession) {
      navigator.audioSession.type = "playback";
      return;
    }
    const el = document.createElement("audio");
    el.setAttribute("x-webkit-airplay", "deny");
    el.loop = true;
    el.src = URL.createObjectURL(silentWav());
    el.play().catch(() => {});
  }

  // Half a second of 8 kHz silence as a WAV file.
  function silentWav() {
    const n = 4000;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, "data"); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8-bit silence is the midpoint
    return new Blob([buf], { type: "audio/wav" });
  }

  // Call from inside a click / key / touch handler.
  async function start() {
    if (!ctx) create();
    unlockIOS();
    if (ctx.state !== "running") {
      try { await ctx.resume(); } catch (e) { /* stays suspended; status shows it */ }
    }
    emit();
    return ctx;
  }

  // Pauses all sound (and the CPU it uses) until start() again.
  async function stop() {
    if (ctx && ctx.state === "running") await ctx.suspend();
    emit();
  }

  const running = () => !!ctx && ctx.state === "running";

  function setMasterVolume(gain) {
    if (!bus) return;
    bus.master.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
  }

  // Peak level of the master output right now, 0..1 (for the meter).
  let meterBuf = null;
  function peak() {
    if (!bus) return 0;
    if (!meterBuf) meterBuf = new Float32Array(bus.analyser.fftSize);
    bus.analyser.getFloatTimeDomainData(meterBuf);
    let p = 0;
    for (let i = 0; i < meterBuf.length; i++) {
      const a = Math.abs(meterBuf[i]);
      if (a > p) p = a;
    }
    return p;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit() {
    for (const fn of listeners) fn(api);
  }

  const api = {
    start,
    stop,
    running,
    setMasterVolume,
    peak,
    onChange,
    get ctx() { return ctx; },
    get input() { return bus && bus.input; },
    get state() { return ctx ? ctx.state : "off"; },
  };
  root.Engine = api;
})(window);
