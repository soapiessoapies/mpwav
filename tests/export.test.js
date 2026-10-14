const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../src/audio/wav.js");
const Zip = require("../src/state/zip.js");
const Song = require("../src/state/song.js");
const MidiFile = require("../src/state/midi-file.js");
const SongInfo = require("../src/state/song-info.js");

const fakeBuffer = (channels, rate, samples) => ({
  numberOfChannels: channels, sampleRate: rate, length: samples[0].length,
  getChannelData: (c) => Float32Array.from(samples[c]),
});
const ascii = (buf, o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));

test("24-bit WAV: 3 bytes a sample, little-endian, full scale at the top", () => {
  const wav = W.encode(fakeBuffer(1, 48000, [[1, -1, 0]]), { bitDepth: 24 });
  const v = new DataView(wav);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(v.getUint32(28, true), 48000 * 3, "bytes per second");
  assert.equal(v.getUint32(40, true), 9, "3 frames x 3 bytes");
  const s = (i) => { const o = 44 + i * 3; const n = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); return n & 0x800000 ? n - 0x1000000 : n; };
  assert.deepEqual([s(0), s(1), s(2)], [0x7fffff, -0x800000, 0]);
  assert.equal(wav.byteLength % 2, 0, "chunks end on an even byte");
});

test("32-bit float WAV carries the float format, a fact chunk and the samples as they are", () => {
  const wav = W.encode(fakeBuffer(2, 44100, [[0.25, -0.5], [0.125, 0]]), { bitDepth: 32 });
  const v = new DataView(wav);
  assert.equal(v.getUint16(20, true), 3, "IEEE float");
  assert.equal(v.getUint32(16, true), 18);
  assert.equal(ascii(wav, 38, 4), "fact");
  assert.equal(v.getUint32(46, true), 2, "frames");
  assert.equal(ascii(wav, 50, 4), "data");
  assert.deepEqual([v.getFloat32(58, true), v.getFloat32(62, true), v.getFloat32(66, true)], [0.25, 0.125, -0.5]);
});

test("AIFF: big-endian samples and the sample rate as an 80-bit float", () => {
  const aiff = W.encodeAiff(fakeBuffer(1, 44100, [[1, -1]]), { bitDepth: 16 });
  const v = new DataView(aiff);
  assert.equal(ascii(aiff, 0, 4), "FORM");
  assert.equal(ascii(aiff, 8, 4), "AIFF");
  assert.equal(v.getUint32(22), 2, "frames");
  assert.equal(v.getUint16(26), 16);
  assert.equal(v.getUint16(28), 0x400e, "44100's exponent");
  assert.equal(v.getUint32(30), 0xac440000, "44100's mantissa");
  assert.deepEqual([v.getInt16(54), v.getInt16(56)], [32767, -32768]);
});

test("normalizing brings the loudest sample to -1 dB, and leaves silence alone", () => {
  const quiet = fakeBuffer(1, 8000, [[0.1, -0.25, 0.2]]);
  const g = W.normalizeGain(quiet);
  assert.ok(Math.abs(0.25 * g - Math.pow(10, -1 / 20)) < 1e-6);
  assert.equal(W.normalizeGain(fakeBuffer(1, 8000, [[0, 0]])), 1);
  const wav = W.encode(quiet, { gain: g });
  assert.equal(new DataView(wav).getInt16(46, true), Math.round(-0.25 * g * 32768));
});

test("dither only moves 16-bit samples by about one step", () => {
  let n = 0;
  const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const wav = W.encode(fakeBuffer(1, 8000, [Array(200).fill(0.3)]), { dither: true, random });
  const v = new DataView(wav);
  const plain = Math.round(0.3 * 32767);
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(v.getInt16(44 + i * 2, true) - plain) <= 2);
});

test("a zip holds every file, readable back by its central directory", () => {
  const files = [{ name: "Lead.wav", data: new Uint8Array([1, 2, 3]) }, { name: "Bass ♪.wav", data: new Uint8Array([4, 5]) }];
  const z = Zip.zip(files, new Date(2026, 9, 14, 12, 0, 0));
  const v = new DataView(z.buffer);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2, "two entries");
  let o = v.getUint32(end + 16, true);
  const names = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(v.getUint32(o, true), 0x02014b50);
    const len = v.getUint16(o + 28, true);
    names.push(new TextDecoder().decode(z.subarray(o + 46, o + 46 + len)));
    const local = v.getUint32(o + 42, true);
    const size = v.getUint32(o + 20, true);
    const data = z.subarray(local + 30 + len, local + 30 + len + size);
    assert.equal(v.getUint32(o + 16, true), Zip.crc32(data), "CRC matches the stored bytes");
    o += 46 + len;
  }
  assert.deepEqual(names, ["Lead.wav", "Bass ♪.wav"]);
  assert.equal(Zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "the standard CRC-32 check value");
});

