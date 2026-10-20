// Where to cut a sound into slices (Sample Studio). Pure: every function
// takes the sound's channels (Float32Arrays) and sample rate, or just its
// length, and returns cut times in seconds, sorted, inside the sound (never
// at 0 or the very end).
//
//   equal(duration, n)              n parts of the same length
//   bars(duration, barSecs, every)  a cut every `every` bars at the song's tempo
//   beats(chans, rate, opts)        a cut just before each hit (an onset):
//                                   opts.sensitivity 0..1 (more hits as it rises)
//   silences(chans, rate, opts)     a cut in the middle of each quiet gap:
//                                   opts.threshold (dB, default -40), opts.minGap (s)
//   nearestZero(chans, rate, t)     the zero crossing nearest t (within 10 ms),
//                                   so slices start and end without a click
//   slicesOf(cuts, duration)        [{ from, to }] between the cuts
//   tidy(cuts, duration)            sorted, inside the sound, at least 10 ms apart
(function (root) {
  "use strict";

  const MIN_GAP = 0.01; // cuts closer than 10 ms are the same cut
  const MAX_CUTS = 256;

  function tidy(cuts, duration) {
    const out = [];
    for (const c of [...cuts].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)) {
      if (c <= MIN_GAP || c >= duration - MIN_GAP) continue;
      if (out.length && c - out[out.length - 1] < MIN_GAP) continue;
      out.push(Number(c.toFixed(5)));
    }
    return out.slice(0, MAX_CUTS);
  }

  function slicesOf(cuts, duration) {
    const edges = [0, ...tidy(cuts, duration), duration];
    const out = [];
    for (let i = 0; i < edges.length - 1; i++) out.push({ from: edges[i], to: edges[i + 1] });
    return out;
  }

  function equal(duration, n) {
    n = Math.max(1, Math.min(MAX_CUTS, Math.round(n)));
    return tidy(Array.from({ length: n - 1 }, (_, i) => ((i + 1) * duration) / n), duration);
  }

  function bars(duration, barSecs, every = 1) {
    const step = barSecs * every;
    if (!(step > 0)) return [];
    const out = [];
    for (let t = step; t < duration && out.length < MAX_CUTS; t += step) out.push(t);
    return tidy(out, duration);
  }

  // Mono, as loudness per short frame (RMS).
  function frames(chans, rate, hop) {
    const n = chans[0].length, count = Math.floor(n / hop);
    const out = new Float32Array(count);
    for (let f = 0; f < count; f++) {
      let sum = 0;
      for (let i = f * hop; i < Math.min(n, f * hop + hop * 2); i++) {
        let v = 0;
        for (const d of chans) v += d[i];
        v /= chans.length;
        sum += v * v;
      }
      out[f] = Math.sqrt(sum / (hop * 2));
    }
    return out;
  }
  const db = (x) => 20 * Math.log10(Math.max(1e-6, x));

  // Onsets: where the loudness jumps up (in dB) by more than it usually
  // does around there. A cut goes a little before the jump.
  function beats(chans, rate, opts = {}) {
    if (!chans.length || !chans[0].length) return [];
    const sens = Math.max(0, Math.min(1, opts.sensitivity == null ? 0.5 : opts.sensitivity));
    const hop = Math.max(64, Math.round(rate * 0.005)); // 5 ms
    const e = frames(chans, rate, hop);
    const flux = new Float32Array(e.length);
    for (let i = 1; i < e.length; i++) flux[i] = Math.max(0, db(e[i]) - db(e[i - 1]));
    const peak = Math.max(...e);
    const floor = db(peak) - 45; // quieter than this is silence: no onsets in it
    const need = 6 + (1 - sens) * 12; // dB of jump over the local level (6 to 18)
    const minGap = Math.round((0.06 + (1 - sens) * 0.1) / (hop / rate)); // 60 to 160 ms
    const half = Math.round(0.15 / (hop / rate)); // the "around there": ±150 ms
    const out = [];
    let last = -Infinity;
    for (let i = 1; i < e.length; i++) {
      if (db(e[i]) < floor || flux[i] < need * 0.5) continue;
      // The local level of change, so a loud passage needs a bigger jump.
      let s = 0, k = 0;
      for (let j = Math.max(1, i - half); j < Math.min(e.length, i + half); j++) { s += flux[j]; k++; }
      const local = s / Math.max(1, k);
      if (flux[i] < need + local * 1.5 || i - last < minGap) continue;
      // Only the biggest jump of a rise counts.
      if (i + 1 < e.length && flux[i + 1] > flux[i]) continue;
      last = i;
      out.push(Math.max(0, (i - 1) * hop / rate - 0.005));
    }
    return tidy(out, chans[0].length / rate);
  }

  function silences(chans, rate, opts = {}) {
    if (!chans.length || !chans[0].length) return [];
    const threshold = opts.threshold == null ? -40 : opts.threshold;
    const minGap = opts.minGap == null ? 0.12 : opts.minGap;
    const hop = Math.max(64, Math.round(rate * 0.005));
    const e = frames(chans, rate, hop);
    const peak = Math.max(...e);
    const quiet = (i) => db(e[i]) - db(peak) < threshold;
    const out = [];
    let start = null, heard = false;
    for (let i = 0; i <= e.length; i++) {
      const q = i < e.length && quiet(i);
      if (q && start === null) start = i;
      if (!q && start !== null) {
        const len = ((i - start) * hop) / rate;
        // A gap between two sounds (not before the first or after the last).
        if (heard && i < e.length && len >= minGap) out.push(((start + i) / 2) * hop / rate);
        start = null;
      }
      if (!q && i < e.length) heard = true;
    }
    return tidy(out, chans[0].length / rate);
  }

  function nearestZero(chans, rate, t) {
    const d = chans[0];
    if (!d || !d.length) return t;
    const at = Math.round(t * rate), reach = Math.round(rate * 0.01);
    const mono = (i) => { let v = 0; for (const c of chans) v += c[i]; return v; };
    for (let k = 0; k <= reach; k++) {
      for (const i of [at - k, at + k]) {
        if (i <= 0 || i >= d.length) continue;
        const a = mono(i - 1), b = mono(i);
        if (a === 0 || (a < 0) !== (b < 0)) return i / rate;
      }
    }
    return t;
  }

  const api = { equal, bars, beats, silences, nearestZero, slicesOf, tidy, MAX_CUTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Slicer = api;
})(typeof window !== "undefined" ? window : globalThis);
