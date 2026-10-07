// The pattern grid for the selected track: a table with a row per note
// (highest at the top) and a numbered column per step. Each cell is a toggle
// button, so a screen reader hears "E 4, step 5, pressed" and the table's
// row and column headers come for free.
//
//   - click / tap a cell to add or remove a note (drag with a mouse to paint)
//   - keyboard: arrows move around the grid, Home/End jump along the row,
//     Enter toggles (Space is play/stop everywhere)
(function (root) {
  "use strict";

  const ROWS = 13; // an octave, C to C

  function create(table, { onToggle }) {
    let track = null;
    let steps = 16;
    let focus = { row: 0, step: 0 }; // the one cell in the tab order
    let paint = null; // while dragging with a mouse: true adds, false removes
    let playhead = -1;
    let columns = []; // per step: the header and the cells' table cells, for the playhead
    let lit = [];

    const rowMidi = (row) => track.gridBase + (ROWS - 1 - row);
    const cellEl = (row, step) => table.querySelector(`[data-row="${row}"][data-step="${step}"]`);

    function render(t, nSteps) {
      track = t;
      steps = nSteps;
      const hadFocus = table.contains(document.activeElement);
      table.textContent = "";
      table.setAttribute("aria-label",
        `${t.name} pattern, ${Notes.noteName(t.gridBase)} to ${Notes.noteName(t.gridBase + ROWS - 1)}`);

      const thead = table.createTHead();
      const hr = thead.insertRow();
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.innerHTML = '<span class="sr-only">Note</span>';
      hr.append(corner);
      for (let s = 0; s < steps; s++) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = s + 1;
        th.dataset.step = s;
        if (s % 4 === 0) th.classList.add("beat");
        th.setAttribute("aria-label", "step " + (s + 1));
        hr.append(th);
      }

      const tbody = table.createTBody();
      for (let r = 0; r < ROWS; r++) {
        const midi = rowMidi(r);
        const tr = tbody.insertRow();
        if (Notes.isBlack(midi)) tr.className = "sharp";
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = Notes.noteName(midi);
        th.setAttribute("aria-label", Notes.spokenName(midi));
        tr.append(th);
        for (let s = 0; s < steps; s++) {
          const td = tr.insertCell();
          if (s % 4 === 0) td.classList.add("beat");
          const b = document.createElement("button");
          b.type = "button";
          b.className = "cell";
          b.dataset.row = r;
          b.dataset.step = s;
          b.setAttribute("aria-label", `${Notes.spokenName(midi)}, step ${s + 1}`);
          b.setAttribute("aria-pressed", String(Song.hasNote(t, s, midi)));
          b.tabIndex = r === focus.row && s === focus.step ? 0 : -1;
          td.append(b);
        }
      }
      columns = [];
      for (let st = 0; st < steps; st++) {
        columns.push([table.querySelector(`th[data-step="${st}"]`),
          ...[...table.querySelectorAll(`.cell[data-step="${st}"]`)].map((b) => b.parentElement)]);
      }
      lit = [];
      setPlayhead(playhead);
      if (hadFocus) cellEl(focus.row, focus.step)?.focus();
    }

    function toggle(b, want) {
      const r = Number(b.dataset.row), s = Number(b.dataset.step);
      const on = b.getAttribute("aria-pressed") === "true";
      if (want != null && want === on) return;
      const now = onToggle(s, rowMidi(r));
      b.setAttribute("aria-pressed", String(now));
    }

    // Mouse: press and drag to paint notes on (or off, if you started on a
    // note). The click that follows is skipped, since it's already done.
    let skipClick = false;
    table.addEventListener("pointerdown", (e) => {
      const b = e.target.closest(".cell");
      if (!b || e.pointerType !== "mouse" || e.button !== 0) return;
      e.preventDefault();
      paint = b.getAttribute("aria-pressed") !== "true";
      skipClick = true;
      toggle(b, paint);
      moveFocus(Number(b.dataset.row), Number(b.dataset.step), false);
    });
    table.addEventListener("pointerover", (e) => {
      if (paint == null) return;
      const b = e.target.closest(".cell");
      if (b) toggle(b, paint);
    });
    // (A drag that ends on another cell sends no click to skip, so clear the
    // flag once this press's click has had its chance.)
    window.addEventListener("pointerup", () => { paint = null; setTimeout(() => { skipClick = false; }, 0); });
    // Touch, keyboard Enter and screen readers all arrive as a click.
    table.addEventListener("click", (e) => {
      const b = e.target.closest(".cell");
      if (!b) return;
      if (skipClick) { skipClick = false; return; }
      toggle(b);
      moveFocus(Number(b.dataset.row), Number(b.dataset.step), false);
    });

    table.addEventListener("keydown", (e) => {
      const b = e.target.closest(".cell");
      if (!b) return;
      const r = Number(b.dataset.row), s = Number(b.dataset.step);
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        moveFocus(r + moves[e.key][0], s + moves[e.key][1], true);
      } else if (e.key === "Home") {
        e.preventDefault(); moveFocus(r, 0, true);
      } else if (e.key === "End") {
        e.preventDefault(); moveFocus(r, steps - 1, true);
      }
    });

    function moveFocus(r, s, andFocus) {
      r = Math.max(0, Math.min(ROWS - 1, r));
      s = Math.max(0, Math.min(steps - 1, s));
      const old = cellEl(focus.row, focus.step);
      if (old) old.tabIndex = -1;
      focus = { row: r, step: s };
      const b = cellEl(r, s);
      b.tabIndex = 0;
      if (andFocus) b.focus();
    }

    // Lights the column that's playing (or nothing, with -1).
    function setPlayhead(step) {
      playhead = step;
      for (const el of lit) el.classList.remove("now");
      lit = step >= 0 && columns[step] ? columns[step] : [];
      for (const el of lit) el.classList.add("now");
    }

    // Shows a note as on or off without redrawing the grid (recording).
    function mark(step, midi, on) {
      const row = ROWS - 1 - (midi - track.gridBase);
      if (row < 0 || row >= ROWS) return;
      cellEl(row, step)?.setAttribute("aria-pressed", String(on));
    }

    return { render, setPlayhead, mark, ROWS };
  }

  root.StepGrid = { create, ROWS };
})(window);
