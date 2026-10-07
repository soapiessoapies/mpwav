// Checks the color pairs the UI actually uses against WCAG AA:
// 4.5:1 for text, 3:1 for control edges, key edges and focus rings.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../styles/main.css"), "utf8");
const root = css.match(/:root\s*{([^}]*)}/)[1];
const vars = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  assert.ok(vars[a] && vars[b], `missing --${a} or --${b}`);
  const [x, y] = [lum(vars[a]), lum(vars[b])].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = [
  ["text", "bg"], ["text", "panel"], ["text", "panel-2"],
  ["muted", "bg"], ["muted", "panel"], ["muted", "panel-2"],
  ["accent", "panel"], ["accent", "panel-2"], ["accent-ink", "accent"],
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

for (const [fg, bg] of TEXT) {
  test(`text --${fg} on --${bg} is at least 4.5:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${r.toFixed(2)}:1`);
  });
}
for (const [fg, bg] of NON_TEXT) {
  test(`--${fg} against --${bg} is at least 3:1`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= 3, `${r.toFixed(2)}:1`);
  });
}
