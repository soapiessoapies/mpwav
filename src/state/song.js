// The song, laid out on a timeline like Ableton's arrangement view.
//
//   song.tracks[]    one synth sound each, with its mixer settings and its
//                    clips: { id, contentId, start, length, offset } in bars;
//                    `offset` is how far into its content a clip begins (a
//                    clip split in two keeps playing where it was)
//   song.contents{}  what clips play: { id, trackId, name, bars, notes[] },
//                    a loop of `bars` bars; notes are { step, midi, len, vel }:
//                    where it starts (16 steps, sixteenths, to a bar), its
//                    pitch, how many steps it lasts and how loud (0..1). Clips that share a
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
  const LENGTHS = [1, 2, 4, 8, 16]; // lengths offered for new notes, in steps
  const VEL = 0.85; // a new note's loudness
  const COLORS = ["orange", "mint", "sky", "violet", "rose", "lime", "gold", "coral"];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const int = (v, d) => (Number.isInteger(v) ? v : d);

  function createTrack({ id, name, preset, color, gridBase = 60, length = 1 }) {
    return {
      id, name, preset, color,
      params: Params.sanitize(Presets.find(preset).params),
      clips: [], // { id, contentId, start, length, offset } in bars, sorted by start, never overlapping
      gridBase,  // lowest row shown in the clip editor (a C)
      length,    // steps a new note lasts
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
    const clip = { id: newId(song, "c"), contentId: c.id, start, length, offset: 0 };
    t.clips.push(clip);
    sortClips(t);
    return clip;
  }

  // The first bar at or after `bar` where `length` bars are free on a track.
  function freeBar(t, bar, length) {
    while (!fits(t, bar, length)) bar++;
    return bar;
  }

  // A content of its own with the same notes (for copies that aren't linked).
  function cloneContent(song, c, name) {
    return makeContent(song, c.trackId, name || nextName(song, Song_track(song, c.trackId)), c.bars,
      c.notes.map((n) => ({ ...n })));
  }

  // A copy of a clip right after it (or the next free space): linked shares
  // its notes with the original, otherwise it gets its own copy of them.
  function duplicateClip(song, t, clip, linked) {
    const c = content(song, clip);
    const target = linked ? c : cloneContent(song, c, c.name + " copy");
    const at = freeBar(t, clipEnd(clip), clip.length);
    const copy = addClip(song, t, at, clip.length, target.id);
    copy.offset = clip.offset;
    return copy;
  }

  // What a copied clip carries: its notes, so it pastes as an independent clip.
  function copyClip(song, clip) {
    const c = content(song, clip);
    return { kind: "clip", name: c.name, bars: c.bars, notes: c.notes.map((n) => ({ ...n })), length: clip.length, offset: clip.offset };
  }

  // Pastes a copied clip onto a track at the first free space from `bar`.
  function pasteClip(song, t, data, bar) {
    const c = makeContent(song, t.id, data.name + (Object.values(song.contents).some((x) => x.trackId === t.id && x.name === data.name) ? " copy" : ""),
      data.bars, data.notes.map((n) => ({ ...n })));
    const clip = addClip(song, t, freeBar(t, bar, data.length), data.length, c.id);
    clip.offset = data.offset % data.bars;
    return clip;
  }

  // Cuts a clip in two at `bar` (inside it). The right half plays on from
  // the same point in the loop. Returns the right half.
  function splitClip(song, t, clip, bar) {
    if (bar <= clip.start || bar >= clipEnd(clip)) return null;
    const right = { id: newId(song, "c"), contentId: clip.contentId, start: bar, length: clipEnd(clip) - bar,
      offset: (clip.offset + bar - clip.start) % content(song, clip).bars };
    clip.length = bar - clip.start;
    t.clips.push(right);
    sortClips(t);
    return right;
  }

  // --- sections: bars across every track ---
  // Inserts `n` empty bars at `bar`, splitting any clip that crosses it.
  function insertBars(song, bar, n) {
    for (const t of song.tracks) {
      const crossing = clipAt(t, bar);
      if (crossing && crossing.start < bar) splitClip(song, t, crossing, bar);
      for (const c of t.clips) if (c.start >= bar) c.start += n;
    }
    shiftMarks(song, bar, n);
  }

  // Removes bars [start, end) from every track; what comes after moves left.
  function deleteBars(song, start, end) {
    const n = end - start;
    for (const t of song.tracks) {
      for (const at of [start, end]) {
        const c = clipAt(t, at);
        if (c && c.start < at) splitClip(song, t, c, at);
      }
      for (const c of t.clips.filter((x) => x.start >= start && x.start < end)) removeClip(song, t, c);
      for (const c of t.clips) if (c.start >= end) c.start -= n;
    }
    const wasLoop = song.loop.start === start && song.loop.end === end;
    shiftMarks(song, end, -n, start);
    // Deleting the loop's own bars: keep a loop of the same length where the music now is.
    if (wasLoop) song.loop.end = start + Math.max(1, Math.min(n, songBars(song) - start));
  }

  // Duplicates bars [start, end) right after themselves, on every track.
  // The copies get their own notes (copies of the same content stay linked
  // to each other, as they were in the original).
  function duplicateBars(song, start, end) {
    const n = end - start;
    const pieces = [];
    for (const t of song.tracks) {
      for (const at of [start, end]) {
        const c = clipAt(t, at);
        if (c && c.start < at) splitClip(song, t, c, at);
      }
      for (const c of t.clips) if (c.start >= start && c.start < end) pieces.push({ t, c: { ...c } });
    }
    insertBars(song, end, n);
    const made = {};
    for (const { t, c } of pieces) {
      if (!made[c.contentId]) made[c.contentId] = cloneContent(song, song.contents[c.contentId], song.contents[c.contentId].name + " copy");
      const copy = addClip(song, t, c.start + n, c.length, made[c.contentId].id);
      copy.offset = c.offset;
    }
  }

  // Keeps the cursor and loop on the same music when bars are added (n > 0)
  // or taken away (n < 0) at bar `at`. A loop that ends exactly where bars
  // are added stays as it was (it doesn't swallow the new bars).
  function shiftMarks(song, at, n, floor = 0) {
    const move = (b) => (b >= at ? Math.max(floor, b + n) : b);
    const moveEnd = (b) => (b > at ? Math.max(floor, b + n) : b);
    song.cursor = move(song.cursor);
    const start = move(song.loop.start);
    song.loop.end = Math.max(start + 1, n > 0 ? moveEnd(song.loop.end) : move(song.loop.end));
    song.loop.start = start;
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

  const Song_track = (song, id) => song.tracks.find((t) => t.id === id);

  const linkCount = (song, contentId) =>
    song.tracks.reduce((n, t) => n + t.clips.filter((c) => c.contentId === contentId).length, 0);

  // --- notes in a clip's content ---
  const loopSteps = (c) => c.bars * STEPS;
  // The note that starts at this step and pitch (only one may).
  const noteStarting = (c, step, midi) => c.notes.find((n) => n.step === step && n.midi === midi) || null;
  const hasNote = (c, step, midi) => !!noteStarting(c, step, midi);
  // The note sounding at this step and pitch: it may have started earlier.
  const noteAt = (c, step, midi) => c.notes.find((n) => n.midi === midi && step >= n.step && step < n.step + n.len) || null;
  // Notes that start at a step.
  const notesAt = (c, step) => c.notes.filter((n) => n.step === step);

  // Adds a note unless one already starts there. Returns it, or null.
  function addNote(c, step, midi, len = 1, vel = VEL) {
    if (step < 0 || step >= loopSteps(c) || hasNote(c, step, midi)) return null;
    const n = { step, midi, len: Math.max(1, Math.min(len, loopSteps(c) - step)), vel };
    c.notes.push(n);
    return n;
  }

  // Removes the note sounding there if there is one, else adds one.
  // Returns whether a note is there now.
  function toggleNote(c, step, midi, len = 1) {
    const n = noteAt(c, step, midi);
    if (n) { c.notes.splice(c.notes.indexOf(n), 1); return false; }
    return !!addNote(c, step, midi, len);
  }

  // Takes notes back out (deleting, or undoing a recorded take).
  function removeNotes(c, notes) {
    c.notes = c.notes.filter((n) => !notes.some((m) => m === n || (m.step === n.step && m.midi === n.midi)));
  }

  // Moves a note, kept inside the loop and the playable range. It won't land
  // where another note already starts. Returns whether it moved.
  function moveNote(c, n, step, midi) {
    step = Math.max(0, Math.min(step, loopSteps(c) - n.len));
    midi = Math.max(LOWEST, Math.min(HIGHEST, midi));
    if (step === n.step && midi === n.midi) return false;
    const other = noteStarting(c, step, midi);
    if (other && other !== n) return false;
    n.step = step;
    n.midi = midi;
    return true;
  }

  // Stretches or shortens a note: at least a step, no further than the loop's end.
  function resizeNote(c, n, len) {
    n.len = Math.max(1, Math.min(Math.round(len), loopSteps(c) - n.step));
    return n.len;
  }

  // Copied notes, positioned from the earliest one (so they paste anywhere).
  function copyNotes(notes) {
    const first = Math.min(...notes.map((n) => n.step));
    return { kind: "notes", notes: notes.map((n) => ({ ...n, step: n.step - first })) };
  }

  // Pastes copied notes starting at `step`. Notes that would land past the
  // loop's end, or where a note already starts, are skipped. Returns the new notes.
  function pasteNotes(c, data, step) {
    const added = [];
    for (const n of data.notes) {
      const m = addNote(c, step + n.step, n.midi, n.len, n.vel);
      if (m) added.push(m);
    }
    return added;
  }

  // Duplicates notes right after themselves (after the last one ends).
  function duplicateNotes(c, notes) {
    const first = Math.min(...notes.map((n) => n.step));
    const end = Math.max(...notes.map((n) => n.step + n.len));
    return pasteNotes(c, copyNotes(notes), end);
  }

  // Changes how many bars a content loops; notes past the new end are
  // dropped and notes running over it are cut short.
  function setContentBars(c, bars) {
    c.bars = bars;
    c.notes = c.notes.filter((n) => n.step < loopSteps(c));
    for (const n of c.notes) n.len = Math.min(n.len, loopSteps(c) - n.step);
  }

  // --- playing ---
  // Where in a clip's content an absolute step (from the song's start) falls.
  function localStep(song, clip, pos) {
    const c = content(song, clip);
    return (pos - clip.start * STEPS + (clip.offset || 0) * STEPS) % (c.bars * STEPS);
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
    const notes = (list) => list.map(([step, midi, len = 1, vel = VEL]) => ({ step, midi, len, vel }));
    const lead = makeContent(s, "lead", "Lead riff", 1, notes([[0, 72, 2], [2, 67], [4, 69, 2], [6, 72], [8, 71, 2], [10, 72], [12, 69, 2], [14, 67, 2]]));
    const bass = makeContent(s, "bass", "Bass line", 1, notes([[0, 48, 2], [3, 48, 2], [6, 55, 2], [8, 53, 2], [11, 53, 2], [14, 55, 2]]));
    const pad = makeContent(s, "pad", "Chords", 1, notes([[0, 60, 8], [0, 64, 8], [0, 67, 8], [8, 57, 8], [8, 60, 8], [8, 64, 8]]));
    const hat = makeContent(s, "hat", "Hats", 1, notes([0, 2, 4, 6, 8, 10, 12, 14].map((st) => [st, 72, 1, st % 4 ? 0.6 : 0.9])));
    const hats16 = makeContent(s, "hat", "Hats busy", 1, notes([...Array(16).keys()].map((st) => [st, 72, 1, st % 4 ? 0.55 : 0.9])));
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

  // Valid notes from anything. Notes from before lengths take the track's
  // note length (what they played as), and every note gets a loudness.
  function cleanNotes(list, bars, defLen = 1) {
    const loop = bars * STEPS;
    return (Array.isArray(list) ? list : [])
      .filter((n) => n && Number.isInteger(n.step) && Number.isInteger(n.midi))
      .filter((n) => n.step >= 0 && n.step < loop && n.midi >= LOWEST && n.midi <= HIGHEST)
      .filter((n, i, all) => all.findIndex((m) => m.step === n.step && m.midi === n.midi) === i)
      .map((n) => ({
        step: n.step, midi: n.midi,
        len: clamp(int(n.len, defLen), 1, loop - n.step),
        vel: clamp(num(n.vel, VEL), 0.05, 1),
      }));
  }

  // Older saves (before the timeline) had per-track patterns A-D and a
  // 16-bar arrangement, or before that a single `notes` list. Runs of the
  // same pattern become one clip; every clip of a pattern shares (links to)
  // one content, so the song sounds the same as before.
  function migrate(out, s, t) {
    const patterns = s.patterns && typeof s.patterns === "object" ? s.patterns : { A: s.notes };
    const made = {};
    const contentFor = (slot) => {
      if (!made[slot]) made[slot] = makeContent(out, t.id, `${t.name} ${slot}`, 1, cleanNotes(patterns[slot], 1, t.length));
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
      // A note without a length played for its track's note length.
      const lenFor = (trackId) => {
        const st = saved.find((x) => x && x.id === trackId);
        return st && LENGTHS.includes(st.length) ? st.length : (DEFAULT_TRACKS.find((d) => d.id === trackId).length || 1);
      };
      for (const [id, c] of Object.entries(input.contents)) {
        if (!c || !out.tracks.some((t) => t.id === c.trackId)) continue;
        const bars = CONTENT_BARS.includes(c.bars) ? c.bars : 1;
        out.contents[id] = {
          id, trackId: c.trackId, bars,
          name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 40) : "Clip",
          notes: cleanNotes(c.notes, bars, lenFor(c.trackId)),
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
          .map((c) => ({
            id: typeof c.id === "string" ? c.id : newId(out, "c"), contentId: c.contentId,
            start: int(c.start, -1), length: int(c.length, 0),
            offset: Math.max(0, int(c.offset, 0)) % out.contents[c.contentId].bars,
          }))
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
    VERSION, STEPS, MIN_VIEW, CONTENT_BARS, BPM, FADER, LOWEST, HIGHEST, LENGTHS, COLORS, VEL,
    createSong, demoSong, sanitize, track, content, clipEnd, clipAt, fits,
    addClip, moveClip, resizeClip, removeClip, linkCount, makeContent, nextName,
    freeBar, cloneContent, duplicateClip, copyClip, pasteClip, splitClip, insertBars, deleteBars, duplicateBars,
    copyNotes, pasteNotes, duplicateNotes,
    noteStarting, hasNote, noteAt, notesAt, addNote, toggleNote, removeNotes, moveNote, resizeNote, setContentBars,
    localStep, notesAtPos, songBars, viewBars, playRange, audible,
  };
  if (node) module.exports = api;
  else root.Song = api;
})(typeof window !== "undefined" ? window : globalThis);
