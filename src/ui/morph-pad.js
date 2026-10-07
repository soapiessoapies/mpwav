// The morph pad: drag the dot around the square to push the sound between
// opposites (dark / bright across, tight / spacious up and down).
//
// The square is for pointers and touch. Two labelled sliders underneath do
// the same job for keyboards and screen readers, and both always move
// together, so nobody needs the square to reach anything.
(function (root) {
  "use strict";

  function create(container, { onChange }) {
    let pos = { x: 0, y: 0 };

    const wrap = document.createElement("div");
    wrap.className = "morph";

    const pad = document.createElement("div");
    pad.className = "pad";
    pad.setAttribute("aria-hidden", "true");
    pad.innerHTML =
      '<span class="pad-lab top">Spacious</span><span class="pad-lab bottom">Tight</span>' +
      '<span class="pad-lab left">Dark</span><span class="pad-lab right">Bright</span>' +
      '<span class="pad-cross h"></span><span class="pad-cross v"></span><span class="pad-dot"></span>';
    const dot = pad.querySelector(".pad-dot");

    const sliders = document.createElement("div");
    sliders.className = "morph-sliders";
    const axis = (id, label) => {
      const d = document.createElement("div");
      d.className = "ctl";
      d.innerHTML =
        `<div class="ctl-head"><label for="morph-${id}">${label}</label>` +
        `<output for="morph-${id}" aria-hidden="true"></output></div>` +
        `<input type="range" id="morph-${id}" min="-100" max="100" step="1" value="0">`;
      sliders.append(d);
      const input = d.querySelector("input");
      input.addEventListener("input", () => {
        set({ ...pos, [id]: Number(input.value) / 100 });
        onChange(pos);
      });
      // Arrows move 5% (Shift: 1%), so it doesn't take 100 presses to cross.
      input.addEventListener("keydown", (e) => {
        const d = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
        if (d == null) return;
        e.preventDefault();
        const step = e.shiftKey ? Math.sign(d) : d;
        input.value = String(Math.max(-100, Math.min(100, Number(input.value) + step)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return { input, out: d.querySelector("output") };
    };
    const ax = { x: axis("x", "Dark ↔ Bright"), y: axis("y", "Tight ↔ Spacious") };

    const center = document.createElement("button");
    center.type = "button";
    center.className = "quiet";
    center.textContent = "Center";
    center.addEventListener("click", () => { set({ x: 0, y: 0 }); onChange(pos); });
    sliders.append(center);

    wrap.append(pad, sliders);
    container.append(wrap);

    // --- dragging on the square ---
    let dragging = null;
    function fromPointer(e) {
      const r = pad.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = 1 - ((e.clientY - r.top) / r.height) * 2; // up is spacious
      set({ x, y });
      onChange(pos);
    }
    pad.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      dragging = e.pointerId;
      pad.classList.add("active");
      fromPointer(e);
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === dragging) fromPointer(e); });
    const end = (e) => {
      if (e.pointerId !== dragging) return;
      dragging = null;
      pad.classList.remove("active");
    };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    pad.addEventListener("dblclick", () => { set({ x: 0, y: 0 }); onChange(pos); });

    // Moves the dot and the sliders (without calling onChange).
    function set(p) {
      // Whole percents, so the dot, the sliders and what's spoken all agree.
      const pct = (v) => Math.round(Morph.clamp1(v) * 100) / 100;
      pos = { x: pct(p.x), y: pct(p.y) };
      dot.style.left = ((pos.x + 1) / 2) * 100 + "%";
      dot.style.top = ((1 - pos.y) / 2) * 100 + "%";
      for (const k of ["x", "y"]) {
        ax[k].input.value = String(Math.round(pos[k] * 100));
        ax[k].out.textContent = Morph.describe(k, pos[k]);
        ax[k].input.setAttribute("aria-valuetext", Morph.describe(k, pos[k], true));
      }
    }
    set(pos);

    return { set };
  }

  root.MorphPad = { create };
})(window);
