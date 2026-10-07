// A mixer channel: what one track's synth plays through on its way to the
// master bus.
//
//   input -> pan -> fader -> mute -> meter tap -> destination
(function (root) {
  "use strict";

  const SMOOTH = 0.015; // seconds; fader moves glide instead of zipper-stepping

  function createChannel(ctx, destination) {
    const input = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const fader = ctx.createGain();
    const mute = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256; // only read for peaks; small is enough
    input.connect(pan);
    pan.connect(fader);
    fader.connect(mute);
    mute.connect(analyser);
    analyser.connect(destination);

    const glide = (param, v) => param.setTargetAtTime(v, ctx.currentTime, SMOOTH);
    let buf = null;

    return {
      input,
      setVolume(db, offAt) { glide(fader.gain, db <= offAt ? 0 : Math.pow(10, db / 20)); },
      setPan(v) { glide(pan.pan, v); },
      setAudible(on) { glide(mute.gain, on ? 1 : 0); },
      peak() {
        if (!buf) buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        let p = 0;
        for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
        return p;
      },
    };
  }

  root.Mixer = { createChannel };
})(window);
