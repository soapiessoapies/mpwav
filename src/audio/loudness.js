// How loud a sound is, the way streaming sites and games measure it:
// integrated loudness in LUFS (ITU-R BS.1770: a "K-weighted" filter that
// hears the way ears do, averaged over 400 ms blocks, ignoring silence and
// the quiet parts), and the peak in dB below full scale.
//
// Rough targets: streaming music -14 LUFS, podcasts -16, game sound effects
// usually between -20 and -14 so they sit with each other.
(function (root) {
  "use strict";

  // The K-weighting filter: a high shelf (+4 dB above about 1.7 kHz), then a
  // high pass (below about 38 Hz), as biquads designed for this sample rate.
  function kFilters(rate) {
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan((Math.PI * f0) / rate);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const shelf = {
      b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
      a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
    };
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan((Math.PI * f0) / rate);
    a0 = 1 + K / Q + K * K;
    const high = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
    return [shelf, high];
  }

  function filter(x, { b, a }) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }

  // Integrated loudness of chans (Float32Arrays, one per channel) in LUFS,
  // or -Infinity for silence or a sound under 400 ms.
  function lufs(chans, rate) {
    const n = chans[0] ? chans[0].length : 0;
    const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate);
    if (n < block) return -Infinity;
    const [shelf, high] = kFilters(rate);
    const weighted = chans.slice(0, 2).map((d) => filter(filter(d, shelf), high));
    // Mean square of every 400 ms block, 75% overlapped, summed over channels.
    const powers = [];
    for (let s = 0; s + block <= n; s += hop) {
      let z = 0;
      for (const w of weighted) { let sum = 0; for (let i = s; i < s + block; i++) sum += w[i] * w[i]; z += sum / block; }
      powers.push(z);
    }
    const loud = (z) => -0.691 + 10 * Math.log10(z);
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    // Gate out silence (under -70 LUFS), then everything 10 LU under what's left.
    const abs = powers.filter((z) => z > 0 && loud(z) > -70);
    if (!abs.length) return -Infinity;
    const rel = loud(mean(abs)) - 10;
    const kept = abs.filter((z) => loud(z) > rel);
    return loud(mean(kept));
  }

  // The loudest sample in dB below full scale (0 dB = full scale).
  function peakDb(chans) {
    let p = 0;
    for (const d of chans) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
    return p > 0 ? 20 * Math.log10(p) : -Infinity;
  }

  // "Peak -1.0 dB, loudness -14.2 LUFS"
  function describe(chans, rate) {
    const p = peakDb(chans), l = lufs(chans, rate);
    const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : "silent");
    return `peak ${fmt(p)} dB, loudness ${Number.isFinite(l) ? fmt(l) + " LUFS" : "too short or quiet to measure"}`;
  }

  const api = { lufs, peakDb, describe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Loudness = api;
})(typeof window !== "undefined" ? window : globalThis);
