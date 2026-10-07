// Keeps track of which notes are sounding, so the synth knows what to release
// and what to cut when it runs out of voices. Pure bookkeeping: the synth hands
// in its voice objects and does the actual stopping.
(function (root) {
  "use strict";

  function createPool(max) {
    let order = 0;
    const voices = []; // { midi, held, order, voice }

    // Makes room for a new note. Returns what the synth must do first:
    // `release` (the same note still held, so it retriggers) and `cut`
    // (oldest voices dropped to stay under the limit; released tails go first).
    function add(midi, voice) {
      const release = [];
      const cut = [];
      for (const v of voices) {
        if (v.held && v.midi === midi) { v.held = false; release.push(v.voice); }
      }
      while (voices.length >= max) {
        let i = voices.findIndex((v) => !v.held);
        if (i < 0) i = 0;
        cut.push(voices.splice(i, 1)[0].voice);
      }
      voices.push({ midi, held: true, order: order++, voice });
      return { release, cut };
    }

    // The held voice playing this note, now marked released (or null).
    function release(midi) {
      const v = voices.find((x) => x.held && x.midi === midi);
      if (!v) return null;
      v.held = false;
      return v.voice;
    }

    // Marks this particular voice released (the sequencer holds on to the
    // voices it started, so it never lets go of a note someone is playing).
    function releaseVoice(voice) {
      const v = voices.find((x) => x.voice === voice && x.held);
      if (!v) return false;
      v.held = false;
      return true;
    }

    // Forget a voice once it has finished sounding.
    function remove(voice) {
      const i = voices.findIndex((v) => v.voice === voice);
      if (i >= 0) voices.splice(i, 1);
    }

    const held = () => voices.filter((v) => v.held).map((v) => v.midi);
    const all = () => voices.map((v) => v.voice);
    const size = () => voices.length;

    return { add, release, releaseVoice, remove, held, all, size };
  }

  const api = { createPool };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Voices = api;
})(typeof window !== "undefined" ? window : globalThis);
