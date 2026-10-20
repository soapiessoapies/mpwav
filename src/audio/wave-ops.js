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
//   eq(chans, from, to, rate, { bass, mid, treble })  three tone controls, in dB
//   chorus(chans, from, to, rate) / flanger(...)      a copy of the sound, drifting
//                                  slightly late and back: thicker, or swooshing
//   noiseProfile(chans, from, to, rate)   learns what a stretch of plain noise
//                                  (hiss, hum) is made of; null if it's too short
//   denoise(chans, from, to, profile, amount)   takes that noise out of the stretch
//   deleteSilence(chans, from, to, rate, { floor, gap })   cuts out the silences
//                                  longer than `gap` seconds; returns { chans, cuts }
//   ramp(chans, from, to, db0, db1)   loudness sliding from db0 to db1 across the stretch
//   declick(chans, from, to)       mends clicks and pops; returns { chans, count }
//   spectrum(chans, from, to, cols, rows, rate)   a picture of the pitches over
//                                  time: cols x rows of 0..255, low pitches first
//   spectrumHz(row, rows, rate)    the pitch a row of that picture starts at
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
  // Copies of the channels, with `fn(data, a, b, channel)` run on each one's stretch.
  function each(chans, from, to, fn) {
    const [a, b] = span(chans, from, to);
    return chans.map((d, c) => { const out = Float32Array.from(d); fn(out, a, b, c); return out; });
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

  // Two-pole filters (the usual "biquads"), from the well-known cookbook
  // formulas. Each is [b0, b1, b2, a1, a2], already divided by a0.
  const angle = (rate, hz) => (2 * Math.PI * Math.max(10, Math.min(rate * 0.45, hz))) / rate;
  const scaled = (b0, b1, b2, a0, a1, a2) => [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  function passCoefs(rate, kind, hz) { // gentle and without a peak
    const w = angle(rate, hz), cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const edge = kind === "high" ? (1 + cos) / 2 : (1 - cos) / 2;
    return scaled(edge, (kind === "high" ? -2 : 2) * edge, edge, 1 + alpha, -2 * cos, 1 - alpha);
  }
  function shelfCoefs(rate, kind, hz, db) { // everything below (or above) hz, up or down
    const w = angle(rate, hz), cos = Math.cos(w), A = Math.pow(10, db / 40);
    const beta = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.SQRT2, s = kind === "high" ? -1 : 1;
    return scaled(
      A * ((A + 1) - s * (A - 1) * cos + beta), s * 2 * A * ((A - 1) - s * (A + 1) * cos), A * ((A + 1) - s * (A - 1) * cos - beta),
      (A + 1) + s * (A - 1) * cos + beta, -s * 2 * ((A - 1) + s * (A + 1) * cos), (A + 1) + s * (A - 1) * cos - beta);
  }
  function bellCoefs(rate, hz, db, q = 0.7) { // a hump (or dip) around hz
    const w = angle(rate, hz), cos = Math.cos(w), A = Math.pow(10, db / 40), alpha = Math.sin(w) / (2 * q);
    return scaled(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
  }
  // Runs filters one after another over the stretch. Each starts as if the
  // sound had always been at its first value, so there's no thump.
  function runFilters(chans, from, to, list) {
    return each(chans, from, to, (d, a, b) => {
      for (const [b0, b1, b2, a1, a2] of list) {
        const steady = (b0 + b1 + b2) / (1 + a1 + a2);
        let x1 = d[a] || 0, x2 = x1, y1 = x1 * steady, y2 = y1;
        for (let i = a; i < b; i++) {
          const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y;
          d[i] = y;
        }
      }
    });
  }
  const filter = (chans, from, to, rate, kind, hz) => runFilters(chans, from, to, [passCoefs(rate, kind, hz)]);
  // Bass below 200 Hz, treble above 4000 Hz, and the middle around 1000 Hz.
  function eq(chans, from, to, rate, { bass = 0, mid = 0, treble = 0 } = {}) {
    const list = [];
    if (bass) list.push(shelfCoefs(rate, "low", 200, bass));
    if (mid) list.push(bellCoefs(rate, 1000, mid));
    if (treble) list.push(shelfCoefs(rate, "high", 4000, treble));
    return runFilters(chans, from, to, list);
  }

  // A copy of the stretch that drifts late and back (a slow wobble),
  // mixed in under it. `feedback` sends the copy round again (the swoosh).
  function sweep(chans, from, to, rate, { base, depth, hz, mix, feedback = 0, voices = 1 }) {
    return each(chans, from, to, (d, a, b, c) => {
      const dry = d.slice(a, b), n = b - a;
      const fed = new Float32Array(n); // the dry sound plus what's been fed back
      for (let i = 0; i < n; i++) {
        let wet = 0;
        for (let v = 0; v < voices; v++) {
          const turn = 2 * Math.PI * ((hz * (1 + v * 0.13) * i) / rate + v / voices + c * 0.25); // each side a quarter-turn apart: wider
          const late = (base + depth * (0.5 + 0.5 * Math.sin(turn))) * rate, at = i - late, k = Math.floor(at);
          if (k >= 0) wet += fed[k] * (1 - (at - k)) + (k + 1 < n ? fed[k + 1] : 0) * (at - k);
        }
        wet /= voices;
        fed[i] = dry[i] + wet * feedback;
        d[a + i] = 0.8 * (dry[i] + wet * mix);
      }
    });
  }
  const chorus = (chans, from, to, rate) => sweep(chans, from, to, rate, { base: 0.018, depth: 0.006, hz: 0.7, mix: 0.6, voices: 2 });
  const flanger = (chans, from, to, rate) => sweep(chans, from, to, rate, { base: 0.001, depth: 0.004, hz: 0.25, mix: 0.7, feedback: 0.5 });

  // --- noise reduction: the sound is cut into short overlapping slices,
  // each turned into its pitches (an FFT); every pitch is turned down by
  // however much of it the learned noise explains; then it's put back. ---
  const SLICE = 1024, STEP = SLICE / 4;
  const HANN = Float32Array.from({ length: SLICE }, (_, j) => 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / SLICE));
  // In place, for a power-of-two length. `back` undoes it.
  function fft(re, im, back) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const turn = ((back ? 2 : -2) * Math.PI) / len, wr = Math.cos(turn), wi = Math.sin(turn);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2;
          const xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - xr; im[q] = im[p] - xi;
          re[p] += xr; im[p] += xi;
          const next = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = next;
        }
      }
    }
    if (back) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  // How loud each pitch is, on average, across a stretch of plain noise.
  function noiseProfile(chans, from, to, rate) {
    const [a, b] = span(chans, from, to);
    if (b - a < SLICE) return null;
    const level = new Float32Array(SLICE / 2 + 1), re = new Float32Array(SLICE), im = new Float32Array(SLICE);
    let slices = 0;
    for (const d of chans) {
      for (let at = a; at + SLICE <= b; at += STEP) {
        for (let j = 0; j < SLICE; j++) { re[j] = d[at + j] * HANN[j]; im[j] = 0; }
        fft(re, im);
        for (let k = 0; k < level.length; k++) level[k] += Math.hypot(re[k], im[k]);
        slices++;
      }
    }
    for (let k = 0; k < level.length; k++) level[k] /= slices;
    return { level, rate };
  }
  // amount 0..1: how hard to press. Higher takes more noise, and more of
  // the sound's own quiet detail with it.
  function denoise(chans, from, to, profile, amount = 0.8) {
    const [a, b] = span(chans, from, to), press = 0.5 + 2 * amount, least = 0.02 + (1 - amount) * 0.5;
    const half = SLICE / 2, re = new Float32Array(SLICE), im = new Float32Array(SLICE);
    const gain = new Float32Array(half + 1), smooth = new Float32Array(half + 1);
    return chans.map((d) => {
      const out = Float32Array.from(d);
      if (b <= a) return out;
      const sum = new Float32Array(b - a);
      const before = new Float32Array(half + 1);
      for (let at = a - SLICE + STEP; at < b; at += STEP) {
        for (let j = 0; j < SLICE; j++) { const i = at + j; re[j] = (i >= 0 && i < d.length ? d[i] : 0) * HANN[j]; im[j] = 0; }
        fft(re, im);
        for (let k = 0; k <= half; k++) {
          const size = Math.hypot(re[k], im[k]);
          gain[k] = size > 1e-9 ? Math.max(least, 1 - (press * profile.level[k]) / size) : least;
        }
        for (let k = 0; k <= half; k++) {
          // Evened out across neighbouring pitches and from slice to slice, or it warbles.
          const near = (gain[Math.max(0, k - 1)] + gain[k] + gain[Math.min(half, k + 1)]) / 3;
          smooth[k] = Math.max(near, before[k] * 0.6);
        }
        before.set(smooth);
        for (let k = 0; k <= half; k++) {
          re[k] *= smooth[k]; im[k] *= smooth[k];
          if (k > 0 && k < half) { re[SLICE - k] *= smooth[k]; im[SLICE - k] *= smooth[k]; }
        }
        fft(re, im, true);
        for (let j = 0; j < SLICE; j++) { const i = at + j - a; if (i >= 0 && i < sum.length) sum[i] += re[j] * HANN[j]; }
      }
      for (let i = 0; i < sum.length; i++) out[a + i] = sum[i] / 1.5; // four overlapping slices add up to 1.5
      return out;
    });
  }

  // A straight slide in decibels, which is how loudness is heard.
  function ramp(chans, from, to, db0, db1) {
    return each(chans, from, to, (d, a, b) => {
      const n = Math.max(1, b - a - 1);
      for (let i = a; i < b; i++) d[i] *= dbToGain(db0 + ((db1 - db0) * (i - a)) / n);
    });
  }

  // A click is a few samples that jump away from the wave and come straight
  // back. Each one found is replaced by a straight line across it. A jump
  // that stays where it lands (the edge of a square wave, a drum hit) is
  // left alone.
  function declick(chans, from, to) {
    const [a, b] = span(chans, from, to), WIDEST = 24;
    let count = 0;
    const out = chans.map((x) => {
      const d = Float32Array.from(x);
      if (b - a < 8) return d;
      // How sharply the wave bends at each sample, and what's usual for this sound.
      const bend = (i) => Math.abs(d[i - 1] - 2 * d[i] + d[i + 1]);
      let usual = 0;
      for (let i = a + 1; i < b - 1; i++) usual += bend(i);
      usual /= b - a - 2;
      const limit = Math.max(usual * 12, 0.02);
      for (let i = a + 1; i < b - 1; i++) {
        if (bend(i) <= limit) continue;
        let end = i;
        while (end + 1 < b - 1 && end - i < WIDEST && bend(end + 1) > limit) end++;
        const s = Math.max(a, i - 2), e = Math.min(b - 1, end + 2);
        // How far it strays from a straight line across the gap, and how far
        // the far side is from where the wave was heading anyway.
        const line = (j) => d[s] + ((d[e] - d[s]) * (j - s)) / (e - s);
        let height = 0;
        for (let j = s; j <= e; j++) height = Math.max(height, Math.abs(d[j] - line(j)));
        const heading = ((s > 0 ? d[s] - d[s - 1] : 0) + (e + 1 < d.length ? d[e + 1] - d[e] : 0)) / 2;
        if (Math.abs(d[e] - d[s] - heading * (e - s)) < height * 0.5) { // it came back: a click
          for (let j = s + 1; j < e; j++) d[j] = d[s] + ((d[e] - d[s]) * (j - s)) / (e - s);
          count++;
        }
        i = e;
      }
      return d;
    });
    return { chans: out, count };
  }

  // The pitches over time, for the spectral view: `cols` moments across the
  // stretch, each split into `rows` bands from 50 Hz up to the highest
  // pitch the sound can hold, evenly spaced as the ear hears them. 255 is
  // a full-volume tone; 0 is 80 dB below that, or quieter.
  const LOWEST_HZ = 50;
  const spectrumHz = (row, rows, rate) => LOWEST_HZ * Math.pow(rate / 2 / LOWEST_HZ, row / rows);
  function spectrum(chans, from, to, cols, rows, rate) {
    const [a, b] = span(chans, from, to), out = new Uint8Array(cols * rows);
    const re = new Float32Array(SLICE), im = new Float32Array(SLICE), n = chans[0] ? chans[0].length : 0;
    const edges = Array.from({ length: rows + 1 }, (_, r) => (spectrumHz(r, rows, rate) * SLICE) / rate);
    for (let c = 0; c < cols; c++) {
      const mid = a + Math.round(((c + 0.5) * (b - a)) / cols) - SLICE / 2;
      for (let j = 0; j < SLICE; j++) {
        const i = mid + j;
        let v = 0;
        if (i >= 0 && i < n) for (const d of chans) v += d[i];
        re[j] = (v / chans.length) * HANN[j];
        im[j] = 0;
      }
      fft(re, im);
      for (let r = 0; r < rows; r++) {
        const lo = Math.max(1, Math.round(edges[r])), hi = Math.min(SLICE / 2, Math.max(lo + 1, Math.round(edges[r + 1])));
        let size = 0;
        for (let k = lo; k < hi; k++) size = Math.max(size, Math.hypot(re[k], im[k]));
        const db = gainToDb(Math.max(size / (SLICE / 4), 1e-9));
        out[c * rows + r] = Math.max(0, Math.min(255, Math.round(((db + 80) / 80) * 255)));
      }
    }
    return out;
  }

  // Cuts out every run of silence longer than `gap` seconds, leaving a
  // fiftieth of a second of it on each side so no sound is clipped short.
  // `cuts` lists what went, as [from, to) frames of the sound as it was.
  function deleteSilence(chans, from, to, rate, { floor = 0.004, gap = 0.3 } = {}) {
    const [a, b] = span(chans, from, to), keep = Math.round(rate * 0.02), least = Math.max(1, Math.round(gap * rate));
    const cuts = [];
    let run = a;
    const quiet = (i) => chans.every((d) => Math.abs(d[i]) <= floor);
    for (let i = a; i <= b; i++) {
      if (i < b && quiet(i)) continue;
      if (i - run >= least) {
        // A silence at the very start or end of the stretch goes right to its edge.
        const s = run === a ? a : run + keep, e = i === b ? b : i - keep;
        if (e > s) cuts.push([s, e]);
      }
      run = i + 1;
    }
    let out = chans.map((d) => Float32Array.from(d));
    for (let k = cuts.length - 1; k >= 0; k--) out = remove(out, cuts[k][0], cuts[k][1]);
    return { chans: out, cuts };
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

  // Sound-design exports ---------------------------------------------------

  // The parts of a sound between its markers (and its trim points): each
  // { from, to, name } in seconds, in order. Markers outside the part kept
  // are ignored; parts shorter than 10 ms are dropped. With no markers inside,
  // the whole kept part is one section.
  function sections(start, end, cues = []) {
    const inside = [...cues].filter((q) => q.t > start + 0.005 && q.t < end - 0.005).sort((a, b) => a.t - b.t);
    const cuts = [{ t: start, name: "" }, ...inside, { t: end, name: "" }];
    const out = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1].t - cuts[i].t < 0.01) continue;
      out.push({ from: cuts[i].t, to: cuts[i + 1].t, name: cuts[i].name || "" });
    }
    return out;
  }

  // Variations of one sound, so a sound that plays again and again isn't the
  // same every time: each copy is sped up or slowed down a little (pitch and
  // length move together, like tape) and made a little louder or quieter.
  //   count   how many (2..12)
  //   pitch   most semitones up or down (0..12)
  //   volume  most dB up or down (0..12)
  // Returns [{ chans, semitones, db }]; the first copy is always the sound as
  // it is, so the set includes the original.
  function variations(chans, { count = 4, pitch = 1, volume = 2, random = Math.random } = {}) {
    const n = Math.max(2, Math.min(12, Math.round(count)));
    const out = [{ chans: chans.map((d) => Float32Array.from(d)), semitones: 0, db: 0 }];
    const m = n - 1; // copies
    for (let i = 1; i < n; i++) {
      // Spread evenly from below to above, shuffled a little, so no two match;
      // the one that would land in the middle (an odd count) goes a little up or down.
      let t = m === 1 ? 1 : ((i - 1) / (m - 1)) * 2 - 1;
      if (Math.abs(t) < 0.2) t = random() < 0.5 ? -0.4 : 0.4;
      const k = Math.max(0, Math.min(12, pitch));
      const semitones = Math.round(t * k * (0.7 + 0.3 * random()) * 100) / 100;
      const db = Math.round((random() * 2 - 1) * Math.max(0, Math.min(12, volume)) * 10) / 10;
      const len = chans[0].length;
      const sped = semitones ? speed(chans, 0, len, Math.pow(2, semitones / 12)) : chans.map((d) => Float32Array.from(d));
      const g = dbToGain(db);
      out.push({ chans: sped.map((d) => d.map((v) => Math.max(-1, Math.min(1, v * g)))), semitones, db });
    }
    return out;
  }

  // One click for a spoken take (a voice-over): trims the silent ends (keeping
  // a breath of room), takes out rumble below 80 Hz, reduces the steady
  // background noise (learned from the quietest quarter second, if it's
  // quiet enough to be room noise), evens the level to just under full
  // (-1 dB) and fades the edges so nothing clicks. Returns { chans, move,
  // steps: [words] }; move(t) maps old seconds to new ones (the trim).
  function voiceCleanup(chans, rate) {
    const steps = [];
    const n = chans[0].length;
    const hi = peak(chans, 0, n);
    if (!n || hi < 1e-4) return { chans: chans.map((d) => Float32Array.from(d)), move: (t) => t, steps: ["it's silent: nothing to clean"] };
    // Loudness per 10 ms.
    const hop = Math.max(1, Math.round(rate * 0.01));
    const frames = Math.floor(n / hop);
    const lvl = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (const d of chans) for (let i = f * hop; i < (f + 1) * hop; i++) sum += d[i] * d[i];
      lvl[f] = Math.sqrt(sum / (hop * chans.length));
    }
    const peakLvl = Math.max(...lvl);
    const loud = (f) => lvl[f] > peakLvl * 0.03; // within about 30 dB of the loudest
    let first = 0, last = frames - 1;
    while (first < frames && !loud(first)) first++;
    while (last > first && !loud(last)) last--;
    const pad = Math.round(0.12 / 0.01); // 120 ms of room either side
    const a = Math.max(0, (first - pad) * hop), b = Math.min(n, (last + 1 + pad) * hop);
    let out = chans.map((d) => d.slice(a, b));
    if (a > 0 || b < n) steps.push(`trimmed ${((n - (b - a)) / rate).toFixed(2)} s of silence from the ends`);
    out = filter(out, 0, out[0].length, rate, "high", 80);
    steps.push("took out rumble under 80 Hz");
    // The quietest quarter second, as the room's noise (only if it's quiet: not a word).
    const win = Math.round(0.25 / 0.01);
    if (frames > win * 3) {
      let best = Infinity, at = -1;
      for (let f = 0; f + win <= frames; f += 2) {
        let s = 0;
        for (let k = f; k < f + win; k++) s += lvl[k];
        if (s < best) { best = s; at = f; }
      }
      const quiet = best / win;
      if (quiet > 1e-5 && quiet < peakLvl * 0.1) {
        // Learned from the original (the quietest stretch is often in the trimmed-off ends).
        const prof = noiseProfile(chans, at * hop, (at + win) * hop, rate);
        if (prof) { out = denoise(out, 0, out[0].length, prof, 0.6); steps.push("reduced the background noise"); }
      }
    }
    out = normalize(out, 0, out[0].length).chans;
    out = scale(out, 0, out[0].length, dbToGain(-1));
    steps.push("evened the level to -1 dB");
    const edge = Math.min(Math.round(rate * 0.01), Math.floor(out[0].length / 4));
    out = fade(out, 0, edge, "in");
    out = fade(out, out[0].length - edge, out[0].length, "out");
    const shift = a / rate, len = (b - a) / rate;
    return { chans: out, move: (t) => Math.max(0, Math.min(len, t - shift)), steps };
  }

  const api = {
    sections, variations, voiceCleanup,
    amplify, normalize, fade, silence, reverse, remove, slice, insert, mix, fit, echo, filter, speed, stretch, pitch,
    reverb, compress, eq, chorus, flanger, noiseProfile, denoise, deleteSilence, ramp, declick, spectrum, spectrumHz,
    tone, noise,
    zeroNear, soundSpan, peak, outline, afterCut, afterInsert, afterResize, dbToGain, gainToDb,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WaveOps = api;
})(typeof window !== "undefined" ? window : globalThis);
