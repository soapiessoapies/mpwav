// Level meters: bars that follow a peak level, with a line holding the
// recent maximum, going red near clipping. One animation loop draws them all.
// They're decoration for sighted users and hidden from screen readers.
(function (root) {
  "use strict";

  const FLOOR_DB = -48;
  const HOLD_MS = 900;
  const meters = [];
  let colors = null;
  let running = false;

  const fraction = (amp) =>
    amp <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(amp) - FLOOR_DB) / -FLOOR_DB));

  // canvas: where to draw; getPeak: () => 0..1; vertical: fills bottom-up.
  function add(canvas, getPeak, vertical = false) {
    meters.push({ canvas, g: canvas.getContext("2d"), getPeak, vertical, level: 0, hold: 0, holdAt: 0 });
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  function frame(now) {
    if (!colors) {
      const css = getComputedStyle(document.documentElement);
      colors = Object.fromEntries(["meter-bg", "meter-fill", "meter-hot", "meter-hold"]
        .map((k) => [k, css.getPropertyValue("--" + k).trim()]));
    }
    const dpr = window.devicePixelRatio || 1;
    for (const m of meters) {
      if (!m.canvas.isConnected) continue;
      const w = m.canvas.clientWidth, h = m.canvas.clientHeight;
      if (!w || !h) continue;
      if (m.canvas.width !== Math.round(w * dpr)) { m.canvas.width = Math.round(w * dpr); m.canvas.height = Math.round(h * dpr); }
      const g = m.g;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const p = m.getPeak();
      m.level = Math.max(p, m.level * 0.88); // fast up, smooth down
      if (p >= m.hold || now - m.holdAt > HOLD_MS) { m.hold = p; m.holdAt = now; }

      g.fillStyle = colors["meter-bg"];
      g.fillRect(0, 0, w, h);
      g.fillStyle = m.level > 0.89 ? colors["meter-hot"] : colors["meter-fill"];
      const f = fraction(m.level), hf = fraction(m.hold);
      if (m.vertical) {
        g.fillRect(0, h - f * h, w, f * h);
        g.fillStyle = colors["meter-hold"];
        if (hf > 0.01) g.fillRect(0, h - hf * h, w, 2);
      } else {
        g.fillRect(0, 0, f * w, h);
        g.fillStyle = colors["meter-hold"];
        if (hf > 0.01) g.fillRect(hf * w - 2, 0, 2, h);
      }
    }
    requestAnimationFrame(frame);
  }

  root.Meter = { add };
})(window);
