// A zoom bar like Premiere Pro's: under a timeline, a thick bar shows which
// part of the whole is in view. Drag the middle to scroll; drag either end
// to zoom (pull the ends together to zoom in, apart to zoom out). Double-
// click it to fit everything.
//
// Keyboard and screen readers: the middle and both ends are sliders.
// Left / Right move them (Shift: further); on the middle, - and = zoom.
// A screen reader hears "Timeline view, bars 3 to 10 of 16".
(function (root) {
  "use strict";

  const MIN_THUMB = 64; // px: the middle never gets too small to grab

  // h: { get() -> { start, end, total }, set(start, end), fit(), label, unit(n) -> words }
  function create(el, h) {
    el.className = "zoombar";
    el.innerHTML =
      '<div class="zb-track">' +
      '<div class="zb-thumb" tabindex="0" role="slider">' +
      '<span class="zb-handle zb-start" tabindex="0" role="slider"></span>' +
      '<span class="zb-grip" aria-hidden="true"></span>' +
      '<span class="zb-handle zb-end" tabindex="0" role="slider"></span>' +
      "</div></div>";
    const track = el.querySelector(".zb-track");
    const thumb = el.querySelector(".zb-thumb");
    const hStart = el.querySelector(".zb-start");
    const hEnd = el.querySelector(".zb-end");
    thumb.setAttribute("aria-label", h.label + " view");
    hStart.setAttribute("aria-label", h.label + " view start");
    hEnd.setAttribute("aria-label", h.label + " view end");

    function draw() {
      const { start, end, total } = h.get();
      const w = track.clientWidth;
      if (!w || !total) return;
      let left = (start / total) * w, width = ((end - start) / total) * w;
      if (width < MIN_THUMB) { left = Math.max(0, Math.min(w - MIN_THUMB, left - (MIN_THUMB - width) / 2)); width = MIN_THUMB; }
      thumb.style.left = left + "px";
      thumb.style.width = Math.min(width, w - left) + "px";
      const words = `${h.unit(Math.floor(start) + 1)} to ${h.unit(Math.ceil(end))} of ${total}`;
      for (const [elx, now] of [[thumb, start], [hStart, start], [hEnd, end]]) {
        elx.setAttribute("aria-valuemin", "0");
        elx.setAttribute("aria-valuemax", String(total));
        elx.setAttribute("aria-valuenow", String(Math.round(now)));
        elx.setAttribute("aria-valuetext", words);
      }
    }

    // --- dragging ---
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      const v = h.get();
      const which = e.target.closest(".zb-start") ? "start" : e.target.closest(".zb-end") ? "end"
        : e.target.closest(".zb-thumb") ? "move" : "jump";
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (which === "jump") {
        // A press on the bare track centres the view there.
        const r = track.getBoundingClientRect();
        const at = ((e.clientX - r.left) / r.width) * v.total, half = (v.end - v.start) / 2;
        h.set(at - half, at + half);
        drag = { id: e.pointerId, which: "move", x0: e.clientX, v: h.get() };
      } else {
        drag = { id: e.pointerId, which, x0: e.clientX, v };
      }
      thumb.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const per = drag.v.total / track.clientWidth; // units per pixel
      const d = (e.clientX - drag.x0) * per;
      const { start, end } = drag.v;
      if (drag.which === "move") h.set(start + d, end + d);
      else if (drag.which === "start") h.set(Math.min(start + d, end - 1), end);
      else h.set(start, Math.max(end + d, start + 1));
      draw();
    });
    const stop = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      thumb.classList.remove("dragging");
    };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("dblclick", () => { h.fit(); draw(); });

    // --- keyboard ---
    el.addEventListener("keydown", (e) => {
      const dir = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
      const { start, end, total } = h.get();
      const step = Math.max(1, Math.round((end - start) / (e.shiftKey ? 2 : 8)));
      if (dir) {
        e.preventDefault();
        if (e.target === hStart) h.set(Math.min(start + dir * step, end - 1), end);
        else if (e.target === hEnd) h.set(start, Math.max(end + dir * step, start + 1));
        else h.set(start + dir * step, end + dir * step);
      } else if (e.key === "-" || e.key === "=" || e.key === "+") {
        e.preventDefault();
        const mid = (start + end) / 2, half = ((end - start) / 2) * (e.key === "-" ? 1.5 : 1 / 1.5);
        h.set(mid - half, mid + half);
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const span = end - start;
        h.set(e.key === "Home" ? 0 : total - span, e.key === "Home" ? span : total);
      } else return;
      draw();
    });

    window.addEventListener("resize", draw);
    return { draw };
  }

  root.ZoomBar = { create };
})(window);
