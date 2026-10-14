// Turns rendered audio into a sound file: WAV (16 or 24-bit PCM, or 32-bit
// float) or AIFF (16 or 24-bit), the formats every audio app, video editor
// and game engine opens. Takes anything shaped like an AudioBuffer
// (numberOfChannels, sampleRate, length, getChannelData).
//
// Options, as in a DAW's bounce dialog:
//   bitDepth  16 | 24 | 32 (32 = float, WAV only)
//   gain      multiply every sample (normalizing: see normalizeGain)
//   dither    add a little shaped noise before rounding to 16-bit, so quiet
//             fades don't turn into steps (TPDF dither, the standard kind)
(function (root) {
  "use strict";

  const DEPTHS = [16, 24, 32];

  // Every channel's samples, gained, clipped and (at 16-bit) dithered,
  // as integers for PCM or floats for 32-bit.
  function samplesOf(buffer, { bitDepth = 16, gain = 1, dither = false, random = Math.random } = {}) {
    const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const full = bitDepth === 24 ? 0x7fffff : 0x7fff;
    const lsb = dither && bitDepth === 16 ? 1 / 0x8000 : 0;
    return function at(c, i) {
      let s = data[c][i] * gain;
      if (bitDepth === 32) return Math.max(-1, Math.min(1, s));
      if (lsb) s += (random() - random()) * lsb;
      s = Math.max(-1, Math.min(1, s));
      return Math.round(s < 0 ? s * (full + 1) : s * full);
    };
  }

  function encode(buffer, opts = {}) {
    const bitDepth = DEPTHS.includes(opts.bitDepth) ? opts.bitDepth : 16;
    const channels = buffer.numberOfChannels, rate = buffer.sampleRate, frames = buffer.length;
    const width = bitDepth / 8;
    const float = bitDepth === 32;
    const bytes = frames * channels * width;
    // A float file carries the longer format block and a "fact" chunk.
    const fmtSize = float ? 18 : 16;
    const factSize = float ? 12 : 0;
    const head = 12 + 8 + fmtSize + factSize + 8;
    const out = new ArrayBuffer(head + bytes + (bytes % 2));
    const v = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, out.byteLength - 8, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, fmtSize, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * channels * width, true);
    v.setUint16(32, channels * width, true); v.setUint16(34, bitDepth, true);
    let o = 36;
    if (float) { v.setUint16(o, 0, true); o += 2; str(o, "fact"); v.setUint32(o + 4, 4, true); v.setUint32(o + 8, frames, true); o += 12; }
    str(o, "data"); v.setUint32(o + 4, bytes, true); o += 8;
    const at = samplesOf(buffer, { ...opts, bitDepth });
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = at(c, i);
        if (float) v.setFloat32(o, s, true);
        else if (bitDepth === 24) { v.setUint8(o, s & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, (s >> 16) & 0xff); }
        else v.setInt16(o, s, true);
        o += width;
      }
    }
    return out;
  }

  // An AIFF file (big-endian PCM, 16 or 24-bit): what Apple's apps prefer.
  function encodeAiff(buffer, opts = {}) {
    const bitDepth = opts.bitDepth === 24 ? 24 : 16;
    const channels = buffer.numberOfChannels, rate = buffer.sampleRate, frames = buffer.length;
    const width = bitDepth / 8;
    const bytes = frames * channels * width;
    const out = new ArrayBuffer(12 + 26 + 16 + bytes + (bytes % 2));
    const v = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "FORM"); v.setUint32(4, out.byteLength - 8); str(8, "AIFF");
    str(12, "COMM"); v.setUint32(16, 18); v.setUint16(20, channels); v.setUint32(22, frames); v.setUint16(26, bitDepth);
    extended80(v, 28, rate);
    str(38, "SSND"); v.setUint32(42, 8 + bytes); v.setUint32(46, 0); v.setUint32(50, 0);
    let o = 54;
    const at = samplesOf(buffer, { ...opts, bitDepth });
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = at(c, i);
        if (bitDepth === 24) { v.setUint8(o, (s >> 16) & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, s & 0xff); }
        else v.setInt16(o, s);
        o += width;
      }
    }
    return out;
  }

  // AIFF stores its sample rate as an 80-bit extended float.
  function extended80(v, o, n) {
    let exp = 16383 + Math.floor(Math.log2(n));
    let mant = n / Math.pow(2, Math.floor(Math.log2(n)));
    v.setUint16(o, exp);
    const hi = Math.floor(mant * 0x80000000);
    const lo = Math.round((mant * 0x80000000 - hi) * 0x100000000);
    v.setUint32(o + 2, hi);
    v.setUint32(o + 6, lo);
  }

  // The loudest sample in the buffer, 0..1.
  function peak(buffer) {
    let p = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
    }
    return p;
  }

  // The gain that brings the loudest sample to `targetDb` (-1 dB by default,
  // a little under full scale so other players don't clip it). Silence stays 1.
  const normalizeGain = (buffer, targetDb = -1) => {
    const p = peak(buffer);
    return p > 0 ? Math.pow(10, targetDb / 20) / p : 1;
  };

  // A file name from a song title: letters, numbers, spaces, dashes.
  const fileName = (title, ext) =>
    ((title || "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "mpwav song") + ext;

  const api = { encode, encodeAiff, peak, normalizeGain, fileName, DEPTHS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Wav = api;
})(typeof window !== "undefined" ? window : globalThis);
