// Draws the app icon (a tiny arrangement: four rows of clips in the track
// colors and a playhead) and writes it at every size the manifest and
// browsers ask for. No dependencies: shapes are rasterized here and saved
// as PNG with node's zlib. Run `node tools/make-icons.js` after changing it.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT = path.resolve(__dirname, "..", "assets", "icons");
const BG = "#121419";
const PLAYHEAD = "#f4f6fb";
// Each row: a color and its clips as [x0, x1] in 0..1 of the artwork.
const ROWS = [
  ["#ffb547", [[0.18, 0.5], [0.56, 0.82]]],
  ["#7ee0b0", [[0.3, 0.7]]],
  ["#8fd0ff", [[0.18, 0.4], [0.46, 0.82]]],
  ["#c9a6ff", [[0.4, 0.82]]],
];
const ROW_Y = [0.255, 0.405, 0.555, 0.705];
const ROW_H = 0.1;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Shapes in artwork units (0..1); `art` maps them onto the icon.
function shapes() {
  const list = [];
  ROWS.forEach(([color, clips], i) => {
    for (const [x0, x1] of clips) list.push({ x0, x1, y0: ROW_Y[i], y1: ROW_Y[i] + ROW_H, r: 0.03, color });
  });
  list.push({ x0: 0.6, x1: 0.625, y0: 0.17, y1: 0.84, r: 0.0125, color: PLAYHEAD });
  return list;
}

function inRoundRect(x, y, s) {
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  const cx = Math.min(Math.max(x, s.x0 + s.r), s.x1 - s.r);
  const cy = Math.min(Math.max(y, s.y0 + s.r), s.y1 - s.r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= s.r * s.r;
}

// maskable: full-bleed background, artwork shrunk into the safe circle.
function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const bg = { x0: 0, x1: 1, y0: 0, y1: 1, r: maskable ? 0 : 0.22, color: BG };
  const scale = maskable ? 0.78 : 1;
  const art = shapes();
  const SS = 4; // 4x4 samples per pixel for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          if (!inRoundRect(u, v, bg)) continue;
          const au = (u - 0.5) / scale + 0.5, av = (v - 0.5) / scale + 0.5;
          const hit = art.find((s) => inRoundRect(au, av, s));
          const [cr, cg, cb] = hex(hit ? hit.color : BG);
          r += cr; g += cg; b += cb; a += 1;
        }
      }
      const i = (y * size + x) * 4, n = SS * SS;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, px);
}

// --- PNG writer ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- SVG (the browser tab icon) ---
function svg() {
  const rect = (s) => `<rect x="${s.x0 * 64}" y="${s.y0 * 64}" width="${((s.x1 - s.x0) * 64).toFixed(2)}" height="${((s.y1 - s.y0) * 64).toFixed(2)}" rx="${(s.r * 64).toFixed(2)}" fill="${s.color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    rect({ x0: 0, x1: 1, y0: 0, y1: 1, r: 0.22, color: BG }) + shapes().map(rect).join("") + `</svg>\n`;
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  "icon-192.png": render(192),
  "icon-512.png": render(512),
  "maskable-512.png": render(512, { maskable: true }),
  "apple-touch-icon.png": render(180, { maskable: true }), // iOS rounds the corners itself
  "favicon-32.png": render(32),
  "icon.svg": svg(),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(name, data.length, "bytes");
}
