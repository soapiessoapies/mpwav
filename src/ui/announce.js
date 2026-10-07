// Speaks short status messages to screen readers through a polite live
// region ("Octave 5", "Preset: Chip Lead"). Saying the same text twice in a
// row still gets read, because the region is cleared first.
(function (root) {
  "use strict";

  let el = null;
  let timer = 0;

  function attach(region) {
    el = region;
  }

  function say(text) {
    if (!el) return;
    clearTimeout(timer);
    el.textContent = "";
    timer = setTimeout(() => { el.textContent = text; }, 30);
  }

  root.Announce = { attach, say };
})(window);
