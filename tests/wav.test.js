const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../src/audio/wav.js");

const fakeBuffer = (channels, rate, samples) => ({
  numberOfChannels: channels, sampleRate: rate, length: samples[0].length,
  getChannelData: (c) => Float32Array.from(samples[c]),
});

test("a WAV header describing 16-bit stereo PCM", () => {
  const wav = W.encode(fakeBuffer(2, 44100, [[0, 0.5], [0, -0.5]]));
  const v = new DataView(wav);
  const text = (o, n) => String.fromCharCode(...new Uint8Array(wav, o, n));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 2, "stereo");
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint16(34, true), 16, "16-bit");
  assert.equal(v.getUint32(40, true), 2 * 2 * 2, "2 frames x 2 channels x 2 bytes");
  assert.equal(wav.byteLength, 44 + 8);
});

test("samples are interleaved left/right and clipped to full scale", () => {
  const wav = W.encode(fakeBuffer(2, 8000, [[1, 2], [-1, -3]]));
  const v = new DataView(wav);
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [32767, -32768, 32767, -32768]);
});

test("file names come from the song title, minus characters files can't have", () => {
  assert.equal(W.fileName("My song: take 2/3?", ".wav"), "My song take 23.wav");
  assert.equal(W.fileName("   ", ".wav"), "Sound Studio song.wav");
});
