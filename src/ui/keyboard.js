// The on-screen piano. Each key is a real <button> in pitch order, so a
// screen reader reads "C 4, C sharp 4, ..." and the keys can be played
// without a mouse:
//   - touch / mouse: press and hold; slide across keys to glide between them
//     (several fingers at once is fine)
//   - keyboard focus: Left/Right arrows move between keys, Home/End jump to
//     the ends, Enter plays the key for as long as it's held (Space is
//     play/stop everywhere)
//   - screen reader "activate": plays a short note
// The keys are laid out on a grid of half-key columns: white keys take two
// columns, black keys straddle the line between two white keys.
(function (root) {
  "use strict";

  const TAP_NOTE = 0.4; // seconds, for a key activated without being held

  function create(el, { onOn, onOff }) {
    let base = 60; // lowest key, a C
    let span = 24; // semitones shown above it
    let focusMidi = base;
    const pointers = new Map(); // pointerId -> midi
    const pointerAt = new Map(); // midi -> time of last pointer press, to skip its click
    const keyHeld = new Set(); // midis held with Enter
    const lit = new Set();

    function render() {
      const hadFocus = el.contains(document.activeElement);
      el.textContent = "";
      let whites = 0;
      for (let m = base; m <= base + span; m++) {
        const k = document.createElement("button");
        k.type = "button";
        k.className = "key " + (Notes.isBlack(m) ? "black" : "white");
        k.dataset.midi = m;
        k.setAttribute("aria-label", Notes.spokenName(m));
        k.tabIndex = m === focusMidi ? 0 : -1;
        if (Notes.isBlack(m)) {
          k.style.gridColumn = `${whites * 2} / ${whites * 2 + 2}`;
        } else {
          k.style.gridColumn = `${whites * 2 + 1} / span 2`;
          whites++;
        }
        const hint = hintFor(m);
        const name = Notes.pitchClass(m) === 0 ? Notes.noteName(m) : "";
        if (hint || name) {
          k.innerHTML =
            (hint ? `<span class="hint" aria-hidden="true">${hint}</span>` : "") +
            (name ? `<span class="name" aria-hidden="true">${name}</span>` : "");
        }
        if (lit.has(m)) k.classList.add("on");
        el.append(k);
      }
      el.style.setProperty("--cols", whites * 2);
      if (hadFocus) keyEl(focusMidi)?.focus();
    }

    // Which computer key plays this note, shown on the key as a reminder.
    const OFFSET_TO_KEY = {};
    for (const [code, off] of Object.entries(Notes.KEY_OFFSETS)) {
      OFFSET_TO_KEY[off] = code === "Semicolon" ? ";" : code.slice(3);
    }
    const hintFor = (m) => OFFSET_TO_KEY[m - base] || "";

    const keyEl = (m) => el.querySelector(`.key[data-midi="${m}"]`);
    const midiAt = (x, y) => {
      const k = document.elementFromPoint(x, y)?.closest(".key");
      return k && el.contains(k) ? Number(k.dataset.midi) : null;
    };

    // --- pointer: touch and mouse ---
    el.addEventListener("pointerdown", (e) => {
      const k = e.target.closest(".key");
      if (!k || e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const m = Number(k.dataset.midi);
      pointers.set(e.pointerId, m);
      pointerAt.set(m, performance.now());
      onOn(m);
    });
    el.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const was = pointers.get(e.pointerId);
      const now = midiAt(e.clientX, e.clientY);
      if (now === was) return;
      if (was != null) onOff(was);
      pointers.set(e.pointerId, now);
      if (now != null) { pointerAt.set(now, performance.now()); onOn(now); }
    });
    const lift = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const m = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (m != null) onOff(m);
    };
    el.addEventListener("pointerup", lift);
    el.addEventListener("pointercancel", lift);
    el.addEventListener("lostpointercapture", lift);

    // --- keyboard focus on the keys ---
    el.addEventListener("keydown", (e) => {
      const k = e.target.closest(".key");
      if (!k) return;
      const m = Number(k.dataset.midi);
      const move = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (move) { e.preventDefault(); focusKey(m + move); return; }
      if (e.key === "Home") { e.preventDefault(); focusKey(base); return; }
      if (e.key === "End") { e.preventDefault(); focusKey(base + span); return; }
      if (e.key === "Enter") {
        e.preventDefault(); // no click: the note lasts as long as the key is held
        e.stopPropagation();
        if (!e.repeat && !keyHeld.has(m)) { keyHeld.add(m); onOn(m); }
      }
    });
    el.addEventListener("keyup", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      for (const m of keyHeld) onOff(m);
      keyHeld.clear();
    });
    // A click that no pointer or held key made: a screen reader activating
    // the button. Play a short note.
    el.addEventListener("click", (e) => {
      const k = e.target.closest(".key");
      if (!k) return;
      const m = Number(k.dataset.midi);
      if (performance.now() - (pointerAt.get(m) || 0) < 1000) return;
      onOn(m);
      setTimeout(() => onOff(m), TAP_NOTE * 1000);
    });

    function focusKey(m) {
      m = Math.min(base + span, Math.max(base, m));
      const old = keyEl(focusMidi);
      if (old) old.tabIndex = -1;
      focusMidi = m;
      const k = keyEl(m);
      k.tabIndex = 0;
      k.focus();
    }

    // Lets go of everything this keyboard is holding (focus left the page).
    function releaseAll() {
      for (const m of pointers.values()) if (m != null) onOff(m);
      pointers.clear();
      for (const m of keyHeld) onOff(m);
      keyHeld.clear();
    }

    function setLit(m, on) {
      if (on) lit.add(m); else lit.delete(m);
      keyEl(m)?.classList.toggle("on", on);
    }

    function setRange(newBase, newSpan) {
      releaseAll();
      focusMidi = Math.min(newBase + newSpan, Math.max(newBase, focusMidi + (newBase - base)));
      base = newBase;
      span = newSpan;
      render();
    }

    render();
    return {
      setRange, setLit, releaseAll,
      get base() { return base; },
      get span() { return span; },
    };
  }

  root.Keyboard = { create };
})(window);
