// Speaks short status messages to screen readers through a polite live
// region ("Octave 5", "Preset: Chip Lead"). Saying the same text twice in a
// row still gets read, because the region is cleared first.
// tell() also shows the words on screen for a few seconds, for changes a
// sighted person could miss too (the slide or the layout changing).
(function (root) {
  "use strict";

  let el = null;
  let box = null;
  let timer = 0;
  let hideTimer = 0;

  function attach(region, notice) {
    el = region;
    box = notice || null;
  }

  function say(text) {
    if (!el) return;
    clearTimeout(timer);
    el.textContent = "";
    timer = setTimeout(() => { el.textContent = text; }, 30);
  }

  function tell(text) {
    say(text);
    if (!box) return;
    clearTimeout(hideTimer);
    box.textContent = text;
    box.hidden = false;
    hideTimer = setTimeout(() => { box.hidden = true; }, 4500);
  }

  root.Announce = { attach, say, tell };
})(window);
