// The song, laid out on a timeline like Ableton's arrangement view.
//
//   song.tracks[]    one synth sound each, with its mixer settings and its
//                    clips: { id, contentId, start, length } in bars
//   song.contents{}  what clips play: { id, trackId, name, bars, notes[] },
//                    a loop of `bars` bars; notes are { step, midi } with
//                    16 steps (sixteenths) to a bar. Clips that share a
//                    content are linked: edit one, they all change. A clip
//                    longer than its content repeats it.
//   song.loop        { on, start, end } in bars: the stretch Play repeats.
//                    With the loop off, Play runs from the cursor to the
//                    end of the song and stops.
//
// Plain data, so it saves as JSON and tests run in Node.
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const Params = node ? require("../audio/params.js") : root.Params;
  const Presets = node ? require("./presets.js") : root.Presets;

  const VERSION = 3;
  const STEPS = 16; // per bar (sixteenth notes)
  const MIN_VIEW = 8; // the timeline always shows at least this many bars
  const SPARE = 2;    // ...and this many empty ones after the last clip
  const CONTENT_BARS = [1, 2, 4];
  const BPM = { min: 40, max: 240, def: 110 };
  const FADER = { min: -48, max: 6, step: 0.5, def: 0 }; // dB; the bottom is off
  const LOWEST = 24, HIGHEST = 108; // C1..C8, the range notes and grid rows can use
  const LENGTHS = [1, 2, 4, 8, 16]; // how many steps each note lasts
  const COLORS = ["orange", "mint", "sky", "violet", "rose", "lime", "gold", "coral"];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const int = (v, d) => (Number.isInteger(v) ? v : d);

  function createTrack({ id, name, preset, color, gridBase = 60, length = 1 }) {
    return {
      id, name, preset, color,
      params: Params.sanitize(Presets.find(preset).params),
      clips: [], // { id, contentId, start, length } in bars, sorted by start, never overlapping
      gridBase,  // lowest row shown in the clip editor (a C)
      length,    // steps each note lasts
      morph: { x: 0, y: 0 }, // the morph pad's point, -1..1 each way (0, 0 changes nothing)
      volume: FADER.def,
      pan: 0,
      mute: false,
      solo: false,
    };
  }

  const DEFAULT_TRACKS = [
    { id: "lead", name: "Lead", preset: "chip-lead", color: "orange", gridBase: 60 },
    { id: "bass", name: "Bass", preset: "chip-bass", color: "mint", gridBase: 48, length: 2 },
    { id: "pad", name: "Pad", preset: "warm-pad", color: "violet", gridBase: 60, length: 8 },
    { id: "hat", name: "Hat", preset: "noise-hat", color: "sky", gridBase: 60 },
  ];

  function createSong() {
    return {
      version: VERSION,
      title: "Untitled song",
      bpm: BPM.def,
      master: -4, // master fader, dB
      tracks: DEFAULT_TRACKS.map(createTrack),
      contents: {},
      selected: DEFAULT_TRACKS[0].id,
      cursor: 0, // bar Play starts from when the loop is off
      loop: { on: true, start: 0, end: 4 },
      nextId: 1,
    };
  }

  const newId = (song, prefix) => prefix + song.nextId++;
  const track = (song, id) => song.tracks.find((t) => t.id === id) || song.tracks[0];
  const content = (song, clip) => song.contents[clip.contentId];
  const clipEnd = (c) => c.start + c.length;

  function makeContent(song, trackId, name, bars = 1, notes = []) {
    const id = newId(song, "n");
    song.contents[id] = { id, trackId, name, bars, notes };
    return song.contents[id];
  }

  // The next free name for a track's clips: "Lead 1", "Lead 2"...
  function nextName(song, t) {
    const used = new Set(Object.values(song.contents).filter((c) => c.trackId === t.id).map((c) => c.name));
    let i = 1;
    while (used.has(`${t.name} ${i}`)) i++;
    return `${t.name} ${i}`;
  }

  // --- clips on a track ---
  const clipAt = (t, bar) => t.clips.find((c) => bar >= c.start && bar < clipEnd(c)) || null;
  const sortClips = (t) => t.clips.sort((a, b) => a.start - b.start);

  // Is [start, start + length) clear of the track's other clips?
  function fits(t, start, length, ignore) {
    if (start < 0 || length < 1) return false;
    return t.clips.every((c) => c === ignore || clipEnd(c) <= start || c.start >= start + length);
  }

  // A new clip in empty space. Its content is new unless one is given (a
  // linked copy). Returns the clip, or null if something is in the way.
  function addClip(song, t, start, length, contentId) {
    let c = contentId && song.contents[contentId];
    if (!c) {
      // A new clip loops the biggest content that fits it: 1, 2 or 4 bars.
      const bars = [...CONTENT_BARS].reverse().find((b) => b <= (length || 1));
      c = makeContent(song, t.id, nextName(song, t), bars);
    }
    length = length || c.bars;
    if (!fits(t, start, length)) return null;
    const clip = { id: newId(song, "c"), contentId: c.id, start, length };
    t.clips.push(clip);
    sortClips(t);
    return clip;
  }

  // Moves a clip as far toward `start` as it can go without overlapping.
  function moveClip(t, clip, start) {
    start = Math.max(0, start);
    const step = start > clip.start ? 1 : -1;
    let at = clip.start;
    while (at !== start && fits(t, at + step, clip.length, clip)) at += step;
    clip.start = at;
    sortClips(t);
    return at;
  }

  // Stretches (or shortens) a clip from its right edge, stopping at the next clip.
  function resizeClip(t, clip, length) {
    length = Math.max(1, length);
    let len = clip.length;
    const step = length > len ? 1 : -1;
    while (len !== length && fits(t, clip.start, len + step, clip)) len += step;
    clip.length = len;
    return len;
  }

  // Removes a clip; its content goes too once no clip uses it.
  function removeClip(song, t, clip) {
    t.clips = t.clips.filter((c) => c !== clip);
    const stillUsed = song.tracks.some((x) => x.clips.some((c) => c.contentId === clip.contentId));
    if (!stillUsed) delete song.contents[clip.contentId];
  }

  const linkCount = (song, contentId) =>
    song.tracks.reduce((n, t) => n + t.clips.filter((c) => c.contentId === contentId).length, 0);

  // --- notes in a clip's content ---
  const hasNote = (c, step, midi) => c.notes.some((n) => n.step === step && n.midi === midi);
  const notesAt = (c, step) => c.notes.filter((n) => n.step === step).map((n) => n.midi);

  // Adds the note if it isn't there, removes it if it is. Returns whether it's on now.
  function toggleNote(c, step, midi) {
    const i = c.notes.findIndex((n) => n.step === step && n.midi === midi);
    if (i >= 0) { c.notes.splice(i, 1); return false; }
    c.notes.push({ step, midi });
    return true;
  }

  // Adds a note unless it's already there (recording). Returns whether it was added.
  function addNote(c, step, midi) {
    if (hasNote(c, step, midi)) return false;
    c.notes.push({ step, midi });
    return true;
  }

  // Takes notes back out (undoing a recorded take).
  function removeNotes(c, notes) {
    c.notes = c.notes.filter((n) => !notes.some((m) => m.step === n.step && m.midi === n.midi));
  }

  // Changes how many bars a content loops; notes past the new end are dropped.
  function setContentBars(c, bars) {
    c.bars = bars;
    c.notes = c.notes.filter((n) => n.step < bars * STEPS);
  }

  // --- playing ---
  // Where in a clip's content an absolute step (from the song's start) falls.
  function localStep(song, clip, pos) {
    const c = content(song, clip);
    return (pos - clip.start * STEPS) % (c.bars * STEPS);
  }

  // The notes a track plays at an absolute step: its clip there, if any.
  function notesAtPos(song, t, pos) {
    const clip = clipAt(t, Math.floor(pos / STEPS));
    return clip ? notesAt(content(song, clip), localStep(song, clip, pos)) : [];
  }

  // How long the song is: to the end of its last clip.
  function songBars(song) {
    return song.tracks.reduce((m, t) => Math.max(m, ...t.clips.map(clipEnd)), 0);
  }

  // How many bars the timeline shows: it grows as clips are added.
  const viewBars = (song) => Math.max(MIN_VIEW, songBars(song) + SPARE, song.loop.end, song.cursor + 1);

  // The bars Play covers: the loop, or the cursor to the end of the song.
  function playRange(song) {
    if (song.loop.on) return { start: song.loop.start, end: song.loop.end, repeat: true };
    return { start: song.cursor, end: Math.max(songBars(song), song.cursor + 1), repeat: false };
  }

  // Tracks you can hear: if anything is soloed, only the soloed ones;
  // otherwise everything that isn't muted.
  function audible(song) {
    const anySolo = song.tracks.some((t) => t.solo);
    return song.tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  }

  // A starter song: an 8-bar arrangement where every clip repeats a short
  // loop, and the hats switch to a busier clip halfway.
  function demoSong() {
    const s = createSong();
    const t = (id) => s.tracks.find((x) => x.id === id);
    const notes = (list) => list.map(([step, midi]) => ({ step, midi }));
    const lead = makeContent(s, "lead", "Lead riff", 1, notes([[0, 72], [2, 67], [4, 69], [6, 72], [8, 71], [10, 72], [12, 69], [14, 67]]));
    const bass = makeContent(s, "bass", "Bass line", 1, notes([[0, 48], [3, 48], [6, 55], [8, 53], [11, 53], [14, 55]]));
    const pad = makeContent(s, "pad", "Chords", 1, notes([[0, 60], [0, 64], [0, 67], [8, 57], [8, 60], [8, 64]]));
    const hat = makeContent(s, "hat", "Hats", 1, notes([0, 2, 4, 6, 8, 10, 12, 14].map((st) => [st, 72])));
    const hats16 = makeContent(s, "hat", "Hats busy", 1, notes([...Array(16).keys()].map((st) => [st, 72])));
    addClip(s, t("lead"), 0, 8, lead.id);
    addClip(s, t("bass"), 0, 8, bass.id);
    addClip(s, t("pad"), 0, 8, pad.id);
    addClip(s, t("hat"), 0, 4, hat.id);
    addClip(s, t("hat"), 4, 4, hats16.id);
    t("lead").volume = -3;
    t("pad").volume = -6;
    s.loop = { on: true, start: 0, end: 8 };
    return s;
  }

  function cleanNotes(list, bars) {
    return (Array.isArray(list) ? list : [])
      .filter((n) => n && Number.isInteger(n.step) && Number.isInteger(n.midi))
      .filter((n) => n.step >= 0 && n.step < bars * STEPS && n.midi >= LOWEST && n.midi <= HIGHEST)
      .filter((n, i, all) => all.findIndex((m) => m.step === n.step && m.midi === n.midi) === i)
      .map((n) => ({ step: n.step, midi: n.midi }));
  }

  // Older saves (before the timeline) had per-track patterns A-D and a
  // 16-bar arrangement, or before that a single `notes` list. Runs of the
  // same pattern become one clip; every clip of a pattern shares (links to)
  // one content, so the song sounds the same as before.
  function migrate(out, s, t) {
    const patterns = s.patterns && typeof s.patterns === "object" ? s.patterns : { A: s.notes };
    const made = {};
    const contentFor = (slot) => {
      if (!made[slot]) made[slot] = makeContent(out, t.id, `${t.name} ${slot}`, 1, cleanNotes(patterns[slot], 1));
      return made[slot];
    };
    const arrange = Array.isArray(s.arrange) ? s.arrange : [];
    for (let bar = 0; bar < arrange.length; ) {
      const slot = arrange[bar];
      if (!["A", "B", "C", "D"].includes(slot)) { bar++; continue; }
      let end = bar + 1;
      while (arrange[end] === slot) end++;
      addClip(out, t, bar, end - bar, contentFor(slot).id);
      bar = end;
    }
    // A pattern that was only ever looped (never arranged) still deserves a clip.
    if (!t.clips.length) {
      const slot = ["A", "B", "C", "D"].includes(s.slot) ? s.slot : "A";
      if (cleanNotes(patterns[slot], 1).length) addClip(out, t, 0, 1, contentFor(slot).id);
    }
  }

  // A valid song from anything (a save from an older version, junk):
  // known tracks keep what they had, missing pieces come from the defaults.
  function sanitize(input) {
    const out = createSong();
    if (!input || typeof input !== "object") return out;
    if (typeof input.title === "string" && input.title.trim()) out.title = input.title.trim().slice(0, 80);
    out.master = clamp(Math.round(num(input.master, out.master) / FADER.step) * FADER.step, FADER.min, FADER.max);
    out.bpm = Math.round(clamp(num(input.bpm, BPM.def), BPM.min, BPM.max));
    out.nextId = Math.max(1, int(input.nextId, 1));
    const saved = Array.isArray(input.tracks) ? input.tracks : [];
    const v3 = input.version === VERSION && input.contents && typeof input.contents === "object";

    if (v3) {
      for (const [id, c] of Object.entries(input.contents)) {
        if (!c || !out.tracks.some((t) => t.id === c.trackId)) continue;
        const bars = CONTENT_BARS.includes(c.bars) ? c.bars : 1;
        out.contents[id] = {
          id, trackId: c.trackId, bars,
          name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 40) : "Clip",
          notes: cleanNotes(c.notes, bars),
        };
      }
    }

    for (const t of out.tracks) {
      const s = saved.find((x) => x && x.id === t.id);
      if (!s) continue;
      if (Presets.find(s.preset)) t.preset = s.preset;
      if (COLORS.includes(s.color)) t.color = s.color;
      t.params = Params.sanitize(s.params || Presets.find(t.preset).params);
      const base = num(s.gridBase, t.gridBase);
      t.gridBase = clamp(base - (((base % 12) + 12) % 12), LOWEST, HIGHEST - 12);
      if (LENGTHS.includes(s.length)) t.length = s.length;
      if (s.morph && typeof s.morph === "object") {
        t.morph = { x: clamp(num(s.morph.x, 0), -1, 1), y: clamp(num(s.morph.y, 0), -1, 1) };
      }
      t.volume = clamp(Math.round(num(s.volume, FADER.def) / FADER.step) * FADER.step, FADER.min, FADER.max);
      t.pan = clamp(num(s.pan, 0), -1, 1);
      t.mute = s.mute === true;
      t.solo = s.solo === true;

      if (v3) {
        const clips = (Array.isArray(s.clips) ? s.clips : [])
          .filter((c) => c && out.contents[c.contentId] && out.contents[c.contentId].trackId === t.id)
          .map((c) => ({ id: typeof c.id === "string" ? c.id : newId(out, "c"), contentId: c.contentId, start: int(c.start, -1), length: int(c.length, 0) }))
          .filter((c) => c.start >= 0 && c.length >= 1)
          .sort((a, b) => a.start - b.start);
        for (const c of clips) if (fits(t, c.start, c.length)) t.clips.push(c); // overlaps dropped
      } else {
        migrate(out, s, t);
      }
    }

    // Contents no clip uses would linger unseen; drop them.
    for (const id of Object.keys(out.contents)) if (!linkCount(out, id)) delete out.contents[id];

    if (out.tracks.some((t) => t.id === input.selected)) out.selected = input.selected;
    out.cursor = Math.max(0, int(input.cursor, 0));
    const lp = input.loop && typeof input.loop === "object" ? input.loop : null;
    if (lp && int(lp.start, -1) >= 0 && int(lp.end, -1) > lp.start) {
      out.loop = { on: lp.on !== false, start: lp.start, end: lp.end };
    } else if (!v3) {
      out.loop = { on: true, start: 0, end: Math.max(1, songBars(out)) };
    }
    return out;
  }

  const api = {
    VERSION, STEPS, MIN_VIEW, CONTENT_BARS, BPM, FADER, LOWEST, HIGHEST, LENGTHS, COLORS,
    createSong, demoSong, sanitize, track, content, clipEnd, clipAt, fits,
    addClip, moveClip, resizeClip, removeClip, linkCount, makeContent, nextName,
    hasNote, notesAt, toggleNote, addNote, removeNotes, setContentBars,
    localStep, notesAtPos, songBars, viewBars, playRange, audible,
  };
  if (node) module.exports = api;
  else root.Song = api;
})(typeof window !== "undefined" ? window : globalThis);
