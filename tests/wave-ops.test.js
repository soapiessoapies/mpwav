const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../src/audio/wave-ops.js");

const sound = (...chans) => chans.map((c) => Float32Array.from(c));
const list = (chans) => chans.map((d) => Array.from(d, (v) => +v.toFixed(4)));

test("edits return new channels and leave the sound they came from alone", () => {
  const src = sound([0.1, 0.2, 0.3, 0.4]);
  for (const out of [W.amplify(src, 0, 4, 6), W.fade(src, 0, 4, "in"), W.silence(src, 1, 3), W.reverse(src, 0, 4), W.remove(src, 1, 2), W.normalize(src, 0, 4).chans]) {
    assert.notEqual(out[0], src[0]);
  }
  assert.deepEqual(list(src), [[0.1, 0.2, 0.3, 0.4]]);
});

test("amplify changes only the stretch, on every channel", () => {
  const out = W.amplify(sound([0.1, 0.1, 0.1, 0.1], [0.2, 0.2, 0.2, 0.2]), 1, 3, 20 * Math.log10(2));
  assert.deepEqual(list(out), [[0.1, 0.2, 0.2, 0.1], [0.2, 0.4, 0.4, 0.2]]);
});

test("normalize brings the stretch's loudest sample to full scale and says by how much", () => {
  const { chans, db } = W.normalize(sound([0.9, 0.25, -0.5, 0.9]), 1, 3);
  assert.deepEqual(list(chans), [[0.9, 0.5, -1, 0.9]]);
  assert.ok(Math.abs(db - 6.0206) < 0.001);
});

test("normalize leaves silence alone", () => {
  const { chans, db } = W.normalize(sound([0, 0, 0]), 0, 3);
  assert.equal(db, 0);
  assert.deepEqual(list(chans), [[0, 0, 0]]);
});

test("fade in rises from silence, fade out falls to it", () => {
  assert.deepEqual(list(W.fade(sound([1, 1, 1, 1, 1]), 0, 4, "in")), [[0, 0.25, 0.5, 0.75, 1]]);
  assert.deepEqual(list(W.fade(sound([1, 1, 1, 1, 1]), 1, 5, "out")), [[1, 0.75, 0.5, 0.25, 0]]);
});

test("silence and reverse work on the stretch only", () => {
  assert.deepEqual(list(W.silence(sound([1, 2, 3, 4]), 1, 3)), [[1, 0, 0, 4]]);
  assert.deepEqual(list(W.reverse(sound([1, 2, 3, 4, 5]), 1, 4)), [[1, 4, 3, 2, 5]]);
});

test("remove cuts the stretch out and closes the gap", () => {
  assert.deepEqual(list(W.remove(sound([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]), 1, 3)), [[1, 4, 5], [6, 9, 10]]);
});

test("a stretch outside the sound is clamped to it", () => {
  assert.deepEqual(list(W.silence(sound([1, 2, 3]), -5, 99)), [[0, 0, 0]]);
  assert.deepEqual(list(W.remove(sound([1, 2, 3]), 2, 99)), [[1, 2]]);
  assert.deepEqual(list(W.silence(sound([1, 2, 3]), 2, 1)), [[1, 2, 3]], "a backwards stretch is empty");
});

test("afterCut moves trim points with a cut", () => {
  assert.equal(W.afterCut(0.5, 1, 2), 0.5, "before the cut: stays");
  assert.equal(W.afterCut(1.5, 1, 2), 1, "inside it: lands where the cut was");
  assert.equal(W.afterCut(3, 1, 2), 2, "after it: moves earlier by the cut's length");
});

test("slice copies just the stretch", () => {
  assert.deepEqual(list(W.slice(sound([1, 2, 3, 4], [5, 6, 7, 8]), 1, 3)), [[2, 3], [6, 7]]);
});

test("insert puts a piece in and makes the sound longer", () => {
  assert.deepEqual(list(W.insert(sound([1, 2, 3]), 1, sound([8, 9]))), [[1, 8, 9, 2, 3]]);
  assert.deepEqual(list(W.insert(sound([1, 2, 3]), 3, sound([8]))), [[1, 2, 3, 8]], "at the end");
  assert.deepEqual(list(W.insert(sound([1, 2], [3, 4]), 0, sound([9]))), [[9, 1, 2], [9, 3, 4]], "a mono piece goes on both sides");
});

