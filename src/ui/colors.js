// Note colors: every track has a color, and each of the 12 keys gets its
// own shade of it, C deepest (the track color itself) and B lightest (a
// pale tint), so a track's notes read as one family and the same key always
// looks the same. Octaves share a shade. Shades only get lighter, never
// mid-dark, so the note names on them always pass contrast (a test checks).
(function (root) {
  "use strict";

  const cache = {};
  const TINT = 0.7;

  // A color is one of the named track colors ("orange") or a custom "#rrggbb".
  const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  function trackRgb(color) {
    const hex = isHex(color) ? color : getComputedStyle(document.documentElement).getPropertyValue("--c-" + color).trim() || "#ffb547";
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  // For a style: the theme's variable for a named color, the hex itself for a custom one.
  const cssOf = (color) => (isHex(color) ? color : `var(--c-${color})`);

  // 12 shades (as [r, g, b]) for a track color, by pitch class.
  function shades(color) {
    if (!cache[color]) {
      const rgb = trackRgb(color);
      cache[color] = Array.from({ length: 12 }, (_, pc) => {
        const tint = (pc / 11) * TINT; // C: the track color ... B: TINT of the way to white
        return rgb.map((c) => Math.round(c + (255 - c) * tint));
      });
    }
    return cache[color];
  }

  const css = (rgb) => `rgb(${rgb.join(",")})`;

  // Text that stays readable on a shade: dark ink on light shades, white on
  // deep ones. For mid tones (custom colors can be any) where neither reaches
  // 4.5:1, pure black does: if white is under 4.5:1, black is over it.
  function inkFor(rgb) {
    const lum = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    const INK_L = 0.00664; // #1a1205's luminance (rounded up, to be safe)
    const white = 1.05 / (L + 0.05), ink = (L + 0.05) / (INK_L + 0.05);
    if (ink >= 4.5 && ink >= white) return "#1a1205";
    if (white >= 4.5) return "#ffffff";
    return ink >= 4.5 ? "#1a1205" : "#000000";
  }
  // The ink for text on a color itself (clip names, track chips).
  const inkOn = (color) => inkFor(trackRgb(color));
  // Sets --track and --track-ink on an element for a color.
  function paint(el, color) {
    el.style.setProperty("--track", cssOf(color));
    el.style.setProperty("--track-ink", inkOn(color));
  }

  const noteColor = (color, midi) => css(shades(color).at(Notes.pitchClass(midi)));
  const noteInk = (color, midi) => inkFor(shades(color).at(Notes.pitchClass(midi)));

  // Themes change the page's colors, so cached shades must be rebuilt.
  const reset = () => { for (const k of Object.keys(cache)) delete cache[k]; };

  const api = { isHex, cssOf, shades, css, inkFor, inkOn, paint, noteColor, noteInk, reset };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Colors = api;
})(typeof window !== "undefined" ? window : globalThis);
