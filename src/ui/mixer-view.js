// The mixing desk: a channel strip per track (name, mute, solo, pan, a
// vertical fader and a meter) and a master strip. The faders are native
// range inputs turned upright, so arrow keys and screen readers work on
// them; each one speaks its value in decibels.
//
// Clicking a strip's name picks that track for the pattern grid, the synth
// panel and the keyboard.
(function (root) {
  "use strict";

  const fmtDb = (db, min, spoken) =>
    db <= min ? (spoken ? "off" : "−∞")
      : (db > 0 ? (spoken ? "plus " : "+") : db < 0 ? (spoken ? "minus " : "−") : "") +
        Math.abs(db).toFixed(1).replace(/\.0$/, "") + (spoken ? " decibels" : "");

  function fmtPan(v, spoken) {
    const n = Math.round(Math.abs(v) * 100);
    if (n === 0) return spoken ? "center" : "C";
    return spoken ? `${n} percent ${v < 0 ? "left" : "right"}` : `${v < 0 ? "L" : "R"}${n}`;
  }

  // handlers: { select(id), volume(id, db), pan(id, v), mute(id, on), solo(id, on), master(db) }
  function create(container, song, handlers) {
    const F = Song.FADER;
    const strips = {};

    function fader(id, label, value, onInput) {
      const wrap = document.createElement("div");
      wrap.className = "fader-wrap";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "fader";
      input.id = id;
      input.min = F.min; input.max = F.max; input.step = F.step;
      input.value = value;
      input.setAttribute("aria-label", label);
      input.setAttribute("aria-orientation", "vertical");
      const meter = document.createElement("canvas");
      meter.className = "strip-meter";
      meter.setAttribute("aria-hidden", "true");
      const out = document.createElement("output");
      out.htmlFor = id;
      out.className = "strip-db";
      out.setAttribute("aria-hidden", "true");
      const show = () => {
        const db = Number(input.value);
        out.textContent = fmtDb(db, F.min);
        input.setAttribute("aria-valuetext", fmtDb(db, F.min, true));
      };
      input.addEventListener("input", () => { show(); onInput(Number(input.value)); });
      // Double-click puts the fader back to 0 dB, like a desk's reset.
      input.addEventListener("dblclick", () => {
        input.value = F.def;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      show();
      const row = document.createElement("div");
      row.className = "fader-row";
      row.append(input, meter);
      wrap.append(row, out);
      return { wrap, input, meter, show };
    }

    function toggle(text, label, cls, onChange) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "strip-toggle " + cls;
      b.textContent = text;
      b.setAttribute("aria-label", label);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", String(on));
        onChange(on);
      });
      return b;
    }

    for (const t of song.tracks) {
      const s = document.createElement("div");
      s.className = "strip";
      s.setAttribute("role", "group");
      s.setAttribute("aria-label", t.name + " channel");

      const name = document.createElement("button");
      name.type = "button";
      name.className = "strip-name";
      name.textContent = t.name;
      name.setAttribute("aria-label", "Edit " + t.name);
      name.addEventListener("click", () => handlers.select(t.id));

      const sound = document.createElement("span");
      sound.className = "strip-sound";

      const ms = document.createElement("div");
      ms.className = "strip-ms";
      const mute = toggle("M", "Mute " + t.name, "mute", (on) => handlers.mute(t.id, on));
      const solo = toggle("S", "Solo " + t.name, "solo", (on) => handlers.solo(t.id, on));
      ms.append(mute, solo);

      const pan = document.createElement("input");
      pan.type = "range";
      pan.className = "pan";
      pan.min = -1; pan.max = 1; pan.step = 0.05;
      pan.value = t.pan;
      pan.setAttribute("aria-label", t.name + " pan");
      const panOut = document.createElement("span");
      panOut.className = "pan-out";
      panOut.setAttribute("aria-hidden", "true");
      const showPan = () => {
        panOut.textContent = fmtPan(Number(pan.value));
        pan.setAttribute("aria-valuetext", fmtPan(Number(pan.value), true));
      };
      pan.addEventListener("input", () => { showPan(); handlers.pan(t.id, Number(pan.value)); });
      pan.addEventListener("dblclick", () => { pan.value = 0; pan.dispatchEvent(new Event("input", { bubbles: true })); });
      showPan();

      const f = fader("fader-" + t.id, t.name + " volume", t.volume, (db) => handlers.volume(t.id, db));

      s.append(name, sound, ms, pan, panOut, f.wrap);
      container.append(s);
      strips[t.id] = { el: s, name, sound, mute, solo, pan, showPan, fader: f };
    }

    // Master strip
    const m = document.createElement("div");
    m.className = "strip master-strip";
    m.setAttribute("role", "group");
    m.setAttribute("aria-label", "Master channel");
    const mName = document.createElement("span");
    mName.className = "strip-name static";
    mName.textContent = "Master";
    const mf = fader("fader-master", "Master volume", song.master ?? F.def, (db) => handlers.master(db));
    m.append(mName, mf.wrap);
    container.append(m);

    // Brings the strips in line with the song (after a load or a selection).
    function refresh() {
      for (const t of song.tracks) {
        const s = strips[t.id];
        const sel = t.id === song.selected;
        s.el.classList.toggle("selected", sel);
        s.name.setAttribute("aria-pressed", String(sel));
        s.sound.textContent = (Presets.find(t.preset) || {}).name || "";
        s.mute.setAttribute("aria-pressed", String(t.mute));
        s.solo.setAttribute("aria-pressed", String(t.solo));
        s.pan.value = t.pan; s.showPan();
        s.fader.input.value = t.volume; s.fader.show();
      }
    }
    refresh();

    return {
      refresh,
      meter: (id) => (id === "master" ? mf.meter : strips[id].fader.meter),
    };
  }

  root.MixerView = { create };
})(window);
