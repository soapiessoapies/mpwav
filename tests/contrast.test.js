// Checks the color pairs the UI actually uses against WCAG AA:
// 4.5:1 for text, 3:1 for control edges, key edges and focus rings.
// Every background theme (Settings > Background) is checked too: each one
// overrides some of the default colors.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../styles/main.css"), "utf8");
const read = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const vars = read(css.match(/:root\s*{([^}]*)}/)[1]);
const THEMES = { "high contrast": vars };
for (const m of css.matchAll(/:root\[data-theme="([\w-]+)"\]\s*{([^}]*)}/g)) THEMES[m[1]] = { ...vars, ...read(m[2]) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b, v = vars) {
  assert.ok(v[a] && v[b], `missing --${a} or --${b}`);
  const [x, y] = [lum(v[a]), lum(v[b])].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = [
  ["text", "bg"], ["text", "panel"], ["text", "panel-2"],
  ["muted", "bg"], ["muted", "panel"], ["muted", "panel-2"],
  ["accent", "bg"], ["accent", "panel"], ["accent", "panel-2"], ["accent-ink", "accent"],
  ["white-key-ink", "white-key"], ["text", "black-key"],
  ["accent-ink", "solo"], ["muted", "cell"], ["text", "cell-beat"],
  ["accent-ink", "rec"],
  ...["orange", "mint", "sky", "violet", "rose", "lime", "gold", "coral"].map((c) => ["accent-ink", "c-" + c]),
];
const NON_TEXT = [
  ["line", "panel"], ["line", "panel-2"], ["line", "bg"],
  ["focus", "bg"], ["focus", "panel"], ["focus", "panel-2"], ["focus", "black-key"],
  ["accent", "panel-2"], ["black-key-edge", "black-key"], ["black-key", "white-key"],
  ["meter-fill", "meter-bg"], ["meter-hot", "meter-bg"],
  ["cell-edge", "cell"], ["cell-edge", "cell-beat"], ["cell-edge", "panel"], ["accent", "cell"], ["accent", "cell-beat"], ["playhead", "cell"],
  ["solo", "panel-2"], ["focus", "cell"],
  ["rec", "panel-2"],
  ...["orange", "mint", "sky", "violet", "rose", "lime", "gold", "coral"].map((c) => ["c-" + c, "panel-2"]),
];

test("there are background themes besides the default", () => {
  assert.ok(Object.keys(THEMES).length >= 4, Object.keys(THEMES).join(", "));
});

for (const [theme, v] of Object.entries(THEMES)) {
  test(`${theme}: every text color pair is at least 4.5:1`, () => {
    for (const [fg, bg] of TEXT) {
      const r = ratio(fg, bg, v);
      assert.ok(r >= 4.5, `--${fg} on --${bg}: ${r.toFixed(2)}:1`);
    }
  });
  test(`${theme}: every control edge, key edge and focus ring is at least 3:1`, () => {
    for (const [fg, bg] of NON_TEXT) {
      const r = ratio(fg, bg, v);
      assert.ok(r >= 3, `--${fg} against --${bg}: ${r.toFixed(2)}:1`);
    }
  });
}

// Note names are written on every key's shade of every track color (the
// formula in src/ui/colors.js), in dark ink or white, whichever reads better.
test("note names are at least 4.5:1 on every shade of every track color", () => {
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lumRgb = (rgb) => {
    const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const r = (a, b) => { const [x, y] = [lumRgb(a), lumRgb(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const ink = rgbOf(vars["accent-ink"]), white = [255, 255, 255];
  for (const name of ["orange", "mint", "sky", "violet", "rose", "lime", "gold", "coral"]) {
    const base = rgbOf(vars["c-" + name]);
    for (let pc = 0; pc < 12; pc++) {
      const tint = (pc / 11) * 0.7;
      const shade = base.map((c) => Math.round(c + (255 - c) * tint));
      const best = Math.max(r(shade, ink), r(shade, white));
      assert.ok(best >= 4.5, `${name}, key ${pc}: ${best.toFixed(2)}:1`);
    }
  }
});

// Note Edit's paper tabs (styles/look.css): each page is --paper-mix of a
// track color mixed into the panel, in every background theme. Text, quiet
// text, the accent and the outlines on them must all still read on each one.
const look = fs.readFileSync(path.join(__dirname, "../styles/look.css"), "utf8");
const PAPER_MIX = parseFloat(look.match(/--paper-mix:\s*([\d.]+)%/)[1]) / 100;
const PAPERS = [...look.matchAll(/--paper-c:\s*var\(--(c-\w+)\)/g)].map((m) => m[1]);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

test("the paper tabs cover all eight Note Edit pages", () => {
  assert.equal(new Set(PAPERS).size, 8);
});
for (const [theme, v] of Object.entries(THEMES)) {
  test(`${theme}: text, quiet text, accent and outlines read on every paper tab`, () => {
    for (const c of PAPERS) {
      const paper = toHex(hexRgb(v[c]).map((x, i) => x * PAPER_MIX + hexRgb(v.panel)[i] * (1 - PAPER_MIX)));
      const w = { ...v, paper };
      for (const fg of ["text", "muted", "accent"]) {
        const r = ratio(fg, "paper", w);
        assert.ok(r >= 4.5, `--${fg} on ${c} paper: ${r.toFixed(2)}:1`);
      }
      // Outlines on paper use --cell-edge (look.css swaps it in for --line there).
      const edge = ratio("cell-edge", "paper", w);
      assert.ok(edge >= 3, `--cell-edge on ${c} paper: ${edge.toFixed(2)}:1`);
    }
  });
}
