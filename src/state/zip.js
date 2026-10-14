// A .zip of several files, for exporting stems: one download instead of a
// prompt per track. Files are stored as they are (sound files barely
// compress), so this is only the zip container: headers, CRC-32s and the
// directory at the end, which every operating system opens.
(function (root) {
  "use strict";

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, data: Uint8Array | ArrayBuffer }] -> Uint8Array of the zip.
  function zip(files, date = new Date()) {
    const enc = new TextEncoder();
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const entries = files.map((f) => {
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      return { name: enc.encode(f.name), data, crc: crc32(data) };
    });
    const size = entries.reduce((s, e) => s + 30 + e.name.length + e.data.length + 46 + e.name.length, 0) + 22;
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    let o = 0;
    const offsets = [];
    for (const e of entries) {
      offsets.push(o);
      v.setUint32(o, 0x04034b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 0x0800, true); // UTF-8 names
      v.setUint16(o + 8, 0, true); v.setUint16(o + 10, time, true); v.setUint16(o + 12, day, true);
      v.setUint32(o + 14, e.crc, true); v.setUint32(o + 18, e.data.length, true); v.setUint32(o + 22, e.data.length, true);
      v.setUint16(o + 26, e.name.length, true); v.setUint16(o + 28, 0, true);
      out.set(e.name, o + 30);
      out.set(e.data, o + 30 + e.name.length);
      o += 30 + e.name.length + e.data.length;
    }
    const dir = o;
    entries.forEach((e, i) => {
      v.setUint32(o, 0x02014b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 20, true); v.setUint16(o + 8, 0x0800, true);
      v.setUint16(o + 10, 0, true); v.setUint16(o + 12, time, true); v.setUint16(o + 14, day, true);
      v.setUint32(o + 16, e.crc, true); v.setUint32(o + 20, e.data.length, true); v.setUint32(o + 24, e.data.length, true);
      v.setUint16(o + 28, e.name.length, true);
      v.setUint32(o + 42, offsets[i], true);
      out.set(e.name, o + 46);
      o += 46 + e.name.length;
    });
    v.setUint32(o, 0x06054b50, true);
    v.setUint16(o + 8, entries.length, true); v.setUint16(o + 10, entries.length, true);
    v.setUint32(o + 12, o - dir, true); v.setUint32(o + 16, dir, true);
    return out;
  }

  const api = { zip, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Zip = api;
})(typeof window !== "undefined" ? window : globalThis);
