const test = require("node:test");
const assert = require("node:assert/strict");
const Pads = require("../src/state/pads.js");
const Loudness = require("../src/audio/loudness.js");
const WaveOps = require("../src/audio/wave-ops.js");

test("a new pad bank has named sections to sort sounds into", () => {
  const bank = Pads.create();
  assert.deepEqual(bank.sections.map((s) => s.name), ["Percussion", "Bass", "Treble"]);
  assert.ok(bank.sections.every((s) => s.pads.length === 0));
});

test("pads are added, renamed, moved between sections and removed", () => {
  const bank = Pads.create();
  const [perc, bass] = bank.sections;
  const kick = Pads.addPad(bank, perc.id, { name: "Kick", sampleId: "snd-abc123" });
  assert.equal(kick.name, "Kick");
  assert.equal(Pads.addPad(bank, perc.id, { name: "Bad", sampleId: "not-a-sound" }), null, "only real sound ids");
  Pads.renamePad(bank, kick.id, "  Deep kick  ");
  assert.equal(kick.name, "Deep kick");
  assert.ok(Pads.movePad(bank, kick.id, bass.id));
  assert.deepEqual([perc.pads.length, bass.pads[0].id], [0, kick.id]);
  assert.deepEqual(Pads.soundIds(bank), ["snd-abc123"]);
  assert.ok(Pads.removePad(bank, kick.id));
  assert.deepEqual(Pads.soundIds(bank), []);
});

test("sections are added, renamed, reordered and removed without losing their pads", () => {
  const bank = Pads.create();
  const fx = Pads.addSection(bank, "Risers");
  Pads.addPad(bank, fx.id, { name: "Whoosh", sampleId: "snd-w1" });
  Pads.renameSection(bank, fx.id, "Sweeps");
  assert.equal(Pads.section(bank, fx.id).name, "Sweeps");
  assert.ok(Pads.moveSection(bank, fx.id, -1));
  assert.deepEqual(bank.sections.map((s) => s.name), ["Percussion", "Bass", "Sweeps", "Treble"]);
  assert.ok(Pads.removeSection(bank, fx.id));
  assert.equal(bank.sections.find((s) => s.name === "Bass").pads[0].name, "Whoosh", "its pads moved up a section");
  // The last section stays.
  while (bank.sections.length > 1) Pads.removeSection(bank, bank.sections[0].id);
  assert.equal(Pads.removeSection(bank, bank.sections[0].id), false);
});

test("a saved bank is cleaned up when loaded", () => {
  const bank = Pads.sanitize({ sections: [{ name: "Hits", pads: [{ name: "Snap", sampleId: "snd-s1" }, { name: "x", sampleId: "../evil" }] }, null] });
  assert.equal(bank.sections.length, 1);
  assert.deepEqual(bank.sections[0].pads.map((p) => p.name), ["Snap"]);
  assert.deepEqual(Pads.sanitize(null).sections.map((s) => s.name), Pads.DEFAULT_SECTIONS);
  const again = Pads.addPad(bank, bank.sections[0].id, { name: "Two", sampleId: "snd-s2" });
  assert.ok(!bank.sections[0].pads.some((p) => p !== again && p.id === again.id), "new ids don't clash");
});

const sine = (rate, secs, amp, hz = 997) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

test("loudness: a full-scale 1 kHz sine in one channel reads about -3 LUFS, ten times quieter about -23", () => {
  const rate = 48000;
  assert.ok(Math.abs(Loudness.lufs([sine(rate, 3, 1)], rate) - -3.01) < 0.3);
  assert.ok(Math.abs(Loudness.lufs([sine(rate, 3, 0.1)], rate) - -23.01) < 0.3);
  // The same sine in both channels is 3 dB louder.
  assert.ok(Math.abs(Loudness.lufs([sine(rate, 3, 0.1), sine(rate, 3, 0.1)], rate) - -20.0) < 0.3);
});

test("loudness ignores silence, and says so for a sound too short to measure", () => {
  const rate = 44100;
  const tone = sine(rate, 2, 0.1);
  const withGap = new Float32Array(tone.length * 2);
  withGap.set(tone, 0);
  assert.ok(Math.abs(Loudness.lufs([withGap], rate) - Loudness.lufs([tone], rate)) < 0.5, "a silent half doesn't drag it down");
  assert.equal(Loudness.lufs([new Float32Array(rate)], rate), -Infinity);
  assert.equal(Loudness.lufs([sine(rate, 0.2, 0.5)], rate), -Infinity);
  assert.ok(Math.abs(Loudness.peakDb([sine(rate, 1, 0.5)]) - -6.02) < 0.05);
  assert.match(Loudness.describe([sine(rate, 1, 0.5)], rate), /^peak -6\.0 dB, loudness -\d+\.\d LUFS$/);
});

test("a sound splits into the parts between its markers", () => {
  const cues = [{ t: 0.5, name: "Hit 2" }, { t: 1.2, name: "Hit 3" }, { t: 9, name: "past the end" }];
  assert.deepEqual(WaveOps.sections(0, 2, cues), [
    { from: 0, to: 0.5, name: "" },
    { from: 0.5, to: 1.2, name: "Hit 2" },
    { from: 1.2, to: 2, name: "Hit 3" },
  ]);
  assert.deepEqual(WaveOps.sections(0.6, 1.0, cues), [{ from: 0.6, to: 1.0, name: "" }], "no markers inside: one part");
});

test("variations: the original first, then copies a little higher or lower and louder or quieter", () => {
  let n = 0;
  const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const chans = [sine(8000, 0.5, 0.5, 440)];
  const vs = WaveOps.variations(chans, { count: 5, pitch: 2, volume: 3, random });
  assert.equal(vs.length, 5);
  assert.deepEqual([vs[0].semitones, vs[0].db], [0, 0]);
  assert.ok(vs.slice(1).every((v) => Math.abs(v.semitones) <= 2 && Math.abs(v.db) <= 3));
  assert.ok(vs[1].semitones < 0 && vs[4].semitones > 0, "spread from below to above");
  // Higher means shorter, like speeding up tape.
  assert.ok(vs[4].chans[0].length < chans[0].length && vs[1].chans[0].length > chans[0].length);
  assert.equal(WaveOps.variations(chans, { count: 99 }).length, 12, "at most 12");
});
