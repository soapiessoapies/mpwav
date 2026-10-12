// Edits to a sound itself, for the wave editor: change a stretch of it
// (the selection) or all of it. A sound here is `chans`, one Float32Array
// per channel, and a stretch is frames `from` up to (not including) `to`.
// Nothing is changed in place: every edit returns new channels, so the
// sound it came from is still there for undo.
//
//   amplify(chans, from, to, db)   louder or quieter by `db`
//   normalize(chans, from, to)     as loud as it goes without clipping;
//                                  returns { chans, db } (db 0: it was silent)
//   fade(chans, from, to, "in" | "out")
//   silence(chans, from, to)
//   reverse(chans, from, to)
//   remove(chans, from, to)        cuts the stretch out; the sound gets shorter
//   slice(chans, from, to)         a copy of just the stretch (for the clipboard)
//   insert(chans, at, piece)       puts `piece` in at frame `at`; the sound gets longer
//   mix(chans, at, piece)          lays `piece` on top from `at` (longer if it runs past the end)
//   fit(piece, rate, toRate, n)    a copied piece made to match another sound:
//                                  its sample rate and its number of channels
//   peak(chans, from, to)          the loudest sample, 0..1 (or more, if clipped)
//   outline(chans, from, to, n)    a waveform outline: n [min, max] pairs
//   afterCut(t, from, to)          where time `t` ends up once from..to is cut
//   afterInsert(t, at, len)        ...and once `len` is put in at `at`
(function (root) {
  "use strict";

  const span = (chans, from, to) => {
    const n = chans[0] ? chans[0].length : 0;
    const a = Math.max(0, Math.min(n, Math.round(from)));
    return [a, Math.max(a, Math.min(n, Math.round(to)))];
  };
  // Copies of the channels, with `fn(data, a, b)` run on each one's stretch.
  function each(chans, from, to, fn) {
    const [a, b] = span(chans, from, to);
    return chans.map((d) => { const out = Float32Array.from(d); fn(out, a, b); return out; });
  }

  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => 20 * Math.log10(g);

  function peak(chans, from, to) {
    const [a, b] = span(chans, from, to);
    let hi = 0;
    for (const d of chans) for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > hi) hi = v; }
    return hi;
  }

  const scale = (chans, from, to, g) => each(chans, from, to, (d, a, b) => { for (let i = a; i < b; i++) d[i] *= g; });
  const amplify = (chans, from, to, db) => scale(chans, from, to, dbToGain(db));

  function normalize(chans, from, to) {
    const hi = peak(chans, from, to);
    if (hi < 1e-5) return { chans: chans.map((d) => Float32Array.from(d)), db: 0 };
    return { chans: scale(chans, from, to, 1 / hi), db: gainToDb(1 / hi) };
  }

  function fade(chans, from, to, dir) {
    return each(chans, from, to, (d, a, b) => {
      const n = b - a;
      for (let i = 0; i < n; i++) d[a + i] *= dir === "out" ? 1 - (i + 1) / n : i / n;
    });
  }

  const silence = (chans, from, to) => each(chans, from, to, (d, a, b) => d.fill(0, a, b));
  const reverse = (chans, from, to) => each(chans, from, to, (d, a, b) => d.subarray(a, b).reverse());

  function remove(chans, from, to) {
    const [a, b] = span(chans, from, to);
    return chans.map((d) => {
      const out = new Float32Array(d.length - (b - a));
      out.set(d.subarray(0, a));
      out.set(d.subarray(b), a);
      return out;
    });
  }

  // A point inside the cut lands where the cut was; a later one moves earlier.
  const afterCut = (t, from, to) => (t <= from ? t : t >= to ? t - (to - from) : from);
  // A point after the new part moves later (one exactly at it stays put).
  const afterInsert = (t, at, len) => (t > at ? t + len : t);

  function slice(chans, from, to) {
    const [a, b] = span(chans, from, to);
    return chans.map((d) => d.slice(a, b));
  }

  function insert(chans, at, piece) {
    const [a] = span(chans, at, at), n = piece[0] ? piece[0].length : 0;
    return chans.map((d, c) => {
      const out = new Float32Array(d.length + n);
      out.set(d.subarray(0, a));
      out.set(piece[c % piece.length], a);
      out.set(d.subarray(a), a + n);
      return out;
    });
  }

  function mix(chans, at, piece) {
    const [a] = span(chans, at, at), n = piece[0] ? piece[0].length : 0;
    return chans.map((d, c) => {
      const out = new Float32Array(Math.max(d.length, a + n));
      out.set(d);
      const p = piece[c % piece.length];
      for (let i = 0; i < n; i++) out[a + i] += p[i];
      return out;
    });
  }

  // Mono into stereo plays on both sides; stereo into mono is the two
  // averaged. A different sample rate is stretched to fit (straight lines
  // between samples), so the piece keeps its pitch and length.
  function fit(piece, rate, toRate, n) {
    let out = piece;
    if (out.length !== n) {
      out = n === 1
        ? [out[0].map((v, i) => out.reduce((sum, d) => sum + d[i], 0) / out.length)]
        : Array.from({ length: n }, (_, c) => out[c % out.length]);
    }
    if (rate === toRate || !out[0].length) return out.map((d) => Float32Array.from(d));
    const len = Math.max(1, Math.round((out[0].length * toRate) / rate)), step = rate / toRate;
    return out.map((d) => {
      const res = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const x = i * step, k = Math.floor(x), next = Math.min(d.length - 1, k + 1);
        res[i] = d[Math.min(k, d.length - 1)] * (1 - (x - k)) + d[next] * (x - k);
      }
      return res;
    });
  }

  // Long stretches are sampled (up to 64 looks per point), which is plenty
  // for a picture.
  function outline(chans, from, to, n) {
    const [a, b] = span(chans, from, to);
    const out = new Float32Array(n * 2);
    const per = (b - a) / n, skip = Math.max(1, Math.floor(per / 64));
    for (let i = 0; i < n; i++) {
      let lo = 0, hi = 0;
      const start = a + Math.floor(i * per), end = Math.min(b, Math.max(start + 1, a + Math.floor((i + 1) * per)));
      for (let j = start; j < end; j += skip) {
        for (const d of chans) { if (d[j] < lo) lo = d[j]; if (d[j] > hi) hi = d[j]; }
      }
      out[i * 2] = lo;
      out[i * 2 + 1] = hi;
    }
    return out;
  }

  const api = { amplify, normalize, fade, silence, reverse, remove, slice, insert, mix, fit, peak, outline, afterCut, afterInsert, dbToGain, gainToDb };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WaveOps = api;
})(typeof window !== "undefined" ? window : globalThis);
