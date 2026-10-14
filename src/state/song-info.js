// A plain-text summary of a song (like a DAW's "Session info as text"):
// its length and running time, tempo and tempo changes, key, every track
// with its sound and mix settings, and every clip by bar. Handy for notes,
// a class write-up, or checking a song file without opening it.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Song = node ? require("./song.js") : root.Song;
  const Notes = node ? require("../audio/notes.js") : root.Notes;

  const SCALE_NAMES = { none: "no scale", major: "major", minor: "minor", "pentatonic-major": "major pentatonic", "pentatonic-minor": "minor pentatonic", blues: "blues", dorian: "Dorian", mixolydian: "Mixolydian" };

  function seconds(song, bars) {
    let s = 0;
    for (let i = 0; i < bars * Song.STEPS; i++) s += Song.stepSeconds(song, i);
    return s;
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const db = (v) => (v <= Song.FADER.min ? "off" : `${v > 0 ? "+" : ""}${v} dB`);
  const pan = (p) => (!p ? "centre" : `${Math.round(Math.abs(p) * 100)}% ${p < 0 ? "left" : "right"}`);

  function text(song, { date = new Date() } = {}) {
    const bars = Song.songBars(song);
    const lines = [];
    lines.push(song.title || "mpwav song");
    lines.push("=".repeat(Math.min(60, (song.title || "mpwav song").length)));
    lines.push(`Exported from mpwav on ${date.toISOString().slice(0, 10)}`);
    lines.push("");
    lines.push(`Length: ${bars} bar${bars === 1 ? "" : "s"} of 4/4, ${clock(seconds(song, bars))}`);
    lines.push(`Tempo: ${song.bpm} BPM${song.tempos && song.tempos.length ? "" : " throughout"}`);
    for (const t of song.tempos || []) lines.push(`  bar ${t.bar + 1}: ${t.ramp ? "ramps to" : "changes to"} ${t.bpm} BPM`);
    if (song.key) lines.push(`Key: ${Notes.NAMES[song.key.root % 12]} ${SCALE_NAMES[song.key.scale] || song.key.scale}`);
    if (song.swing) lines.push(`Swing: ${Math.round(song.swing * 100)}%`);
    lines.push(`Master: ${db(song.master || 0)}`);
    if (song.loop && song.loop.on) lines.push(`Loop: bars ${song.loop.start + 1} to ${song.loop.end}`);
    lines.push("");
    lines.push(`Tracks (${song.tracks.length})`);
    for (const t of song.tracks) {
      const kind = t.kind === "audio" ? "audio" : t.kind === "drums" ? "drums" : "synth";
      const sound = t.kind === "audio" ? "sound files" : t.sampler ? "a sound file played by key" : t.preset;
      const flags = [t.mute && "muted", t.solo && "soloed"].filter(Boolean).join(", ");
      lines.push(`- ${t.name} (${kind}, ${sound}): ${db(t.volume)}, pan ${pan(t.pan)}${flags ? `, ${flags}` : ""}`);
      for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
        const content = Song.content(song, c) || {};
        const what = content.audio ? "audio" : `${(content.notes || []).length} note${(content.notes || []).length === 1 ? "" : "s"}`;
        lines.push(`    bars ${c.start + 1}-${c.start + c.length}: ${content.name || "clip"} (${what}${content.bars && c.length > content.bars ? `, a ${content.bars}-bar loop repeated` : ""})`);
      }
      if (!t.clips.length) lines.push("    no clips");
    }
    return lines.join("\n") + "\n";
  }

  const api = { text, seconds };
  if (node) module.exports = api;
  else root.SongInfo = api;
})(typeof window !== "undefined" ? window : globalThis);
