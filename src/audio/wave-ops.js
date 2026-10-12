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
//   echo(chans, from, to, rate, { delay, feedback })   repeats of the stretch,
//                                  each quieter, ringing on after it (the sound
//                                  gets longer if they run past its end)
//   filter(chans, from, to, rate, "low" | "high", hz)  cuts the highs or the lows
//   speed(chans, from, to, factor) plays the stretch faster (factor > 1) or
//                                  slower, like a record: pitch moves with it
//   stretch(chans, from, to, rate, ratio)   makes the stretch `ratio` times as
//                                  long without changing its pitch
//   pitch(chans, from, to, rate, semitones) ...or its pitch without changing its length
//   reverb(chans, from, to, rate, { size, mix })   a room around the stretch,
//                                  ringing on after it
//   compress(chans, from, to, rate, { threshold, ratio })  turns the loud parts
//                                  down, then the whole stretch back up to where it
//                                  peaked; returns { chans, db } (db: how far up)
//   afterResize(t, from, to, len)  where time `t` ends up once from..to is `len` long
//   tone(rate, secs, { shape, hz, level })   a new sound: sine, square, saw or triangle
//   noise(rate, secs, level, random)         ...or hiss
//   zeroNear(chans, frame, reach)  the nearest frame where the wave crosses zero
//   soundSpan(chans, floor)        [from, to): the sound without its silent ends
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

  // Echoes of the stretch only: what comes after it is heard under them
  // but doesn't echo itself. They ring on until 60 dB down (5 s at most).
  function echo(chans, from, to, rate, { delay = 0.25, feedback = 0.4 } = {}) {
    const [a, b] = span(chans, from, to);
    const d = Math.max(1, Math.round(delay * rate)), g = Math.max(0, Math.min(0.95, feedback));
    if (!g || b <= a) return chans.map((x) => Float32Array.from(x));
    const repeats = Math.ceil(Math.log(0.001) / Math.log(g));
    const tail = Math.min(repeats * d, Math.round(5 * rate));
    return chans.map((x) => {
      const out = new Float32Array(Math.max(x.length, b + tail));
      out.set(x);
      const wet = new Float32Array(b + tail - a); // the echoes alone, from `a`
      for (let i = d; i < wet.length; i++) {
        const src = a + i - d;
        wet[i] = g * ((src < b ? x[src] : 0) + wet[i - d]);
        out[a + i] += wet[i];
      }
      return out;
    });
  }

  // A two-pole filter (the usual "biquad"), gentle and without a peak.
  function filter(chans, from, to, rate, kind, hz) {
    const w = (2 * Math.PI * Math.max(10, Math.min(rate * 0.45, hz))) / rate;
    const cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha, a1 = (-2 * cos) / a0, a2 = (1 - alpha) / a0;
    const edge = kind === "high" ? (1 + cos) / 2 : (1 - cos) / 2;
    const b0 = edge / a0, b1 = ((kind === "high" ? -2 : 2) * edge) / a0, b2 = b0;
    return each(chans, from, to, (d, a, b) => {
      // Starts as if the sound had always been at its first value: no thump.
      let x1 = d[a] || 0, x2 = x1, y1 = kind === "high" ? 0 : x1, y2 = y1;
      for (let i = a; i < b; i++) {
        const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        d[i] = y;
      }
    });
  }

  function speed(chans, from, to, factor) {
    const [a, b] = span(chans, from, to);
    const f = Math.max(0.25, Math.min(4, factor));
    if (b <= a || f === 1) return chans.map((d) => Float32Array.from(d));
    const piece = fit(chans.map((d) => d.subarray(a, b)), f, 1, chans.length);
    return insert(remove(chans, a, b), a, piece);
  }
  const afterResize = (t, from, to, len) =>
    (t <= from ? t : t >= to ? t + len - (to - from) : from + ((t - from) * len) / (to - from));

  // Longer or shorter at the same pitch: short overlapping grains of the
  // sound are laid down further apart or closer together, each one picked
  // (a little either side of where it's due) to line up with the grain
  // before it, so the wave carries on smoothly. Known as WSOLA.
  function stretch(chans, from, to, rate, ratio) {
    const [a, b] = span(chans, from, to), n = b - a;
    const r = Math.max(0.25, Math.min(4, ratio));
    const N = Math.max(16, 2 * Math.round(rate * 0.02)); // a 40 ms grain
    if (r === 1 || n < 2) return chans.map((d) => Float32Array.from(d));
    const src = chans.map((d) => d.subarray(a, b));
    if (n < N * 2) return insert(remove(chans, a, b), a, fit(src, r, 1, chans.length)); // too short to grain: resample
    const hop = N / 2, due = hop / r, reach = Math.round(N / 4), outLen = Math.round(n * r);
    const mono = new Float32Array(n);
    for (const d of src) for (let i = 0; i < n; i++) mono[i] += d[i];
    const win = Float32Array.from({ length: N }, (_, j) => 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N));
    const piece = chans.map(() => new Float32Array(outLen + N)), weight = new Float32Array(outLen + N);
    const last = n - N;
    let prev = 0;
    for (let k = 0, o = 0; o < outLen; k++, o += hop) {
      let p = Math.min(last, Math.round(k * due));
      const want = prev + hop; // where the last grain would carry on from
      if (k > 0 && want <= last) {
        let best = -Infinity;
        for (let q = Math.max(0, p - reach); q <= Math.min(last, p + reach); q += 2) {
          let score = 0;
          for (let j = 0; j < N; j += 4) score += mono[q + j] * mono[want + j];
          if (score > best) { best = score; p = q; }
        }
      }
      for (let c = 0; c < src.length; c++) {
        const d = src[c], out = piece[c];
        for (let j = 0; j < N; j++) out[o + j] += d[p + j] * win[j];
      }
      for (let j = 0; j < N; j++) weight[o + j] += win[j];
      prev = p;
    }
    for (const out of piece) for (let i = 0; i < outLen; i++) if (weight[i] > 0.05) out[i] /= weight[i];
    return insert(remove(chans, a, b), a, piece.map((d) => d.subarray(0, outLen)));
  }

  // Higher or lower at the same length: stretched, then sped back.
  function pitch(chans, from, to, rate, semitones) {
    const [a, b] = span(chans, from, to), f = Math.pow(2, semitones / 12);
    if (b <= a || !semitones) return chans.map((d) => Float32Array.from(d));
    const long = stretch(chans, a, b, rate, f);
    return speed(long, a, b + long[0].length - chans[0].length, f);
  }

  // A room: six echoes that feed back on themselves (duller each time
  // round), smeared by three more. The classic "Freeverb" layout. Only the
  // stretch goes into the room; its ring carries on after it.
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491], SMEARS = [556, 441, 341];
  function reverb(chans, from, to, rate, { size = 0.5, mix = 0.3 } = {}) {
    const [a, b] = span(chans, from, to);
    const wetLevel = Math.max(0, Math.min(1, mix));
    if (b <= a || !wetLevel) return chans.map((d) => Float32Array.from(d));
    const k = rate / 44100, back = 0.7 + 0.28 * Math.max(0, Math.min(1, size)), dull = 0.25;
    const tail = Math.min(Math.round(rate * 4), Math.round((Math.log(0.001) / Math.log(back)) * COMBS[5] * k));
    return chans.map((x, c) => {
      const line = (len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + c * 23) * k))), i: 0, low: 0 });
      const combs = COMBS.map(line), smears = SMEARS.map(line);
      const feed = 0.09 * Math.sqrt((1 - back) / 0.16); // a bigger room builds up more: feed it less
      const out = new Float32Array(Math.max(x.length, b + tail));
      out.set(x);
      for (let i = a; i < b + tail; i++) {
        const input = (i < b ? x[i] : 0) * feed;
        let wet = 0;
        for (const cb of combs) {
          const y = cb.buf[cb.i];
          cb.low = y * (1 - dull) + cb.low * dull;
          cb.buf[cb.i] = input + cb.low * back;
          cb.i = (cb.i + 1) % cb.buf.length;
          wet += y;
        }
        for (const sm of smears) {
          const y = sm.buf[sm.i];
          sm.buf[sm.i] = wet + y * 0.5;
          sm.i = (sm.i + 1) % sm.buf.length;
          wet = y - wet;
        }
        out[i] += wet * wetLevel;
      }
      return out;
    });
  }

  // Follows how loud the sound is (quick to rise, slower to fall) and turns
  // it down by the ratio whenever that's over the threshold. It listens a
  // hundredth of a second ahead, so it's already turned down when a sudden
  // hit arrives. `touched` says whether anything was over the threshold.
  function compress(chans, from, to, rate, { threshold = -18, ratio = 4 } = {}) {
    const [a, b] = span(chans, from, to);
    const out = chans.map((d) => Float32Array.from(d));
    const before = peak(chans, a, b), rise = Math.exp(-1 / (rate * 0.003)), fall = Math.exp(-1 / (rate * 0.12));
    if (before < 1e-5 || ratio <= 1) return { chans: out, db: 0, touched: false };
    const ahead = Math.round(rate * 0.01);
    let level = 0, touched = false;
    for (let i = a; i < b; i++) {
      let x = 0;
      const j = Math.min(b - 1, i + ahead);
      for (const d of chans) x = Math.max(x, Math.abs(d[j]));
      level = x > level ? rise * level + (1 - rise) * x : fall * level + (1 - fall) * x;
      const over = gainToDb(Math.max(level, 1e-6)) - threshold;
      if (over > 0) { const g = dbToGain(over / ratio - over); for (const d of out) d[i] *= g; touched = true; }
    }
    const up = before / Math.max(peak(out, a, b), 1e-6);
    for (const d of out) for (let i = a; i < b; i++) d[i] *= up;
    return { chans: out, db: gainToDb(up), touched };
  }

  // --- new sounds ---
  const SHAPES = {
    sine: (p) => Math.sin(2 * Math.PI * p),
    square: (p) => (p % 1 < 0.5 ? 1 : -1),
    saw: (p) => 2 * (p % 1) - 1,
    triangle: (p) => 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5),
  };
  // A few milliseconds of fade at each end, so a new sound never clicks.
  function soften(d, rate) {
    const n = Math.min(Math.floor(d.length / 2), Math.round(rate * 0.004));
    for (let i = 0; i < n; i++) { d[i] *= i / n; d[d.length - 1 - i] *= i / n; }
    return d;
  }
  function tone(rate, secs, { shape = "sine", hz = 440, level = 0.5 } = {}) {
    const wave = SHAPES[shape] || SHAPES.sine, d = new Float32Array(Math.max(1, Math.round(secs * rate)));
    for (let i = 0; i < d.length; i++) d[i] = level * wave((i * hz) / rate);
    return [soften(d, rate)];
  }
  function noise(rate, secs, level = 0.5, random = Math.random) {
    const d = new Float32Array(Math.max(1, Math.round(secs * rate)));
    for (let i = 0; i < d.length; i++) d[i] = level * (random() * 2 - 1);
    return [soften(d, rate)];
  }

  // --- help with selecting ---
  // The channels added together: where that crosses zero, a cut won't click.
  const sumAt = (chans, i) => chans.reduce((s, d) => s + d[i], 0);
  function zeroNear(chans, frame, reach) {
    const n = chans[0] ? chans[0].length : 0, at = Math.max(0, Math.min(n, Math.round(frame)));
    if (at === 0 || at >= n) return at; // the ends are quiet points already
    const crosses = (i) => i > 0 && i < n && (sumAt(chans, i - 1) <= 0) !== (sumAt(chans, i) <= 0);
    for (let k = 0; k <= reach; k++) {
      if (crosses(at - k)) return at - k;
      if (crosses(at + k)) return at + k;
      if (at - k <= 0) return 0;
      if (at + k >= n) return n;
    }
    return at;
  }
  function soundSpan(chans, floor = 0.004) {
    const n = chans[0] ? chans[0].length : 0;
    const loud = (i) => chans.some((d) => Math.abs(d[i]) > floor);
    let a = 0, b = n;
    while (a < n && !loud(a)) a++;
    while (b > a && !loud(b - 1)) b--;
    return [a, b];
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

  const api = {
    amplify, normalize, fade, silence, reverse, remove, slice, insert, mix, fit, echo, filter, speed, stretch, pitch,
    reverb, compress, tone, noise,
    zeroNear, soundSpan, peak, outline, afterCut, afterInsert, afterResize, dbToGain, gainToDb,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WaveOps = api;
})(typeof window !== "undefined" ? window : globalThis);
