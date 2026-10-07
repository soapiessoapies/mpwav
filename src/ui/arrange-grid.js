// The arrangement: a table with a row per track and a numbered column per
// bar. Each cell is a button showing which pattern slot plays there (A-D)
// or nothing. A screen reader hears "Bass, bar 5, pattern B".
//
//   - click / tap a bar: empty -> A -> B -> C -> D -> empty
//   - drag along a row with a mouse: paints the first bar's new choice
//     across, so repeating a pattern is one drag
//   - keyboard: arrows move, Enter cycles, Delete / Backspace empties
//     (Space is play/stop everywhere)
(function (root) {
  "use strict";

  function create(table, { onSet, onSelectTrack }) {
    let song = null;
    let focus = { row: 0, bar: 0 };
    let paint = undefined; // while dragging: the slot (or null) being painted
    let skipClick = false;
    let columns = [];
    let lit = [];

    const cellEl = (row, bar) => table.querySelector(`.bar[data-row="${row}"][data-bar="${bar}"]`);
    const label = (t, bar, slot) => `${t.name}, bar ${bar + 1}, ${slot ? "pattern " + slot : "empty"}`;

    function render(s) {
      song = s;
      const hadFocus = table.contains(document.activeElement);
      table.textContent = "";
      table.setAttribute("aria-label", "Arrangement, " + s.bars + " bars");

      const hr = table.createTHead().insertRow();
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.innerHTML = '<span class="sr-only">Track</span>';
      hr.append(corner);
      for (let b = 0; b < s.bars; b++) {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = b + 1;
        th.dataset.bar = b;
        if (b % 4 === 0) th.classList.add("beat");
        th.setAttribute("aria-label", "bar " + (b + 1));
        hr.append(th);
      }

      const tbody = table.createTBody();
      s.tracks.forEach((t, r) => {
        const tr = tbody.insertRow();
        const th = document.createElement("th");
        th.scope = "row";
        const name = document.createElement("button");
        name.type = "button";
        name.className = "row-name";
        name.textContent = t.name;
        name.setAttribute("aria-label", "Edit " + t.name);
        name.setAttribute("aria-pressed", String(t.id === s.selected));
        name.addEventListener("click", () => onSelectTrack(t.id));
        th.append(name);
        tr.append(th);
        for (let b = 0; b < s.bars; b++) {
          const td = tr.insertCell();
          if (b % 4 === 0) td.classList.add("beat");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "bar";
          btn.dataset.row = r;
          btn.dataset.bar = b;
          btn.tabIndex = r === focus.row && b === focus.bar ? 0 : -1;
          show(btn, t, b);
          td.append(btn);
        }
      });

      columns = [];
      for (let b = 0; b < s.bars; b++) {
        columns.push([table.querySelector(`th[data-bar="${b}"]`),
          ...[...table.querySelectorAll(`.bar[data-bar="${b}"]`)].map((x) => x.parentElement)]);
      }
      lit = [];
      if (hadFocus) cellEl(focus.row, focus.bar)?.focus();
    }

    function show(btn, t, b) {
      const slot = t.arrange[b];
      btn.textContent = slot || "";
      btn.dataset.slot = slot || "";
      btn.setAttribute("aria-label", label(t, b, slot));
    }

    function setCell(btn, slot) {
      const r = Number(btn.dataset.row), b = Number(btn.dataset.bar);
      const t = song.tracks[r];
      if (t.arrange[b] === slot) return;
      onSet(t, b, slot);
      show(btn, t, b);
    }

    const current = (btn) => song.tracks[Number(btn.dataset.row)].arrange[Number(btn.dataset.bar)];

    // Mouse: press to cycle the bar, then drag to paint that same choice along.
    table.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".bar");
      if (!btn || e.pointerType !== "mouse" || e.button !== 0) return;
      e.preventDefault();
      paint = Song.nextSlot(current(btn));
      skipClick = true;
      setCell(btn, paint);
      moveFocus(Number(btn.dataset.row), Number(btn.dataset.bar), false);
    });
    table.addEventListener("pointerover", (e) => {
      if (paint === undefined) return;
      const btn = e.target.closest(".bar");
      if (btn) setCell(btn, paint);
    });
    window.addEventListener("pointerup", () => { paint = undefined; setTimeout(() => { skipClick = false; }, 0); });
    // Touch, keyboard Enter and screen readers arrive as a click.
    table.addEventListener("click", (e) => {
      const btn = e.target.closest(".bar");
      if (!btn) return;
      if (skipClick) { skipClick = false; return; }
      setCell(btn, Song.nextSlot(current(btn)));
      moveFocus(Number(btn.dataset.row), Number(btn.dataset.bar), false);
    });

    table.addEventListener("keydown", (e) => {
      const btn = e.target.closest(".bar");
      if (!btn) return;
      const r = Number(btn.dataset.row), b = Number(btn.dataset.bar);
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[e.key]) {
        e.preventDefault();
        moveFocus(r + moves[e.key][0], b + moves[e.key][1], true);
      } else if (e.key === "Home") {
        e.preventDefault(); moveFocus(r, 0, true);
      } else if (e.key === "End") {
        e.preventDefault(); moveFocus(r, song.bars - 1, true);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); setCell(btn, null);
      }
    });

    function moveFocus(r, b, andFocus) {
      r = Math.max(0, Math.min(song.tracks.length - 1, r));
      b = Math.max(0, Math.min(song.bars - 1, b));
      const old = cellEl(focus.row, focus.bar);
      if (old) old.tabIndex = -1;
      focus = { row: r, bar: b };
      const btn = cellEl(r, b);
      btn.tabIndex = 0;
      if (andFocus) btn.focus();
    }

    // Lights the bar that's playing (or nothing, with -1).
    function setPlayhead(bar) {
      for (const el of lit) el.classList.remove("now");
      lit = bar >= 0 && columns[bar] ? columns[bar] : [];
      for (const el of lit) el.classList.add("now");
    }

    return { render, setPlayhead };
  }

  root.ArrangeGrid = { create };
})(window);
