// Chord buttons, after GarageBand's chord strips: one button per chord of
// the song's key (I ii iii IV V vi vii° in major), so a whole chord plays
// from one press. They go through the same path as the piano keys, so they
// sound on the selected track, record into the clip and work with step input.
//
// With no scale set (or a 5- or 6-note scale, which has no full set of
// triads) the chords come from the major scale on the song's root.
//
//   Chords.diatonic(root, scale)  [{ name, spoken, roman, root, intervals }]
//   Chords.voice(chord, around)   MIDI notes, the root near `around`
//   Chords.create(el, { getKey, around, onOn, onOff })
//                                 renders the buttons; .render() redraws them
(function (root) {
  "use strict";

  const Notes = root.Notes || (typeof require === "function" ? require("../audio/notes.js") : null);
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const MINOR = [0, 2, 3, 5, 7, 8, 10];
  const SEVEN = { major: MAJOR, minor: MINOR, dorian: [0, 2, 3, 5, 7, 9, 10] };
  const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
  const SPOKEN = ["C", "C sharp", "D", "D sharp", "E", "F", "F sharp", "G", "G sharp", "A", "A sharp", "B"];
  const TAP = 0.5; // seconds, for a chord activated without being held

  function quality(third, fifth) {
    if (third === 4 && fifth === 7) return { suffix: "", spoken: "major", upper: true, mark: "" };
    if (third === 3 && fifth === 7) return { suffix: "m", spoken: "minor", upper: false, mark: "" };
    if (third === 3 && fifth === 6) return { suffix: "dim", spoken: "diminished", upper: false, mark: "°" };
    return { suffix: "+", spoken: "augmented", upper: true, mark: "+" };
  }

  // The seven triads built on each degree of the scale (1-3-5 stacked in it).
  function diatonic(rootPc, scale) {
    const sc = SEVEN[scale] || (/minor|blues/.test(scale || "") ? MINOR : MAJOR);
    return sc.map((deg, i) => {
      const third = (sc[(i + 2) % 7] - deg + 12) % 12;
      const fifth = (sc[(i + 4) % 7] - deg + 12) % 12;
      const q = quality(third, fifth);
      const pc = (rootPc + deg) % 12;
      return {
        root: pc,
        intervals: [0, third, fifth],
        name: Notes.NAMES[pc] + q.suffix,
        spoken: SPOKEN[pc] + " " + q.spoken,
        roman: (q.upper ? NUMERALS[i].toUpperCase() : NUMERALS[i]) + q.mark,
      };
    });
  }

  // Root placed in the octave nearest `around`, the rest stacked above it.
  function voice(chord, around) {
    let r = around - Notes.pitchClass(around) + chord.root;
    if (r - around > 6) r -= 12;
    if (around - r > 6) r += 12;
    return chord.intervals.map((iv) => r + iv);
  }

  function create(el, { getKey, around, onOn, onOff }) {
    let chords = [];
    const held = new Map(); // button index -> notes sounding

    function on(i) {
      if (held.has(i)) return;
      const notes = voice(chords[i], around());
      held.set(i, notes);
      el.children[i]?.classList.add("lit");
      notes.forEach(onOn);
    }
    function off(i) {
      const notes = held.get(i);
      if (!notes) return;
      held.delete(i);
      el.children[i]?.classList.remove("lit");
      notes.forEach(onOff);
    }

    function render() {
      for (const i of [...held.keys()]) off(i);
      const k = getKey();
      chords = diatonic(k.root, k.scale);
      el.textContent = "";
      chords.forEach((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chord";
        b.setAttribute("aria-label", `${c.spoken} chord, ${c.roman}`);
        b.innerHTML = `<span class="chord-name"></span><span class="chord-roman" aria-hidden="true"></span>`;
        b.firstChild.textContent = c.name;
        b.lastChild.textContent = c.roman;
        b.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          try { b.setPointerCapture(e.pointerId); } catch (err) { /* no live pointer (synthetic): fine */ }
          b.dataset.pointer = "1";
          on(i);
        });
        const up = () => { if (b.dataset.pointer) { delete b.dataset.pointer; off(i); } };
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.repeat) { e.preventDefault(); on(i); }
        });
        b.addEventListener("keyup", (e) => { if (e.key === "Enter") off(i); });
        // A screen reader's "activate" (a click with no pointer or key held):
        // a short chord.
        b.addEventListener("click", (e) => {
          if (e.detail !== 0 || held.has(i)) return;
          on(i);
          setTimeout(() => off(i), TAP * 1000);
        });
        el.appendChild(b);
      });
    }

    render();
    return { render, releaseAll: () => { for (const i of [...held.keys()]) off(i); } };
  }

  const Chords = { diatonic, voice, create };
  if (typeof module !== "undefined" && module.exports) module.exports = Chords;
  else root.Chords = Chords;
})(typeof window !== "undefined" ? window : globalThis);