// A minimal reader for the MIDI file, enough to check what was written.
function readMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const tracks = [];
  let o = 14;
  while (o < bytes.length) {
    const len = v.getUint32(o + 4);
    const end = o + 8 + len;
    let p = o + 8, tick = 0;
    const events = [];
    const vlq = () => { let n = 0, b; do { b = bytes[p++]; n = (n << 7) | (b & 0x7f); } while (b & 0x80); return n; };
    while (p < end) {
      tick += vlq();
      const s = bytes[p++];
      if (s === 0xff) { const type = bytes[p++]; const l = vlq(); events.push({ tick, meta: type, data: bytes.subarray(p, p + l) }); p += l; }
      else { events.push({ tick, status: s & 0xf0, ch: s & 0x0f, a: bytes[p], b: bytes[p + 1] }); p += 2; }
    }
    tracks.push(events);
    o = end;
  }
  return { format: v.getUint16(8), count: v.getUint16(10), ppq: v.getUint16(12), tracks };
}

test("MIDI export: a tempo track, then each note track's notes in place", () => {
  const song = Song.demoSong();
  const mid = readMidi(MidiFile.encode(song));
  assert.equal(mid.format, 1);
  assert.equal(mid.ppq, 96);
  assert.equal(mid.count, 1 + song.tracks.filter((t) => t.kind !== "audio").length);
  const tempo = mid.tracks[0].find((e) => e.meta === 0x51);
  const us = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];
  assert.equal(Math.round(60000000 / us), song.bpm);
  // The lead riff: its first note, C5 for two steps, in every one of 8 bars.
  const lead = mid.tracks[1];
  const ons = lead.filter((e) => e.status === 0x90);
  assert.equal(ons.length, 8 * 8);
  assert.equal(ons[0].a, 72);
  assert.equal(ons[0].tick, 0);
  const off = lead.find((e) => e.status === 0x80 && e.a === 72);
  assert.equal(off.tick, 2 * 24, "two sixteenths at 96 per quarter");
  assert.equal(ons[8].tick, 16 * 24, "the riff again a bar later");
});

test("MIDI export: drums on channel 10, a tempo ramp written step by step, a range of bars", () => {
  const song = Song.demoSong();
  Song.addTrack(song, { name: "Beat", kind: "drums" });
  const beat = song.tracks.at(-1);
  const c = Song.makeContent(song, beat.id, "Kick", 1, [{ step: 0, midi: 36, len: 1, vel: 1 }]);
  Song.addClip(song, beat, 0, 8, c.id);
  Song.setTempo(song, 4, 140, true);
  const mid = readMidi(MidiFile.encode(song, { from: 2, to: 6 }));
  const drums = mid.tracks.at(-1).filter((e) => e.status === 0x90);
  assert.equal(drums.length, 4, "one kick a bar, bars 3 to 6");
  assert.ok(drums.every((e) => e.ch === 9 && e.a === 36 && e.b === 127));
  const tempos = mid.tracks[0].filter((e) => e.meta === 0x51);
  assert.ok(tempos.length > 3, "the ramp is written as it climbs");
  const last = tempos.at(-1);
  assert.equal(Math.round(60000000 / ((last.data[0] << 16) | (last.data[1] << 8) | last.data[2])), 140);
});

test("song info as text names the length, tempo, tracks and clips", () => {
  const song = Song.demoSong();
  song.title = "Night drive";
  const t = SongInfo.text(song, { date: new Date("2026-10-14T12:00:00Z") });
  assert.match(t, /^Night drive\n=+\n/);
  assert.match(t, /Length: 8 bars of 4\/4, 0:\d\d/);
  assert.match(t, new RegExp(`Tempo: ${song.bpm} BPM throughout`));
  assert.match(t, /- Lead \(synth, chip-lead\): -3 dB, pan centre/);
  assert.match(t, /bars 1-8: Lead riff \(8 notes, a 1-bar loop repeated\)/);
  assert.match(t, /bars 5-8: Hats busy/);
  const secs = SongInfo.seconds(song, 8);
  assert.ok(Math.abs(secs - 8 * 4 * 60 / song.bpm) < 1e-6);
});
