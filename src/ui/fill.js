// Keeps --p (how full a slider is, 0%..100%) on every range input, for the
// pixel-block sliders in styles/look.css. Sliders change three ways, and
// each is caught here so no other code has to remember:
//   - the person drags or keys it (input events)
//   - code sets .value (the value setter is wrapped, for range inputs only)
//   - sliders are added, or their min / max change (a MutationObserver)
(function (root) {
  "use strict";

  function paint(el) {
    const min = el.min === "" ? 0 : Number(el.min);
    const max = el.max === "" ? 100 : Number(el.max);
    const p = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
    el.style.setProperty("--p", Math.max(0, Math.min(100, p)) + "%");
  }
  const isRange = (el) => el instanceof HTMLInputElement && el.type === "range";

  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    configurable: true, enumerable: desc.enumerable, get: desc.get,
    set(v) { desc.set.call(this, v); if (this.type === "range") paint(this); },
  });

  document.addEventListener("input", (e) => { if (isRange(e.target)) paint(e.target); }, true);

  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") { if (isRange(m.target)) paint(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (isRange(n)) paint(n);
        for (const r of n.querySelectorAll('input[type="range"]')) paint(r);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["min", "max", "value", "type"] });

  const all = () => { for (const r of document.querySelectorAll('input[type="range"]')) paint(r); };
  document.addEventListener("DOMContentLoaded", all);
  root.RangeFill = { paint, all };
})(window);