test("mix lays a piece on top, and runs past the end if it has to", () => {
  assert.deepEqual(list(W.mix(sound([0.1, 0.1, 0.1]), 1, sound([0.2, 0.2]))), [[0.1, 0.3, 0.3]]);
  assert.deepEqual(list(W.mix(sound([0.1, 0.1]), 1, sound([0.2, 0.2, 0.2]))), [[0.1, 0.3, 0.2, 0.2]]);
});

test("fit matches a copied piece to another sound's channels", () => {
  assert.deepEqual(list(W.fit(sound([1, 2]), 100, 100, 2)), [[1, 2], [1, 2]], "mono to stereo");
  assert.deepEqual(list(W.fit(sound([1, 0], [0, 1]), 100, 100, 1)), [[0.5, 0.5]], "stereo to mono");
});

test("fit stretches a piece to another sample rate, keeping its length in time", () => {
  const up = W.fit(sound([0, 1, 0, -1]), 100, 200, 1);
  assert.equal(up[0].length, 8);
  assert.deepEqual(list(up)[0].slice(0, 5), [0, 0.5, 1, 0.5, 0]);
  assert.equal(W.fit(sound([0, 1, 0, -1, 0, 1, 0, -1]), 200, 100, 1)[0].length, 4);
});

test("afterInsert moves later points along, and leaves one at the paste alone", () => {
  assert.equal(W.afterInsert(1, 2, 0.5), 1);
  assert.equal(W.afterInsert(2, 2, 0.5), 2);
  assert.equal(W.afterInsert(3, 2, 0.5), 3.5);
});

test("peak finds the loudest sample of any channel in the stretch", () => {
  assert.ok(Math.abs(W.peak(sound([0.1, -0.7, 0.2], [0.3, 0.1, 0.9]), 0, 2) - 0.7) < 1e-6);
});

test("outline gives min and max per point across the stretch", () => {
  const out = W.outline(sound([0.5, -0.5, 1, -1, 0.2, 0.1, 9, 9]), 0, 6, 3);
  assert.deepEqual(Array.from(out, (v) => +v.toFixed(2)), [-0.5, 0.5, -1, 1, 0, 0.2]);
});

test("outline zoomed in past one sample per point still draws something", () => {
  const out = W.outline(sound([0.5, -0.5]), 0, 2, 4);
  assert.deepEqual(Array.from(out), [0, 0.5, 0, 0.5, -0.5, 0, -0.5, 0]);
});

test("echo repeats the stretch, each repeat quieter, and rings on past the end", () => {
  const out = W.echo(sound([1, 0, 0, 0]), 0, 1, 2, { delay: 1, feedback: 0.5 }); // 2 frames a second: a 2-frame delay
  assert.deepEqual(Array.from(out[0].slice(0, 7), (v) => +v.toFixed(3)), [1, 0, 0.5, 0, 0.25, 0, 0.125]);
  assert.ok(out[0].length > 4, "the sound got longer to hold the tail");
});

