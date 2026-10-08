// Window edit mode: the four panels (playing box, clip editor, Note Edit,
// keyboard) live in three columns (main, side, bottom) and can be moved
// between them and reordered to suit how someone works.
//
//   - every panel has a collapse button in its header
//   - in Arrange mode each panel also gets a drag handle (drag it anywhere
//     in a column) and Move up / Move down / Place in controls, which do
//     the same job from a keyboard or a screen reader
// The layout is plain data, { main: [ids], side: [ids], bottom: [ids] },
// saved with the other view settings.
(function (root) {
  "use strict";

  const COLS = [["main", "Main column"], ["side", "Side column"], ["bottom", "Bottom"]];

  // panels: [{ id, name }]; layout: saved { main, side, bottom } or null;
  // folded: ids of collapsed panels; h: { onChange(layout, folded, text) }
  function create(panels, layout, folded, h) {
    const DEFAULT = { main: ["playbox", "clip-editor"], side: ["note-edit"], bottom: ["keys-section"] };
    const cols = Object.fromEntries(COLS.map(([k]) => [k, document.getElementById("col-" + k)]));
    const nameOf = (id) => panels.find((p) => p.id === id).name;
    let state = valid(layout) ? clone(layout) : clone(DEFAULT);
    let foldedSet = new Set(folded || []);
    let arranging = false;

    function clone(l) { return { main: [...l.main], side: [...l.side], bottom: [...l.bottom] }; }
    // A saved layout must place each panel exactly once.
    function valid(l) {
      if (!l || typeof l !== "object" || !COLS.every(([k]) => Array.isArray(l[k]))) return false;
      const all = COLS.flatMap(([k]) => l[k]);
      return all.length === panels.length && panels.every((p) => all.includes(p.id));
    }
    const colOf = (id) => COLS.map(([k]) => k).find((k) => state[k].includes(id));

    // --- the tools each panel gets in its header ---
    for (const p of panels) {
      const panel = document.getElementById(p.id);
      const head = panel.querySelector(".panel-head");
      const tools = document.createElement("div");
      tools.className = "panel-tools";
      tools.innerHTML =
        `<span class="drag-handle" aria-hidden="true" title="Drag to move"></span>` +
        `<span class="arrange-only">` +
        `<button type="button" class="mv-up">Move up</button>` +
        `<button type="button" class="mv-down">Move down</button>` +
        `<label class="inline"><span class="sr-only">Place ${p.name} in</span>` +
        `<select class="mv-col">${COLS.map(([k, w]) => `<option value="${k}">${w}</option>`).join("")}</select></label>` +
        `</span>`;
      for (const b of tools.querySelectorAll(".mv-up, .mv-down")) b.setAttribute("aria-label", `${b.textContent} ${p.name}`);
      tools.querySelector(".mv-up").addEventListener("click", () => moveBy(p.id, -1));
      tools.querySelector(".mv-down").addEventListener("click", () => moveBy(p.id, 1));
      tools.querySelector(".mv-col").addEventListener("change", (e) => place(p.id, e.target.value));
      head.prepend(tools);
      // The keyboard panel already has its own show / hide; the others get one.
      if (p.id !== "keys-section") {
        const fold = document.createElement("button");
        fold.type = "button";
        fold.className = "panel-fold";
        fold.setAttribute("aria-label", `${p.name} panel`);
        fold.addEventListener("click", () => toggleFold(p.id));
        head.append(fold);
      }
      tools.querySelector(".drag-handle").addEventListener("pointerdown", (e) => startDrag(e, p.id));
    }

    // Puts every panel where the layout says, and syncs the controls.
    function apply() {
      for (const [k] of COLS) for (const id of state[k]) cols[k].append(document.getElementById(id));
      for (const p of panels) {
        const panel = document.getElementById(p.id);
        const k = colOf(p.id), i = state[k].indexOf(p.id);
        panel.querySelector(".mv-col").value = k;
        panel.querySelector(".mv-up").disabled = i === 0;
        panel.querySelector(".mv-down").disabled = i === state[k].length - 1;
        const isFolded = foldedSet.has(p.id);
        panel.classList.toggle("folded", isFolded);
        const fold = panel.querySelector(".panel-fold");
        if (fold) fold.setAttribute("aria-expanded", String(!isFolded));
      }
      for (const [k] of COLS) cols[k].classList.toggle("empty", !state[k].length);
    }

    function changed(text) {
      apply();
      h.onChange(clone(state), [...foldedSet], text);
    }

    function moveBy(id, dir) {
      const k = colOf(id), list = state[k], i = list.indexOf(id), j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      changed(`${nameOf(id)} moved ${dir < 0 ? "up" : "down"}`);
      document.getElementById(id).querySelector(dir < 0 ? ".mv-up" : ".mv-down").focus();
    }

    function place(id, col, index) {
      for (const [k] of COLS) state[k] = state[k].filter((x) => x !== id);
      const list = state[col];
      list.splice(index == null ? list.length : Math.min(index, list.length), 0, id);
      changed(`${nameOf(id)} is in the ${COLS.find(([k]) => k === col)[1].toLowerCase()}`);
    }

    function toggleFold(id) {
      foldedSet.has(id) ? foldedSet.delete(id) : foldedSet.add(id);
      changed(`${nameOf(id)} ${foldedSet.has(id) ? "collapsed" : "expanded"}`);
    }

    // --- dragging by the handle ---
    let drag = null;
    function startDrag(e, id) {
      if (!arranging || e.button > 0) return;
      e.preventDefault();
      const panel = document.getElementById(id);
      panel.classList.add("dragging");
      drag = { id, pointer: e.pointerId };
      document.body.classList.add("arranging-drag");
      e.target.setPointerCapture(e.pointerId);
      e.target.addEventListener("pointermove", onMove);
      e.target.addEventListener("pointerup", onEnd, { once: true });
      e.target.addEventListener("pointercancel", onEnd, { once: true });
    }
    // Where the pointer is: which column, and before which panel in it.
    function dropAt(x, y) {
      for (const [k] of COLS) {
        const r = cols[k].getBoundingClientRect();
        // Empty columns are thin; give them a generous target.
        const pad = state[k].length ? 0 : 40;
        if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
        const others = state[k].filter((x2) => x2 !== drag.id);
        let index = others.length;
        for (let i = 0; i < others.length; i++) {
          const pr = document.getElementById(others[i]).getBoundingClientRect();
          if (y < pr.top + pr.height / 2) { index = i; break; }
        }
        return { col: k, index };
      }
      return null;
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pointer) return;
      const at = dropAt(e.clientX, e.clientY);
      if (!at) return;
      // Already there? (Its index in its column is also its index among the others.)
      if (at.col === colOf(drag.id) && at.index === state[at.col].indexOf(drag.id)) return;
      for (const [c] of COLS) state[c] = state[c].filter((x) => x !== drag.id);
      state[at.col].splice(at.index, 0, drag.id);
      apply();
    }
    function onEnd(e) {
      e.target.removeEventListener("pointermove", onMove);
      if (!drag) return;
      document.getElementById(drag.id).classList.remove("dragging");
      document.body.classList.remove("arranging-drag");
      const id = drag.id;
      drag = null;
      changed(`${nameOf(id)} is in the ${COLS.find(([k]) => k === colOf(id))[1].toLowerCase()}`);
    }

    function setArranging(on) {
      arranging = on;
      document.documentElement.dataset.arrange = on ? "on" : "off";
    }

    function reset() {
      state = clone(DEFAULT);
      foldedSet = new Set();
      changed("Panels back to the standard layout");
    }

    apply();
    return { setArranging, reset, get arranging() { return arranging; } };
  }

  root.Arrange = { create };
})(window);
