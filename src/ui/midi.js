// A MIDI keyboard as another way to play: its keys go through the same
// noteOn/noteOff as the on-screen and computer keys (so they record, step
// input and sound on the selected track). Off until turned on in Settings ›
// Keyboard, because the browser asks permission the first time.
//
//   Midi.supported               whether this browser has Web MIDI
//   Midi.parse(bytes)            { type: "on" | "off", note, velocity } or null
//   Midi.connect({ onOn, onOff, onStatus })  asks for access, listens to every
//                                input (and ones plugged in later); resolves
//                                to { inputs, stop() }, or rejects if refused
(function (root) {
  "use strict";

  const supported = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";

  function parse(data) {
    if (!data || data.length < 3) return null;
    const kind = data[0] & 0xf0;
    const note = data[1];
    const velocity = data[2];
    if (kind === 0x90 && velocity > 0) return { type: "on", note, velocity };
    if (kind === 0x80 || (kind === 0x90 && velocity === 0)) return { type: "off", note, velocity };
    return null;
  }

  async function connect({ onOn, onOff, onStatus }) {
    const access = await navigator.requestMIDIAccess();
    const held = new Set();
    const listen = (input) => {
      input.onmidimessage = (e) => {
        const m = parse(e.data);
        if (!m) return;
        if (m.type === "on") { held.add(m.note); onOn(m.note, m.velocity); }
        else if (held.delete(m.note)) onOff(m.note);
      };
    };
    const names = () => Array.from(access.inputs.values()).map((i) => i.name || "MIDI keyboard");
    access.inputs.forEach(listen);
    access.onstatechange = (e) => {
      if (e.port.type === "input" && e.port.state === "connected") listen(e.port);
      if (onStatus) onStatus(names());
    };
    if (onStatus) onStatus(names());
    return {
      get inputs() { return names(); },
      stop() {
        access.inputs.forEach((i) => { i.onmidimessage = null; });
        access.onstatechange = null;
        for (const n of held) onOff(n);
        held.clear();
      },
    };
  }

  const Midi = { supported, parse, connect };
  if (typeof module !== "undefined" && module.exports) module.exports = Midi;
  else root.Midi = Midi;
})(typeof window !== "undefined" ? window : globalThis);
