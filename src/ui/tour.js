// The guided tour: first-time coaching, ported from Critters' coach marks.
// It dims the studio, rings one real control at a time and floats a short
// explanation beside it with Back / Next / Skip and a step count. Shown once
// on a first visit (a localStorage flag) and replayable any time from
// Settings > Tutorial > Take the tour.
//
// Accessible: the bubble is a labelled dialog, focus moves to its Next
// button and stays inside it (Tab cycles Back / Skip / Next), Esc ends the
// tour, each step is announced, and focus returns where it was afterwards.
// Steps whose control isn't on screen (a phone layout, a hidden panel) are
// skipped rather than pointing at nothing.
//
//   Tour.STEPS           the walk-through, in order
//   Tour.start(opts)     run it; opts.onEnd(reason) when it ends
//   Tour.stop()          end it now
//   Tour.active()        whether it's showing
//   Tour.shouldAutoRun() / Tour.markDone()
(function (root) {
  "use strict";

  const DONE_KEY = "sound-studio.tour.done.v1";

  const STEPS = [
    {
      el: "#play",
      title: "Play and stop",
      text: "Starts and stops the song. Space does the same from anywhere.",
    },
    {
      el: "#playbox",
      title: "The timeline",
      text: "Each row is a track and each coloured block is a clip: a loop of notes. " +
        "Drag a clip to move it, drag its right edge to repeat it, and double-click one to open its notes.",
    },
    {
      el: "#new-clip",
      title: "Make a clip",
      text: "New clip adds an empty clip to the selected track. Double-clicking an empty spot on the timeline does too.",
    },
    {
      el: "#clip-editor",
      title: "The clip editor",
      text: "An open clip's notes show here as blocks. Click to add a note, drag to move it, drag its end to make it longer.",
    },
    {
      el: "#keys-section",
      title: "Play notes",
      text: "Tap these keys or use your computer keys A W S E D … K. Z and X change octave. Esc stops every note.",
    },
    {
      el: "#record",
      title: "Record",
      text: "Press Record, then play: what you play goes into the clip, held notes keep their length. Undo take removes it again.",
    },
    {
      el: "#note-edit",
      title: "Note Edit",
      text: "Pages for the selected note, the track's sound, its mix and the whole song. Use the arrows or tabs to turn the page.",
    },
    {
      el: "#tempo",
      title: "Tempo",
      text: "How fast the song plays, in beats per minute. The tempo menu has tap tempo, the metronome and count-in.",
    },
    {
      el: "#songs-btn",
      title: "Home",
      text: "Your songs: start a new one, open the demo, save a song file, or export a .wav to share.",
    },
    {
      el: "#settings-btn",
      title: "Settings",
      text: "Look, size and layout, tips under each part of the studio, and this tour again (Settings, Tutorial).",
      doneLabel: "Start making music",
    },
  ];

  let layer = null;
  let spot = null;
  let bubble = null;
  let steps = null;
  let idx = 0;
  let onEnd = null;
  let returnFocus = null;

  function shouldAutoRun() {
    try { return localStorage.getItem(DONE_KEY) !== "1"; } catch (e) { return false; }
  }

  function markDone() {
    try { localStorage.setItem(DONE_KEY, "1"); } catch (e) { /* storage off: fine */ }
  }

  function active() { return !!layer; }

  // A step's control, if it's actually on screen.
  function target(step) {
    const el = document.querySelector(step.el);
    if (!el || el.offsetParent === null) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  }

  function visibleSteps(list) {
    return list.filter((s) => target(s));
  }

  // Ring the control and park the bubble beside it, inside the window.
  function place(el) {
    if (!layer || !el) return;
    const t = el.getBoundingClientRect();
    const pad = 6;
    spot.style.top = (t.top - pad) + "px";
    spot.style.left = (t.left - pad) + "px";
    spot.style.width = (t.width + pad * 2) + "px";
    spot.style.height = (t.height + pad * 2) + "px";

    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const bw = bubble.offsetWidth || 320;
    const bh = bubble.offsetHeight || 160;
    const gap = 12;
    let x, y;
    if (t.right + gap + bw <= vw - 8) { x = t.right + gap; y = t.top; } // right of it
    else if (t.left - gap - bw >= 8) { x = t.left - gap - bw; y = t.top; } // left of it
    else if (t.bottom + gap + bh <= vh - 8) { x = t.left; y = t.bottom + gap; } // below
    else { x = t.left; y = t.top - gap - bh; } // above
    x = Math.max(8, Math.min(x, vw - bw - 8));
    y = Math.max(8, Math.min(y, vh - bh - 8));
    bubble.style.left = x + "px";
    bubble.style.top = y + "px";
  }

  function button(label, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }

  function show(i) {
    idx = i;
    const step = steps[i];
    const last = i === steps.length - 1;
    const el = target(step);
    if (!el) { if (last) stop("done"); else show(i + 1); return; }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });

    bubble.innerHTML = "";
    const h = document.createElement("h2");
    h.id = "tour-title";
    h.textContent = step.title;
    const p = document.createElement("p");
    p.id = "tour-text";
    p.textContent = step.text;
    const foot = document.createElement("div");
    foot.className = "tour-foot";
    const count = document.createElement("span");
    count.className = "tour-count";
    count.textContent = (i + 1) + " of " + steps.length;
    foot.appendChild(count);
    if (i > 0) foot.appendChild(button("Back", "quiet", () => show(i - 1)));
    if (!last) foot.appendChild(button("Skip tour", "quiet", () => stop("skip")));
    const next = button(last ? (step.doneLabel || "Done") : "Next", "tour-next", () => (last ? stop("done") : show(i + 1)));
    foot.appendChild(next);
    bubble.append(h, p, foot);

    place(el);
    requestAnimationFrame(() => place(el));
    next.focus();
    if (root.Announce) root.Announce.say("Tour, step " + (i + 1) + " of " + steps.length + ": " + step.title);
  }

  function onKey(e) {
    if (!layer) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stop("skip"); return; }
    if (e.key === "Tab") {
      // Keep focus in the bubble while the tour is up.
      const btns = Array.from(bubble.querySelectorAll("button"));
      if (!btns.length) return;
      const at = btns.indexOf(document.activeElement);
      e.preventDefault();
      const n = (at + (e.shiftKey ? -1 : 1) + btns.length) % btns.length;
      btns[n].focus();
      return;
    }
    // Space and letters must not start the song or play notes behind the tour.
    if (!bubble.contains(e.target) || e.key !== "Enter") e.stopPropagation();
  }

  function onResize() {
    if (steps) place(target(steps[idx]));
  }

  function stop(reason) {
    if (!layer) return;
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    layer.remove();
    layer = spot = bubble = steps = null;
    markDone();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
    returnFocus = null;
    if (root.Announce) root.Announce.say(reason === "skip" ? "Tour closed" : "Tour finished");
    const cb = onEnd;
    onEnd = null;
    if (cb) cb(reason || "done");
  }

  function start(opts) {
    opts = opts || {};
    stop("restart");
    const list = visibleSteps(opts.steps || STEPS);
    if (!list.length) return false;
    returnFocus = document.activeElement;
    onEnd = opts.onEnd || null;
    layer = document.createElement("div");
    layer.className = "tour-layer";
    spot = document.createElement("div");
    spot.className = "tour-spot";
    spot.setAttribute("aria-hidden", "true");
    bubble = document.createElement("div");
    bubble.className = "tour-bubble";
    bubble.setAttribute("role", "dialog");
    bubble.setAttribute("aria-modal", "true");
    bubble.setAttribute("aria-labelledby", "tour-title");
    bubble.setAttribute("aria-describedby", "tour-text");
    layer.append(spot, bubble);
    document.body.appendChild(layer);
    steps = list;
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    show(0);
    return true;
  }

  const Tour = { STEPS, DONE_KEY, start, stop, active, shouldAutoRun, markDone };
  if (typeof module !== "undefined" && module.exports) module.exports = Tour;
  else root.Tour = Tour;
})(typeof window !== "undefined" ? window : globalThis);
