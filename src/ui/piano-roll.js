// The clip editor's piano roll: every pitch from C1 to C8 as a row (scroll
// up and down through them, piano keys down the left), time across in
// steps, and notes as blocks colored by key in the track's color.
//
//   mouse:   click an empty spot to add a note (keep the button down and
//            drag right to draw it longer); drag a note to move it, drag
//            its right edge to stretch it; Shift-click adds to the
//            selection; double-click deletes. Click a piano key to hear it.
//   touch:   tap to add, tap a note to select it; drag a note to move it,
//            drag its edge to stretch it; swipe empty space to scroll.
//   keyboard (the roll is one focusable area with a cursor): arrows move
//            the cursor (Ctrl: a beat; Page Up/Down: an octave), Enter
//            adds or removes the note there, Shift + Left/Right stretches
//            it, Alt + arrows move it, Delete removes the selected notes.
//            Every move is announced: "E 4, step 5, note, 2 steps long".
(function (root) {
  "use strict";

  const TOP = 108, BOTTOM = 24; // C8 down to C1
  const ROWS = TOP - BOTTOM + 1;
  const KEYS_W = 46;
  const GRIP = 10; // px at a note's right edge that stretch it
  const TAP_SLOP = 8;

  function create(el, h) {
    // h: { onAdd(step, midi), onRemove(notes), onMove(note, step, midi), onResize(note, len),
    //      onSelect(), onChanged(text), onPreview(midi), say(text) }
    let view = null; // { c, color, name, steps, defLen, selected: Set }
    let cursor = { step: 0, midi: 60 };
    let builtFor = ""; // steps + sizes the background was built for
    let notesLayer = null, cursorEl = null, playheadEl = null;

    const rowH = () => (document.documentElement.dataset.layout === "compact" ? 22 : 18);
    // Steps stretch to fill the editor's width, but never get narrower than this.
    const minStepW = () => (document.documentElement.dataset.layout === "compact" ? 30 : 24);
    let sw = 24;
    const stepW = () => sw;
    const fitStepW = () => Math.max(minStepW(), Math.floor((el.clientWidth - KEYS_W - 2) / view.steps));
    const yOf = (midi) => (TOP - midi) * rowH();
    const xOf = (step) => KEYS_W + step * stepW();
    const where = (s) => (view.steps > 16 ? `bar ${Math.floor(s / 16) + 1} step ${(s % 16) + 1}` : `step ${s + 1}`);
    const lenWords = (n) => `${n} step${n > 1 ? "s" : ""}`;

    el.tabIndex = 0;
    el.setAttribute("role", "application");
    el.setAttribute("aria-roledescription", "piano roll");

    // The rows, keys and step lines: rebuilt only when the size changes.
    function buildBackground() {
      el.textContent = "";
      const inner = document.createElement("div");
      inner.className = "roll-inner";
      inner.style.width = xOf(view.steps) + "px";
      inner.style.height = ROWS * rowH() + "px";
      inner.style.setProperty("--row-h", rowH() + "px");
      inner.style.setProperty("--step-w", stepW() + "px");

      const rows = document.createElement("div");
      rows.className = "roll-rows";
      rows.setAttribute("aria-hidden", "true");
      const keys = document.createElement("div");
      keys.className = "roll-keys";
      keys.setAttribute("aria-hidden", "true");
      for (let m = TOP; m >= BOTTOM; m--) {
        const black = Notes.isBlack(m);
        const r = document.createElement("div");
        r.className = "roll-row" + (black ? " sharp" : "") + (Notes.pitchClass(m) === 0 ? " c" : "");
        rows.append(r);
        const k = document.createElement("div");
        k.className = "roll-key" + (black ? " sharp" : "");
        k.dataset.midi = m;
        if (Notes.pitchClass(m) === 0) k.textContent = Notes.noteName(m);
        keys.append(k);
      }
      const lines = document.createElement("div");
      lines.className = "roll-lines";
      lines.setAttribute("aria-hidden", "true");
      lines.style.left = KEYS_W + "px";
      lines.style.width = view.steps * stepW() + "px";

      notesLayer = document.createElement("div");
      notesLayer.className = "roll-notes";
      cursorEl = document.createElement("div");
      cursorEl.className = "roll-cursor";
      cursorEl.setAttribute("aria-hidden", "true");
      playheadEl = document.createElement("div");
      playheadEl.className = "roll-playhead";
      playheadEl.hidden = true;
      inner.append(rows, lines, notesLayer, cursorEl, playheadEl, keys);
      el.append(inner);
      builtFor = `${view.steps}:${rowH()}:${stepW()}`;
    }

    function drawNotes() {
      notesLayer.textContent = "";
      view.c.notes.forEach((n, i) => {
        const d = document.createElement("div");
        d.className = "note" + (view.selected.has(n) ? " selected" : "");
        d.dataset.i = i;
        d.style.left = xOf(n.step) + "px";
        d.style.top = yOf(n.midi) + "px";
        d.style.width = n.len * stepW() - 2 + "px";
        d.style.height = rowH() - 2 + "px";
        d.style.background = Colors.noteColor(view.color, n.midi);
        d.style.color = Colors.noteInk(view.color, n.midi);
        if (n.len * stepW() >= 34) d.textContent = Notes.noteName(n.midi);
        const vel = document.createElement("span");
        vel.className = "note-vel";
        vel.style.width = Math.round(n.vel * 100) + "%";
        const grip = document.createElement("span");
        grip.className = "note-grip";
        d.append(vel, grip);
        notesLayer.append(d);
      });
      placeCursor();
    }

    function placeCursor() {
      cursorEl.style.left = xOf(cursor.step) + "px";
      cursorEl.style.top = yOf(cursor.midi) + "px";
      cursorEl.style.width = stepW() + "px";
      cursorEl.style.height = rowH() + "px";
    }

    function render(v) {
      const first = !view || view.c !== v.c;
      view = v;
      if (cursor.step >= v.steps) cursor.step = 0;
      sw = fitStepW();
      if (builtFor !== `${v.steps}:${rowH()}:${stepW()}`) {
        buildBackground();
        // Its vertical scrollbar can appear only now, leaving a little less
        // room than measured: fit again so a short clip never scrolls sideways.
        const refit = fitStepW();
        if (refit !== sw) { sw = refit; buildBackground(); }
      }
      el.setAttribute("aria-label", `${v.name} notes, piano roll`);
      drawNotes();
      if (first) centerOn(v.c.notes.length ? Math.round(v.c.notes.reduce((a, n) => a + n.midi, 0) / v.c.notes.length) : 60);
    }

    function centerOn(midi) {
      cursor.midi = Math.max(BOTTOM, Math.min(TOP, midi));
      placeCursor();
      el.scrollTop = yOf(midi) - el.clientHeight / 2 + rowH() / 2;
    }

    // Keeps the cursor on screen as it moves.
    function reveal() {
      const x = xOf(cursor.step), y = yOf(cursor.midi);
      if (y < el.scrollTop) el.scrollTop = y;
      else if (y + rowH() > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH() - el.clientHeight;
      if (x < el.scrollLeft + KEYS_W) el.scrollLeft = x - KEYS_W;
      else if (x + stepW() > el.scrollLeft + el.clientWidth) el.scrollLeft = x + stepW() - el.clientWidth;
    }

    function describe() {
      const n = Song.noteAt(view.c, cursor.step, cursor.midi);
      let text = `${Notes.spokenName(cursor.midi)}, ${where(cursor.step)}, `;
      if (!n) text += "empty";
      else text += `note, ${lenWords(n.len)} long` + (n.step !== cursor.step ? `, started at ${where(n.step)}` : "") +
        (view.selected.has(n) ? ", selected" : "");
      return text;
    }

    // --- pointer ---
    const cellAt = (e) => {
      const r = el.querySelector(".roll-inner").getBoundingClientRect();
      const x = e.clientX - r.left - KEYS_W, y = e.clientY - r.top;
      return { x, step: Math.floor(x / stepW()), midi: TOP - Math.floor(y / rowH()) };
    };
    const noteFrom = (target) => {
      const d = target.closest(".note");
      return d ? view.c.notes[Number(d.dataset.i)] : null;
    };

    let drag = null;
    // Double-click / double-tap, by note: the note blocks are redrawn on
    // every press, so the browser's own dblclick can't see the same element twice.
    let lastPress = { n: null, at: 0 };
    el.addEventListener("pointerdown", (e) => {
      if (!view || e.button > 0) return;
      const key = e.target.closest(".roll-key");
      if (key) { h.onPreview(Number(key.dataset.midi)); return; }
      const cell = cellAt(e);
      if (cell.x < 0 || cell.step >= view.steps) return;
      const n = noteFrom(e.target);
      if (n) {
        e.preventDefault();
        const now = performance.now();
        if (lastPress.n === n && now - lastPress.at < 400) {
          lastPress = { n: null, at: 0 };
          view.selected.delete(n);
          h.onRemove([n]);
          h.say(`Deleted ${Notes.spokenName(n.midi)}`);
          return;
        }
        lastPress = { n, at: now };
        el.focus({ preventScroll: true });
        el.setPointerCapture(e.pointerId);
        if (e.shiftKey) { view.selected.has(n) ? view.selected.delete(n) : view.selected.add(n); }
        else if (!view.selected.has(n)) { view.selected.clear(); view.selected.add(n); }
        const grip = e.target.closest(".note-grip") || (cell.x - n.step * stepW() > n.len * stepW() - GRIP);
        drag = { id: e.pointerId, n, mode: grip ? "resize" : "move", x0: e.clientX, y0: e.clientY,
          step0: n.step, midi0: n.midi, len0: n.len, changed: false };
        cursor = { step: cell.step, midi: n.midi };
        h.onSelect();
        drawNotes();
        return;
      }
      if (e.pointerType === "mouse") {
        e.preventDefault();
        el.focus({ preventScroll: true });
        const added = h.onAdd(cell.step, cell.midi);
        if (!added) return;
        el.setPointerCapture(e.pointerId);
        view.selected.clear();
        view.selected.add(added);
        cursor = { step: cell.step, midi: cell.midi };
        drag = { id: e.pointerId, n: added, mode: "draw", x0: e.clientX, y0: e.clientY, len0: added.len, changed: true };
        h.onSelect();
        drawNotes();
      } else {
        // Touch: a tap adds a note; a swipe scrolls instead.
        drag = { id: e.pointerId, mode: "tap", x0: e.clientX, y0: e.clientY, cell };
      }
    });

    el.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === "tap") {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > TAP_SLOP) drag = null;
        return;
      }
      const ds = Math.round((e.clientX - drag.x0) / stepW());
      if (drag.mode === "move") {
        const dm = -Math.round((e.clientY - drag.y0) / rowH());
        const before = drag.n.midi;
        if (h.onMove(drag.n, drag.step0 + ds, drag.midi0 + dm)) {
          drag.changed = true;
          if (drag.n.midi !== before) h.onPreview(drag.n.midi);
          cursor = { step: drag.n.step, midi: drag.n.midi };
          drawNotes();
        }
      } else {
        const len = h.onResize(drag.n, drag.len0 + ds);
        if (len !== drag.n.len || ds !== 0) { drag.changed = true; drawNotes(); }
      }
    });

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.mode === "tap") {
        const added = h.onAdd(d.cell.step, d.cell.midi);
        if (added) {
          view.selected.clear();
          view.selected.add(added);
          cursor = { step: d.cell.step, midi: d.cell.midi };
          h.onChanged(`Added ${Notes.spokenName(added.midi)}`);
        }
        return;
      }
      if (!d.changed) return;
      if (d.mode === "move") h.onChanged(`Moved to ${Notes.spokenName(d.n.midi)}, ${where(d.n.step)}`);
      else h.onChanged(`${d.mode === "draw" ? "Added" : "Now"} ${lenWords(d.n.len)} long`);
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", (e) => { if (drag && drag.id === e.pointerId) drag = null; });


    // --- keyboard ---
    el.addEventListener("keydown", (e) => {
      if (!view || e.target !== el) return;
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      const pitch = { ArrowUp: 1, ArrowDown: -1 }[e.key];
      const here = () => Song.noteAt(view.c, cursor.step, cursor.midi);
      let moved = false;

      if ((step || pitch) && e.altKey) {
        // Move the note under the cursor; the cursor goes with it.
        const n = here();
        if (!n) { h.say("No note here to move"); e.preventDefault(); return; }
        const ok = h.onMove(n, n.step + (step || 0), n.midi + (pitch || 0));
        if (ok) { cursor = { step: n.step, midi: n.midi }; h.onChanged(); }
        else h.say("Can't move it there");
        moved = ok;
      } else if (step && e.shiftKey) {
        const n = here();
        if (!n) { h.say("No note here to stretch"); e.preventDefault(); return; }
        const before = n.len;
        h.onResize(n, n.len + step);
        h.onChanged();
        if (n.len === before) h.say("Can't stretch it further");
        moved = n.len !== before;
      } else if (step) {
        cursor.step = Math.max(0, Math.min(view.steps - 1, cursor.step + step * (e.ctrlKey ? 4 : 1)));
        moved = true;
      } else if (pitch) {
        cursor.midi = Math.max(BOTTOM, Math.min(TOP, cursor.midi + pitch));
        moved = true;
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        cursor.midi = Math.max(BOTTOM, Math.min(TOP, cursor.midi + (e.key === "PageUp" ? 12 : -12)));
        moved = true;
      } else if (e.key === "Home" || e.key === "End") {
        cursor.step = e.key === "Home" ? 0 : view.steps - 1;
        moved = true;
      } else if (e.key === "Enter") {
        const n = here();
        if (n) {
          view.selected.delete(n);
          h.onRemove([n]);
          h.say(`Removed ${Notes.spokenName(n.midi)}`);
        } else {
          const added = h.onAdd(cursor.step, cursor.midi);
          if (added) {
            view.selected.clear();
            view.selected.add(added);
            h.onChanged();
            h.say(`Added ${Notes.spokenName(added.midi)}, ${lenWords(added.len)} long`);
          }
        }
        e.preventDefault();
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const list = view.selected.size ? [...view.selected] : [here()].filter(Boolean);
        if (list.length) {
          view.selected.clear();
          h.onRemove(list);
          h.say(`Removed ${list.length} note${list.length > 1 ? "s" : ""}`);
        }
        e.preventDefault();
        return;
      } else {
        return;
      }
      e.preventDefault();
      // The note under the cursor becomes the selection, so the Note page follows along.
      const n = here();
      view.selected.clear();
      if (n) view.selected.add(n);
      h.onSelect();
      drawNotes();
      reveal();
      if (moved) h.say(describe());
    });

    el.addEventListener("focus", () => el.classList.add("focused"));
    el.addEventListener("blur", () => el.classList.remove("focused"));

    // --- playhead (a step in the clip, or -1) ---
    function setPlayhead(step) {
      if (!playheadEl) return;
      if (step < 0) { playheadEl.hidden = true; return; }
      playheadEl.hidden = false;
      playheadEl.style.transform = `translateX(${xOf(step)}px)`;
    }

    // Redraw from scratch (after a layout or theme change).
    function rebuild() { builtFor = ""; if (view) render(view); }
    // The editor's width changes with the window: refit the steps.
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (view && fitStepW() !== sw) rebuild(); }, 120);
    });

    return { render, setPlayhead, rebuild, focus: () => el.focus(), get cursor() { return { ...cursor }; } };
  }

  root.PianoRoll = { create, TOP, BOTTOM };
})(window);
