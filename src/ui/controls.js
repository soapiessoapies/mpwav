// Builds the synth's control panel from Params.DEFS: a labelled slider for
// each number and a radio group for each choice, sorted into sections.
// Everything is a native form control, so it works with a keyboard and a
// screen reader as-is; sliders also carry their value as readable text
// ("4 kilohertz", not "612").
(function (root) {
  "use strict";

  const GROUPS = [
    { id: "osc", label: "Oscillator" },
    { id: "env", label: "Envelope" },
    { id: "filter", label: "Filter" },
    { id: "out", label: "Output" },
  ];

  // Arrow keys on a 0..STEPS slider move 1% (Shift: 0.1%), Page keys 10%.
  const KEY_STEPS = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10, PageUp: 100, PageDown: -100 };

  function build(container, { get, onChange }) {
    const views = {}; // id -> { input(s), output, def }

    // Stepped parameters (octave, tuning, volume) use their own range, so an
    // arrow press is one step; smooth ones use slider positions.
    const usesPos = (def) => !def.step;

    for (const g of GROUPS) {
      const fs = document.createElement("fieldset");
      fs.className = "group group-" + g.id;
      const lg = document.createElement("legend");
      lg.textContent = g.label;
      fs.append(lg);
      for (const def of Params.DEFS.filter((d) => d.group === g.id)) {
        fs.append(def.kind === "choice" ? choice(def) : slider(def));
      }
      container.append(fs);
    }

    function slider(def) {
      const wrap = document.createElement("div");
      wrap.className = "ctl";
      const id = "p-" + def.id;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = def.label;
      const out = document.createElement("output");
      out.htmlFor = id;
      out.setAttribute("aria-hidden", "true"); // the slider already speaks its value
      const input = document.createElement("input");
      input.type = "range";
      input.id = id;
      if (usesPos(def)) {
        input.min = 0; input.max = Params.STEPS; input.step = 1;
      } else {
        input.min = def.min; input.max = def.max; input.step = def.step;
      }
      const read = () => (usesPos(def) ? Params.fromPos(def, Number(input.value)) : Number(input.value));
      input.addEventListener("input", () => {
        const v = read();
        show(def.id, v);
        onChange(def.id, v);
      });
      if (usesPos(def)) {
        input.addEventListener("keydown", (e) => {
          let d = KEY_STEPS[e.key];
          if (d == null) return;
          if (e.shiftKey && Math.abs(d) === 10) d /= 10;
          e.preventDefault();
          input.value = String(Math.min(Params.STEPS, Math.max(0, Number(input.value) + d)));
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      // Double-click a slider to put it back to its default.
      input.addEventListener("dblclick", () => {
        input.value = String(usesPos(def) ? Params.toPos(def, def.def) : def.def);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const head = document.createElement("div");
      head.className = "ctl-head";
      head.append(label, out);
      wrap.append(head, input);
      views[def.id] = { def, input, out };
      return wrap;
    }

    function choice(def) {
      const fs = document.createElement("fieldset");
      fs.className = "ctl choice";
      const lg = document.createElement("legend");
      lg.textContent = def.label;
      const row = document.createElement("div");
      row.className = "seg";
      const inputs = [];
      for (const o of def.options) {
        const id = "p-" + def.id + "-" + o.id;
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "p-" + def.id;
        input.id = id;
        input.value = o.id;
        input.addEventListener("change", () => {
          if (!input.checked) return;
          onChange(def.id, o.id);
        });
        const label = document.createElement("label");
        label.htmlFor = id;
        label.textContent = o.label;
        if (o.spoken) label.setAttribute("aria-label", o.spoken);
        row.append(input, label);
        inputs.push(input);
      }
      fs.append(lg, row);
      views[def.id] = { def, inputs };
      return fs;
    }

    function show(id, value) {
      const v = views[id];
      if (v.out) {
        v.out.textContent = Params.format(v.def, value);
        v.input.setAttribute("aria-valuetext", Params.format(v.def, value, true));
      }
    }

    // Puts every control in line with a parameter set (after a preset loads).
    function refresh(params) {
      for (const id in views) {
        const v = views[id];
        const value = params[id];
        if (v.inputs) {
          for (const i of v.inputs) i.checked = i.value === value;
        } else {
          v.input.value = String(usesPos(v.def) ? Params.toPos(v.def, value) : value);
          show(id, value);
        }
      }
    }

    refresh(get());
    return { refresh };
  }

  root.Controls = { build };
})(window);
