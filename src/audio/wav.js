// Turns rendered audio into a WAV file: 16-bit PCM, the format every audio
// app, video editor and game engine opens. Takes anything shaped like an
// AudioBuffer (numberOfChannels, sampleRate, length, getChannelData).
(function (root) {
  "use strict";

  function encode(buffer) {
    const channels = buffer.numberOfChannels, rate = buffer.sampleRate, frames = buffer.length;
    const bytes = frames * channels * 2;
    const out = new ArrayBuffer(44 + bytes);
    const v = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, bytes, true);
    const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return out;
  }

  // A file name from a song title: letters, numbers, spaces, dashes.
  const fileName = (title, ext) =>
    ((title || "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "mpwav song") + ext;

  const api = { encode, fileName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Wav = api;
})(typeof window !== "undefined" ? window : globalThis);
