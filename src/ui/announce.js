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

  // opts.action = { label, run }: a button in the notice (Undo after a
  // delete). The notice then stays up longer, and while it's hovered or has focus.
  function tell(text, opts = {}) {
    say(text);
    if (!box) return;
    clearTimeout(hideTimer);
    box.textContent = "";
    const words = document.createElement("span");
    words.textContent = text;
    words.setAttribute("aria-hidden", "true"); // already spoken by the live region
    box.append(words);
    const act = opts.action;
    box.classList.toggle("has-action", !!act);
    if (act) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "notice-action";
      b.textContent = act.label;
      b.setAttribute("aria-label", `${act.label}: ${text}`);
      b.addEventListener("click", () => { box.hidden = true; act.run(); });
      box.append(b);
    }
    box.hidden = false;
    const hide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (box.matches(":hover, :focus-within")) return hide();
        box.hidden = true;
      }, act ? 8000 : 4500);
    };
    hide();
  }

  // Takes down a notice that has a button (its Undo would undo something
  // else once anything else has changed).
  function dropAction() {
    if (box && box.classList.contains("has-action") && !box.hidden && !box.contains(document.activeElement)) box.hidden = true;
  }

  root.Announce = { attach, say, tell, dropAction };
})(window);
