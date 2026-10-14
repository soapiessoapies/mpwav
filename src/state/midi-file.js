// Exports a song's notes as a Standard MIDI File (.mid, type 1), which
// every music app and notation program opens: one MIDI track per mpwav
// track, plus a first track with the tempo (and every tempo change and
// ramp) and the time signature. Drum tracks go on channel 10, the General
// MIDI drum channel, with the hits on their General MIDI notes. Audio
// tracks hold sound files, not notes, so they're left out.
//
// Notes keep their bar, step, length and loudness; swing isn't written
// (other apps have their own), and nor are the notes' own effects.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Song = node ? require("./song.js") : root.Song;

  const PPQ = 96;                    // ticks per quarter note
  const TICKS = PPQ / 4;             // per step (a sixteenth)
  // Channels for pitched tracks: all but 10 (index 9), which is for drums.
  const MELODIC = [...Array(16).keys()].filter((c) => c !== 9);

  function vlq(n) {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  }
  const text = (s) => Array.from(new TextEncoder().encode(s.slice(0, 120)));

  // A track chunk from [tick, bytes] events, in time order.
  function chunk(events) {
    events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    const body = [];
    let last = 0;
    for (const [tick, bytes] of events) {
      body.push(...vlq(tick - last), ...bytes);
      last = tick;
    }
    body.push(0, 0xff, 0x2f, 0x00); // end of track
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
  }
  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];

  // Bars [from, to) of the song (the whole song by default).
  function encode(song, { from = 0, to = Song.songBars(song) } = {}) {
    const steps = Math.max(0, (to - from) * Song.STEPS);
    // The conductor track: name, 4/4, and a tempo event wherever the tempo
    // changes (every step through a ramp).
    const conductor = [[0, [0xff, 0x03, ...vlq(text(song.title || "mpwav song").length), ...text(song.title || "mpwav song")], 0], [0, [0xff, 0x58, 0x04, 4, 2, 24, 8], 0]];
    let lastBpm = null;
    for (let i = 0; i < Math.max(1, steps); i++) {
      const bpm = Math.round(Song.bpmAt(song, from * Song.STEPS + i) * 100) / 100;
      if (bpm === lastBpm) continue;
      lastBpm = bpm;
      const us = Math.round(60000000 / bpm);
      conductor.push([i * TICKS, [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff], 0]);
    }
    const chunks = [chunk(conductor)];
    let channel = 0;
    for (const t of song.tracks) {
      if (t.kind === "audio") continue;
      const ch = t.kind === "drums" ? 9 : MELODIC[channel++ % MELODIC.length];
      const name = text(t.name || t.id);
      const events = [[0, [0xff, 0x03, ...vlq(name.length), ...name], 0]];
      for (let i = 0; i < steps; i++) {
        for (const n of Song.notesAtPos(song, t, from * Song.STEPS + i)) {
          const vel = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.85 : n.vel) * 127)));
          const end = Math.min(steps, i + Math.max(1, n.len || 1));
          events.push([i * TICKS, [0x90 | ch, n.midi & 0x7f, vel], 1]);
          events.push([end * TICKS, [0x80 | ch, n.midi & 0x7f, 0], 0]); // offs before ons at the same tick
        }
      }
      chunks.push(chunk(events));
    }
    const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
    return new Uint8Array([...header, ...chunks.flat()]);
  }

  const api = { encode, PPQ };
  if (node) module.exports = api;
  else root.MidiFile = api;
})(typeof window !== "undefined" ? window : globalThis);