test("echo only echoes the stretch, not what follows it", () => {
  const out = W.echo(sound([1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 0, 2, 1, { delay: 2, feedback: 0.5 });
  assert.equal(+out[0][2].toFixed(3), 0.5);
  assert.equal(+out[0][4].toFixed(3), 1.25, "the later hit plays over the echo");
  assert.equal(+out[0][6].toFixed(3), 0.125, "but leaves no echo of its own");
});

test("a low-pass keeps a low tone and takes out a high one; a high-pass does the opposite", () => {
  const rate = 8000, low = W.tone(rate, 0.5, { hz: 100, level: 1 }), high = W.tone(rate, 0.5, { hz: 3000, level: 1 });
  const loud = (chans) => W.peak(chans, 1000, 3000);
  assert.ok(loud(W.filter(low, 0, 4000, rate, "low", 500)) > 0.9);
  assert.ok(loud(W.filter(high, 0, 4000, rate, "low", 500)) < 0.1);
  assert.ok(loud(W.filter(low, 0, 4000, rate, "high", 1500)) < 0.1);
  assert.ok(loud(W.filter(high, 0, 4000, rate, "high", 1500)) > 0.9);
});

test("a filter leaves the sound outside the stretch alone", () => {
  const out = W.filter(sound([1, -1, 1, -1, 1, -1]), 2, 4, 8000, "low", 200);
  assert.deepEqual([out[0][0], out[0][1], out[0][4], out[0][5]], [1, -1, 1, -1]);
});

test("speed: twice as fast is half as long, and only the stretch changes", () => {
  const out = W.speed(sound([9, 0, 1, 2, 3, 4, 5, 6, 7, 9]), 1, 9, 2);
  assert.deepEqual(list(out), [[9, 0, 2, 4, 6, 9]]);
  assert.equal(W.speed(sound([0, 1, 2, 3]), 0, 4, 0.5)[0].length, 8, "half speed is twice as long");
});

test("afterResize moves trim points with a stretch that changed length", () => {
  assert.equal(W.afterResize(0.5, 1, 3, 1), 0.5);
  assert.equal(W.afterResize(2, 1, 3, 1), 1.5, "inside: in proportion");
  assert.equal(W.afterResize(4, 1, 3, 1), 3, "after: by the difference");
});

test("tone: the right length, level and pitch, starting and ending at silence", () => {
  const [d] = W.tone(1000, 1, { hz: 10, level: 0.5 });
  assert.equal(d.length, 1000);
  assert.equal(Math.abs(d[0]), 0);
  assert.equal(Math.abs(d[999]), 0);
  assert.ok(Math.abs(W.peak([d], 0, 1000) - 0.5) < 0.01);
  let ups = 0;
  for (let i = 1; i < 1000; i++) if (d[i - 1] <= 0 && d[i] > 0) ups++;
  assert.equal(ups, 10, "ten cycles in a second");
  for (const shape of ["square", "saw", "triangle"]) assert.ok(W.peak(W.tone(1000, 0.2, { shape, hz: 50, level: 1 }), 0, 200) > 0.9, shape);
});

test("noise stays inside its level", () => {
  let seed = 1;
  const [d] = W.noise(1000, 0.5, 0.3, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  assert.equal(d.length, 500);
  const p = W.peak([d], 0, 500);
  assert.ok(p > 0.2 && p <= 0.3);
});

test("zeroNear finds the closest zero crossing, and leaves the ends alone", () => {
  const s = sound([0.5, 0.4, 0.3, -0.2, -0.4, -0.3, 0.1, 0.5]);
  assert.equal(W.zeroNear(s, 2, 10), 3);
  assert.equal(W.zeroNear(s, 5, 10), 6);
  assert.equal(W.zeroNear(s, 0, 10), 0);
  assert.equal(W.zeroNear(s, 8, 10), 8);
  assert.equal(W.zeroNear(sound([1, 1, 1, 1, 1, 1]), 3, 1), 3, "none in reach: stays put");
});

test("soundSpan is the sound without its silent ends", () => {
  assert.deepEqual(W.soundSpan(sound([0, 0.001, 0.5, 0, 0.2, 0, 0])), [2, 5]);
  assert.deepEqual(W.soundSpan(sound([0, 0, 0], [0, 0.3, 0])), [1, 2], "any channel counts");
  assert.deepEqual(W.soundSpan(sound([0, 0, 0])), [3, 3], "all silent: nothing");
});

// How many times a second the wave rises through zero: its pitch.
const pitchOf = (d, rate, from, to) => {
  let ups = 0;
  for (let i = from + 1; i < to; i++) if (d[i - 1] <= 0 && d[i] > 0) ups++;
  return (ups * rate) / (to - from);
};

test("stretch makes a tone twice as long, or half, at the same pitch and level", () => {
  const rate = 8000, src = W.tone(rate, 1, { hz: 220, level: 0.8 });
  for (const ratio of [2, 0.5, 1.3]) {
    const [d] = W.stretch(src, 0, rate, rate, ratio);
    assert.equal(d.length, Math.round(rate * ratio), "length x" + ratio);
    const hz = pitchOf(d, rate, 400, d.length - 400);
    assert.ok(Math.abs(hz - 220) < 6, `pitch stays 220 at x${ratio}, got ${hz.toFixed(1)}`);
    const p = W.peak([d], 400, d.length - 400);
    assert.ok(p > 0.7 && p < 0.9, `level kept at x${ratio}, got ${p.toFixed(2)}`);
  }
});

test("stretch changes only the stretch, on every channel", () => {
  const rate = 8000, t = W.tone(rate, 1, { hz: 200, level: 0.5 })[0];
  const out = W.stretch([t, Float32Array.from(t, (v) => -v)], 2000, 6000, rate, 1.5);
  assert.equal(out.length, 2);
  assert.equal(out[0].length, 8000 + 2000);
  assert.deepEqual(Array.from(out[0].slice(0, 2000)), Array.from(t.slice(0, 2000)));
  assert.deepEqual(Array.from(out[1].slice(-2000)), Array.from(t.slice(-2000), (v) => -v));
});

test("pitch moves a tone up an octave without changing its length", () => {
  const rate = 8000, src = W.tone(rate, 1, { hz: 220, level: 0.8 });
  const [d] = W.pitch(src, 0, rate, rate, 12);
  assert.ok(Math.abs(d.length - rate) <= 2, "same length");
  const hz = pitchOf(d, rate, 400, d.length - 400);
  assert.ok(Math.abs(hz - 440) < 12, "an octave up, got " + hz.toFixed(1));
  const down = pitchOf(W.pitch(src, 0, rate, rate, -12)[0], rate, 400, rate - 400);
  assert.ok(Math.abs(down - 110) < 6, "an octave down, got " + down.toFixed(1));
});

test("reverb rings on after the sound, longer in a bigger room, and leaves the start alone", () => {
  const rate = 8000, click = [Float32Array.from({ length: rate }, (_, i) => (i === 1000 ? 1 : 0))];
  const small = W.reverb(click, 1000, 1100, rate, { size: 0.1, mix: 1 });
  const big = W.reverb(click, 1000, 1100, rate, { size: 0.9, mix: 1 });
  assert.equal(W.peak(small, 0, 1000), 0, "nothing before the stretch");
  assert.equal(small[0][1000], 1, "the dry sound is still there");
  assert.ok(W.peak(small, 1300, 3000) > 0.001, "a ring after it");
  assert.ok(big[0].length > small[0].length, "a bigger room rings for longer");
  const late = (chans) => W.peak(chans, 6000, 8000);
  assert.ok(late(big) > late(small) * 3, "and is still going when the small one has died away");
  assert.ok(W.peak(big, 1001, big[0].length) < 1, "without getting louder than the sound");
});

test("reverb on a steady tone stays in range", () => {
  const rate = 8000, src = W.tone(rate, 1, { hz: 300, level: 0.5 });
  const out = W.reverb(src, 0, rate, rate, { size: 1, mix: 1 });
  assert.ok(W.peak(out, 0, out[0].length) < 1.2, "peak " + W.peak(out, 0, out[0].length).toFixed(2));
});

test("compress brings the quiet part up towards the loud part, and keeps the peak", () => {
  const rate = 8000, quiet = W.tone(rate, 0.5, { hz: 200, level: 0.05 })[0], loud = W.tone(rate, 0.5, { hz: 200, level: 0.8 })[0];
  const src = [Float32Array.from([...quiet, ...loud])];
  const { chans, db } = W.compress(src, 0, rate, rate, { threshold: -24, ratio: 4 });
  assert.ok(db > 3, "turned back up by " + db.toFixed(1) + " dB");
  assert.ok(Math.abs(W.peak(chans, 0, rate) - 0.8) < 0.01, "same peak");
  const gap = (c) => W.peak(c, 4500, 7500) / W.peak(c, 500, 3500);
  assert.ok(gap(chans) < gap(src) / 2, "the gap between loud and quiet at least halves");
  assert.equal(W.compress(src, 0, rate, rate, { ratio: 1 }).db, 0, "a ratio of 1 changes nothing");
  assert.equal(W.compress(src, 0, rate, rate, { threshold: 0 }).touched, false, "nothing is over 0 dB");
});

test("compress catches a sudden hit: it's listening a moment ahead", () => {
  const rate = 8000, d = new Float32Array(rate);
  for (let i = 2000; i < rate; i++) d[i] = 0.8 * Math.sin((2 * Math.PI * 200 * i) / rate) * Math.exp(-(i - 2000) / 800);
  const { db, touched } = W.compress([d], 0, rate, rate, { threshold: -18, ratio: 4 });
  assert.ok(touched);
  assert.ok(db > 3, "the hit was turned down, so the rest comes up " + db.toFixed(1) + " dB");
});

const steady = (chans, rate) => W.peak(chans, rate / 4, (rate * 3) / 4);

test("eq: bass, mid and treble each move their own part of the sound", () => {
  const rate = 16000;
  const at = (hz, set) => steady(W.eq(W.tone(rate, 1, { hz, level: 0.25 }), 0, rate, rate, set), rate) / 0.25;
  assert.ok(at(60, { bass: 12 }) > 3.5, "bass up 12 dB lifts 60 Hz about 4x");
  assert.ok(Math.abs(at(5000, { bass: 12 }) - 1) < 0.1, "and leaves 5000 Hz alone");
  assert.ok(at(7000, { treble: -12 }) < 0.3, "treble down 12 dB");
  assert.ok(Math.abs(at(100, { treble: -12 }) - 1) < 0.1);
  assert.ok(at(1000, { mid: 6 }) > 1.8 && at(1000, { mid: 6 }) < 2.2, "mid up 6 dB doubles 1000 Hz");
  assert.ok(Math.abs(at(60, { mid: 6 }) - 1) < 0.15);
  assert.ok(Math.abs(at(1000, {}) - 1) < 1e-6, "all at 0: unchanged");
});

test("chorus and flanger change the sound inside the stretch only, at a sane level", () => {
  const rate = 8000, src = W.tone(rate, 1, { hz: 220, level: 0.5 });
  for (const fx of [W.chorus, W.flanger]) {
    const out = fx(src, 2000, 6000, rate);
    assert.equal(out[0].length, rate);
    assert.deepEqual(Array.from(out[0].slice(0, 2000)), Array.from(src[0].slice(0, 2000)));
    assert.deepEqual(Array.from(out[0].slice(6000)), Array.from(src[0].slice(6000)));
    let diff = 0;
    for (let i = 2000; i < 6000; i++) diff = Math.max(diff, Math.abs(out[0][i] - src[0][i]));
    assert.ok(diff > 0.05, "it did something");
    assert.ok(W.peak(out, 2000, 6000) < 1, "and didn't blow up");
  }
});

test("noise reduction: learns hiss from a quiet stretch, then takes it out and keeps the tone", () => {
  const rate = 8000;
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hiss = W.noise(rate, 2, 0.05, rand)[0], note = W.tone(rate, 1, { hz: 440, level: 0.5 })[0];
  const d = Float32Array.from(hiss);
  for (let i = 0; i < rate; i++) d[rate + i] += note[i]; // second 1: hiss alone; second 2: the tone in hiss
  const rms = (x, from, to) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / (to - from)); };
  const profile = W.noiseProfile([d], 0, rate / 2, rate);
  assert.ok(profile && profile.level.length === 513);
  assert.equal(W.noiseProfile([d], 0, 500, rate), null, "too short a stretch to learn from");
  const [out] = W.denoise([d], 0, d.length, profile, 0.8);
  assert.equal(out.length, d.length);
  assert.ok(rms(out, 4000, 7000) < rms(d, 4000, 7000) / 4, "the hiss alone drops by 12 dB or more");
  const kept = rms(out, rate + 2000, rate + 6000) / rms(note, 2000, 6000);
  assert.ok(kept > 0.9 && kept < 1.1, "the tone is as loud as it was, got " + kept.toFixed(2));
});

test("noise reduction at 0 changes almost nothing, and only inside the stretch", () => {
  const rate = 8000, src = W.tone(rate, 1, { hz: 300, level: 0.5 });
  const profile = W.noiseProfile(W.noise(rate, 0.5, 0.01, () => 0.7), 0, 4000, rate);
  const [out] = W.denoise(src, 2000, 6000, { level: new Float32Array(513), rate }, 0.8);
  let diff = 0;
  for (let i = 0; i < rate; i++) diff = Math.max(diff, Math.abs(out[i] - src[0][i]));
  assert.ok(diff < 1e-3, "an empty noise profile puts the sound back as it was, off by " + diff);
  assert.ok(profile);
});

test("delete silence cuts out the long gaps and keeps the short ones", () => {
  const rate = 1000, d = new Float32Array(3400);
  d.fill(0.5, 200, 700);   // sound
  d.fill(0.5, 800, 1200);  // after a short gap (100 ms): kept
  d.fill(0.5, 2200, 2800); // after a long gap (1 s): cut
  const { chans, cuts } = W.deleteSilence([d], 0, 3400, rate, { gap: 0.3 });
  assert.deepEqual(cuts, [[1220, 2180], [2820, 3400]], "a fiftieth of a second is left beside each sound; the end goes whole");
  assert.equal(chans[0].length, 3400 - 960 - 580);
  assert.equal(chans[0][750], 0, "the short gap is still there");
  assert.deepEqual(W.deleteSilence([d], 0, 3400, rate, { gap: 5 }).cuts, [], "nothing long enough");
  assert.deepEqual(W.deleteSilence([new Float32Array(1000)], 0, 1000, rate, { gap: 0.3 }).cuts, [[0, 1000]], "all silence");
});

test("ramp slides the loudness in decibels across the stretch", () => {
  const [d] = W.ramp(sound([1, 1, 1, 1, 1, 1]), 1, 4, 0, -12);
  assert.deepEqual([d[0], d[1], d[4], d[5]], [1, 1, 1, 1], "the first sample starts at 0 dB; outside is untouched");
  assert.ok(Math.abs(d[2] - Math.pow(10, -6 / 20)) < 1e-6, "halfway is 6 dB down");
  assert.ok(Math.abs(d[3] - Math.pow(10, -12 / 20)) < 1e-6, "the last is 12 dB down");
});

test("declick mends clicks and leaves the wave around them alone", () => {
  const rate = 8000, clean = W.tone(rate, 1, { hz: 200, level: 0.5 })[0], d = Float32Array.from(clean);
  d[1000] += 0.8; d[3000] -= 0.9; d[3001] -= 0.7; d[6000] += 0.6;
  const { chans, count } = W.declick([d], 0, rate);
  assert.equal(count, 3);
  let worst = 0;
  for (let i = 0; i < rate; i++) worst = Math.max(worst, Math.abs(chans[0][i] - clean[i]));
  assert.ok(worst < 0.05, "back to within 0.05 of the clean tone, off by " + worst.toFixed(3));
  assert.equal(W.declick([clean], 0, rate).count, 0, "a clean tone has nothing to mend");
});

test("declick leaves a square wave's edges alone", () => {
  const rate = 8000, sq = W.tone(rate, 0.5, { shape: "square", hz: 100, level: 0.5 });
  const { chans, count } = W.declick(sq, 0, 4000);
  assert.equal(count, 0);
  assert.deepEqual(Array.from(chans[0]), Array.from(sq[0]));
});

test("spectrum: a tone lights up the row its pitch is in, and silence is dark", () => {
  const rate = 8000, rows = 64, cols = 10;
  const pic = W.spectrum(W.tone(rate, 1, { hz: 1000, level: 1 }), 0, rate, cols, rows, rate);
  assert.equal(pic.length, cols * rows);
  const col = Array.from(pic.slice(5 * rows, 6 * rows)), top = col.indexOf(Math.max(...col));
  assert.ok(W.spectrumHz(top, rows, rate) <= 1000 && W.spectrumHz(top + 1, rows, rate) >= 1000, "the brightest row holds 1000 Hz");
  assert.ok(col[top] > 235, "and is near full brightness, got " + col[top]);
  assert.ok(col[2] < 60, "low pitches are dark");
  assert.equal(Math.max(...W.spectrum([new Float32Array(rate)], 0, rate, 4, 16, rate)), 0);
  assert.equal(W.spectrumHz(0, rows, rate), 50);
  assert.equal(Math.round(W.spectrumHz(rows, rows, rate)), 4000);
});
