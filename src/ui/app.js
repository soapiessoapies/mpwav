// Wires the studio together, laid out like the sketch: the transport over
// the playing box (the timeline of clips), the clip editor under it, the
// title and the paged Note Edit panel on the right, and the keyboard along
// the bottom. Sound starts on the first key or button press (browsers don't
// allow it sooner).
//
// Space plays and stops from anywhere, except where Space is the only way to
// work a control (checkboxes, radio buttons, drop-downs, text).
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SONG_KEY = "sound-studio.song";
  const UI_KEY = "sound-studio.ui";

  // --- remembered state (this browser only; fine if it's unavailable) ---
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(SONG_KEY, JSON.stringify(song));
        localStorage.setItem(UI_KEY, JSON.stringify({
          announceNotes: ui.announceNotes, kbBase: kb.base, page: ui.page, keysOpen: ui.keysOpen, layout: ui.layout,
          open: open, picked: picked,
        }));
      } catch (e) { /* private window or storage blocked */ }
    }, 200);
  }

  const savedSong = load(SONG_KEY);
  const song = savedSong ? Song.sanitize(savedSong) : Song.demoSong();
  const ui = { announceNotes: false, page: "tab-p-sound", keysOpen: true, layout: "auto", ...(load(UI_KEY) || {}) };
  const sel = () => Song.track(song, song.selected);
  // What the synth actually plays: the track's settings, pushed around by its morph pad.
  const live = (t) => Morph.apply(t.params, t.morph);

  // The clip being edited, and the clip selected on the timeline: { trackId, clipId }.
  let open = ui.open || null;
  let picked = ui.picked || null;
  function find(ref) {
    if (!ref) return null;
    const t = song.tracks.find((x) => x.id === ref.trackId);
    const clip = t && t.clips.find((c) => c.id === ref.clipId);
    return clip ? { t, clip, c: Song.content(song, clip) } : null;
  }

  Announce.attach($("announcer"));

  // --- audio: a synth and a mixer channel per track, made on first use ---
  const audio = {}; // track id -> { synth, channel }
  let transport = null;

  async function ready() {
    await Engine.start();
    if (!transport) {
      const ctx = Engine.ctx;
      for (const t of song.tracks) {
        const channel = Mixer.createChannel(ctx, Engine.input);
        const synth = Synth.create(ctx, channel.input, live(t), { reverb: Engine.reverb, bpm: song.bpm });
        audio[t.id] = { synth, channel };
        Meter.add(mixerView.meter(t.id), channel.peak, true);
      }
      Meter.add(mixerView.meter("master"), Engine.peak, true);
      applyMix();
      transport = Transport.create(ctx, {
        getBpm: () => song.bpm,
        getSteps: () => { const r = Song.playRange(song); return (r.end - r.start) * Song.STEPS; },
        onStep,
      });
    }
  }

  function applyMix() {
    if (!Object.keys(audio).length) return; // no sound yet; ready() applies it
    const on = new Set(Song.audible(song).map((t) => t.id));
    for (const t of song.tracks) {
      const a = audio[t.id];
      a.channel.setVolume(t.volume, Song.FADER.min);
      a.channel.setPan(t.pan);
      a.channel.setAudible(on.has(t.id));
    }
    Engine.setMasterVolume(song.master <= Song.FADER.min ? 0 : Math.pow(10, song.master / 20));
  }

  // --- playback ---
  // The transport counts steps from the start of the play range (the loop,
  // or the cursor to the end); `pos` is that step counted from bar 1.
  const playheadQueue = []; // { pos, time } waiting to be shown
  const booked = [];        // recently scheduled steps, for snapping recorded notes
  const skipOnce = new Set(); // "pos:midi" just recorded live, so it isn't played twice
  let endAt = null;          // when a non-looping play reaches the end of the song

  function onStep(count, time, dur) {
    const r = Song.playRange(song);
    if (endAt !== null) return; // reached the end; waiting to stop
    const pos = r.start * Song.STEPS + count;
    for (const t of Song.audible(song)) {
      const { synth } = audio[t.id];
      for (const midi of Song.notesAtPos(song, t, pos)) {
        if (t.id === song.selected && skipOnce.delete(pos + ":" + midi)) continue;
        const v = synth.noteOn(midi, 0.85, time);
        synth.voiceOff(v, time + dur * t.length * 0.92);
      }
    }
    playheadQueue.push({ pos, time });
    booked.push({ pos, time });
    if (booked.length > 32) booked.shift();
    if (!r.repeat && count === (r.end - r.start) * Song.STEPS - 1) {
      endAt = time + dur;
      setTimeout(() => { if (endAt !== null) stopLoop(); }, (endAt - Engine.ctx.currentTime) * 1000 + 50);
    }
  }

  // Runs only while playing.
  function drawPlayhead() {
    if (!transport || !transport.playing) return;
    const now = Engine.ctx.currentTime;
    let shown = null;
    while (playheadQueue.length && playheadQueue[0].time <= now) shown = playheadQueue.shift();
    if (shown) {
      timeline.setPlayhead(shown.pos);
      const o = find(open);
      const bar = Math.floor(shown.pos / Song.STEPS);
      grid.setPlayhead(o && bar >= o.clip.start && bar < Song.clipEnd(o.clip) ? Song.localStep(song, o.clip, shown.pos) : -1);
    }
    requestAnimationFrame(drawPlayhead);
  }

  function stopLoop() {
    if (!transport || !transport.playing) return;
    endTake();
    transport.stop();
    endAt = null;
    playheadQueue.length = 0;
    booked.length = 0;
    skipOnce.clear();
    timeline.setPlayhead(-1);
    grid.setPlayhead(-1);
    $("play").setAttribute("aria-pressed", "false");
    Announce.say("Stopped");
  }

  async function togglePlay() {
    if (transport && transport.playing) { stopLoop(); return; }
    await ready();
    endAt = null;
    transport.start();
    requestAnimationFrame(drawPlayhead);
    $("play").setAttribute("aria-pressed", "true");
    const r = Song.playRange(song);
    Announce.say(r.repeat ? `Playing, looping bars ${r.start + 1} to ${r.end}` : `Playing from bar ${r.start + 1}`);
  }
  $("play").addEventListener("click", togglePlay);

  const tempo = $("tempo");
  tempo.min = Song.BPM.min; tempo.max = Song.BPM.max;
  tempo.value = song.bpm;
  tempo.addEventListener("change", () => {
    const v = Math.round(Number(tempo.value));
    song.bpm = Number.isFinite(v) ? Math.min(Song.BPM.max, Math.max(Song.BPM.min, v)) : song.bpm;
    tempo.value = song.bpm;
    for (const id in audio) audio[id].synth.setTempo(song.bpm);
    save();
  });

  // --- the loop ---
  const loopBtn = $("loop"), loopStart = $("loop-start"), loopEnd = $("loop-end");
  function showLoop() {
    loopBtn.setAttribute("aria-pressed", String(song.loop.on));
    loopStart.value = song.loop.start + 1;
    loopEnd.value = song.loop.end; // bars are numbered from 1, so the last bar looped = end
    loopStart.disabled = loopEnd.disabled = !song.loop.on;
    showSongStatus();
  }
  function setLoop(start, end, announce) {
    start = Math.max(0, start);
    end = Math.max(start + 1, end);
    song.loop = { on: true, start, end };
    showLoop();
    timeline.render();
    if (announce) Announce.say(`Looping bars ${start + 1} to ${end}`);
    save();
  }
  loopBtn.addEventListener("click", () => {
    song.loop.on = !song.loop.on;
    showLoop();
    timeline.render();
    Announce.say(song.loop.on ? `Loop on, bars ${song.loop.start + 1} to ${song.loop.end}` : "Loop off: Play runs from the cursor to the end");
    save();
  });
  const readBar = (input, fallback) => { const v = Math.round(Number(input.value)); return Number.isFinite(v) && v >= 1 ? v : fallback; };
  loopStart.addEventListener("change", () => setLoop(readBar(loopStart, song.loop.start + 1) - 1, Math.max(song.loop.end, readBar(loopStart, 1)), true));
  loopEnd.addEventListener("change", () => setLoop(song.loop.start, Math.max(readBar(loopEnd, song.loop.end), song.loop.start + 1), true));

  function showSongStatus() {
    const n = Song.songBars(song);
    const r = Song.playRange(song);
    $("song-status").textContent = (n ? `The song is ${n} bar${n > 1 ? "s" : ""} long. ` : "No clips yet. ") +
      (r.repeat ? `Play loops bars ${r.start + 1} to ${r.end}.` : `Play runs from bar ${r.start + 1} to bar ${r.end}, then stops.`);
  }

  // --- recording: while on, Play runs and live notes go into the open clip
  // (or one at the cursor), snapped to the nearest step. A take is one
  // stretch of recording; Undo take removes what it added. ---
  let take = null;     // { contentId, trackId, notes } while recording
  let lastTake = null; // the finished take Undo take would remove
  const recBtn = $("record");
  const undoBtn = $("undo-take");

  // The clip to record into: the open one if it's on the selected track,
  // else the one at the cursor, else a new 1-bar clip at the first free bar.
  function recordTarget() {
    const t = sel();
    const o = find(open);
    if (o && o.t === t) return o;
    let clip = Song.clipAt(t, song.cursor);
    if (!clip) {
      let bar = song.cursor;
      while (!Song.fits(t, bar, 1)) bar++;
      clip = Song.addClip(song, t, bar, 1);
    }
    openClip(t, clip, false);
    return find(open);
  }

  async function startTake() {
    const target = recordTarget();
    const { clip, c, t } = target;
    // Loop the clip while recording into it.
    setLoop(clip.start, Song.clipEnd(clip), false);
    take = { contentId: c.id, trackId: t.id, notes: [] };
    recBtn.setAttribute("aria-pressed", "true");
    if (!transport || !transport.playing) await togglePlay();
    Announce.say(`Recording into ${c.name}, looping bars ${clip.start + 1} to ${Song.clipEnd(clip)}`);
  }

  function endTake() {
    if (!take) return;
    const done = take;
    take = null;
    recBtn.setAttribute("aria-pressed", "false");
    if (done.notes.length) {
      lastTake = done;
      undoBtn.disabled = false;
      Announce.say(`Recorded ${done.notes.length} note${done.notes.length > 1 ? "s" : ""}`);
    }
  }

  recBtn.addEventListener("click", () => (take ? endTake() : startTake()));

  undoBtn.addEventListener("click", () => {
    if (!lastTake) return;
    endTake();
    const c = song.contents[lastTake.contentId];
    if (c) Song.removeNotes(c, lastTake.notes);
    Announce.say(`Take undone: ${lastTake.notes.length} note${lastTake.notes.length > 1 ? "s" : ""} removed`);
    lastTake = null;
    undoBtn.disabled = true;
    renderEditor();
    timeline.render();
    save();
  });

  // The scheduled step closest to now, or the one about to be scheduled.
  function nearestStep() {
    const now = Engine.ctx.currentTime;
    const ahead = transport.peek();
    let best = ahead && { pos: Song.playRange(song).start * Song.STEPS + ahead.step, time: ahead.time, upcoming: true };
    for (const b of booked) {
      if (!best || Math.abs(b.time - now) < Math.abs(best.time - now)) best = { ...b, upcoming: false };
    }
    return best;
  }

  function recordNote(m) {
    if (!take || !transport || !transport.playing) return;
    const t = Song.track(song, take.trackId);
    const at = nearestStep();
    if (!at) return;
    const clip = Song.clipAt(t, Math.floor(at.pos / Song.STEPS));
    if (!clip || clip.contentId !== take.contentId) return;
    const local = Song.localStep(song, clip, at.pos);
    if (!Song.addNote(song.contents[take.contentId], local, m)) return;
    take.notes.push({ step: local, midi: m });
    // You already heard it as you played it; don't play it again a moment later.
    if (at.upcoming) skipOnce.add(at.pos + ":" + m);
    grid.mark(local, m, true);
    showOffGrid();
    timeline.render();
    save();
  }

  // --- live notes from the keyboards, played on the selected track. The
  // same note can be held by a finger and a computer key at once; it sounds
  // until the last one lets go. ---
  const holds = new Map(); // midi -> { n, trackId }
  let lastSpoken = 0;

  function noteOn(m) {
    const h = holds.get(m);
    if (h) { h.n++; return; }
    const trackId = song.selected;
    holds.set(m, { n: 1, trackId });
    kb.setLit(m, true);
    if (ui.announceNotes && performance.now() - lastSpoken > 150) {
      lastSpoken = performance.now();
      Announce.say(Notes.spokenName(m));
    }
    if (transport && Engine.running()) {
      audio[trackId].synth.noteOn(m);
      recordNote(m);
    } else {
      ready().then(() => { if (holds.get(m)) audio[trackId].synth.noteOn(m); });
    }
  }

  function noteOff(m) {
    const h = holds.get(m);
    if (!h) return;
    if (--h.n > 0) return;
    holds.delete(m);
    kb.setLit(m, false);
    if (audio[h.trackId]) audio[h.trackId].synth.noteOff(m);
  }

  // A quick listen when a note is added to the grid (only while stopped:
  // during playback you'll hear it come round).
  function preview(t, midi) {
    if (transport && transport.playing) return;
    ready().then(() => {
      const s = audio[t.id].synth;
      const v = s.noteOn(midi, 0.8);
      s.voiceOff(v, Engine.ctx.currentTime + 0.25);
    });
  }

  function panic() {
    kb.releaseAll();
    compHeld.clear();
    for (const m of holds.keys()) kb.setLit(m, false);
    holds.clear();
    for (const id in audio) audio[id].synth.allOff();
  }

  // --- on-screen keyboard ---
  const kb = Keyboard.create($("keys"), { onOn: noteOn, onOff: noteOff });
  const compact = () => document.documentElement.dataset.layout === "compact";

  function setKeyboard(base, announce) {
    const span = compact() ? 12 : 24;
    base = Math.max(Song.LOWEST, Math.min(Song.HIGHEST - span, base));
    base -= Notes.pitchClass(base); // always start on a C
    kb.setRange(base, span);
    const text = `${Notes.noteName(base)} to ${Notes.noteName(base + span)}`;
    $("oct-label").textContent = text;
    $("oct-down").disabled = base <= Song.LOWEST;
    $("oct-up").disabled = base + span >= Song.HIGHEST;
    if (announce) Announce.say("Keyboard " + text);
    save();
  }
  setKeyboard(typeof ui.kbBase === "number" ? ui.kbBase : 60, false);
  $("oct-down").addEventListener("click", () => setKeyboard(kb.base - 12, true));
  $("oct-up").addEventListener("click", () => setKeyboard(kb.base + 12, true));
  $("panic").addEventListener("click", () => { panic(); Announce.say("All notes stopped"); });

  const announceBox = $("announce-notes");
  announceBox.checked = !!ui.announceNotes;
  announceBox.addEventListener("change", () => { ui.announceNotes = announceBox.checked; save(); });

  // --- computer keys: A W S E D ... play, Z / X change octave, Space plays,
  // Esc stops every note ---
  const compHeld = new Map(); // key code -> midi, so an octave change mid-note lets go of the right one

  function typingInto(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    return t.tagName === "INPUT" && !["range", "button"].includes(t.type);
  }
  // Controls that need Space to work (checkbox, radio) keep it.
  const spaceIsTheirs = (t) => typingInto(t) || (t.tagName === "INPUT" && ["checkbox", "radio"].includes(t.type));

  // Settings is its own little window: keys typed there aren't music.
  const inDialog = (t) => !!(t && t.closest && t.closest("dialog"));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || inDialog(e.target)) return;
    if (e.code === "Space") {
      if (spaceIsTheirs(e.target)) return;
      e.preventDefault(); // also stops a focused button from being pressed
      if (!e.repeat) togglePlay();
      return;
    }
    if (typingInto(e.target)) return;
    if (e.key === "Escape") { panic(); return; }
    const off = Notes.KEY_OFFSETS[e.code];
    if (off != null) {
      e.preventDefault();
      if (e.repeat || compHeld.has(e.code)) return;
      const m = kb.base + off;
      compHeld.set(e.code, m);
      noteOn(m);
    } else if (e.code === "KeyZ" && !e.repeat) {
      setKeyboard(kb.base - 12, true);
    } else if (e.code === "KeyX" && !e.repeat) {
      setKeyboard(kb.base + 12, true);
    }
  });
  document.addEventListener("keyup", (e) => {
    if (inDialog(e.target)) return;
    if (e.code === "Space" && !spaceIsTheirs(e.target)) { e.preventDefault(); return; }
    if (!compHeld.has(e.code)) return;
    noteOff(compHeld.get(e.code));
    compHeld.delete(e.code);
  });
  // Keys let go while the window was in the background never send keyup.
  window.addEventListener("blur", () => {
    for (const m of compHeld.values()) noteOff(m);
    compHeld.clear();
    kb.releaseAll();
  });

  // --- the playing box ---
  const timeline = Timeline.create($("timeline"), {
    song: () => song,
    selectedClip: () => (find(picked) || {}).clip || null,
    onSelectTrack: (id, announce) => selectTrack(id, announce !== false),
    onSelectClip(t, clip, announce) {
      picked = { trackId: t.id, clipId: clip.id };
      if (song.selected !== t.id) selectTrack(t.id, false);
      else timeline.render();
      if (announce) Announce.say("Selected " + Song.content(song, clip).name);
      save();
    },
    onOpenClip: (t, clip) => openClip(t, clip, true),
    onNewClip(t, bar) {
      const clip = Song.addClip(song, t, bar, 1);
      if (!clip) { Announce.say("There's already a clip there"); return; }
      selectTrack(t.id, false);
      openClip(t, clip, true);
      Announce.say(`New clip ${Song.content(song, clip).name} at bar ${bar + 1}`);
    },
    onDeleteClip(t, clip) {
      const name = Song.content(song, clip).name;
      const i = t.clips.indexOf(clip);
      if (open && open.clipId === clip.id) closeClip();
      Song.removeClip(song, t, clip);
      picked = null;
      afterChange(`Deleted ${name}`);
      const next = t.clips[i] || t.clips[i - 1];
      if (next) timeline.focusClip(next);
    },
    onCursor(bar) {
      song.cursor = bar;
      timeline.render();
      showSongStatus();
      Announce.say(`Cursor at bar ${bar + 1}`);
      save();
    },
    onLoop: (start, end) => setLoop(start, end, true),
    onChanged: (text) => afterChange(text),
    onZoom: showZoom,
  });

  function afterChange(text) {
    timeline.render();
    renderEditor();
    showSongStatus();
    if (text) Announce.say(text);
    save();
  }

  function showZoom(z) {
    $("zoom-in").disabled = !z.canIn;
    $("zoom-out").disabled = !z.canOut;
  }
  $("zoom-in").addEventListener("click", () => showZoom(timeline.zoomIn()));
  $("zoom-out").addEventListener("click", () => showZoom(timeline.zoomOut()));

  $("new-clip").addEventListener("click", () => {
    const t = sel();
    let bar = song.cursor;
    while (!Song.fits(t, bar, 1)) bar++;
    const clip = Song.addClip(song, t, bar, 1);
    openClip(t, clip, true);
    Announce.say(`New clip ${Song.content(song, clip).name} on ${t.name}, bar ${bar + 1}`);
  });

  // --- the clip editor ---
  const grid = StepGrid.create($("grid"), {
    onToggle(step, midi) {
      const o = find(open);
      if (!o) return false;
      const on = Song.toggleNote(o.c, step, midi);
      if (on) preview(o.t, midi);
      showOffGrid();
      timeline.render();
      save();
      return on;
    },
  });

  const barsSel = $("clip-bars");
  for (const n of Song.CONTENT_BARS) barsSel.add(new Option(n === 1 ? "1 bar" : n + " bars", n));
  barsSel.addEventListener("change", () => {
    const o = find(open);
    if (!o) return;
    Song.setContentBars(o.c, Number(barsSel.value));
    afterChange(`${o.c.name} loops ${o.c.bars} bar${o.c.bars > 1 ? "s" : ""}`);
  });

  const nameField = $("clip-name");
  nameField.addEventListener("change", () => {
    const o = find(open);
    if (!o) return;
    o.c.name = nameField.value.trim().slice(0, 40) || o.c.name;
    nameField.value = o.c.name;
    afterChange();
  });

  const lengthSel = $("note-length");
  for (const n of Song.LENGTHS) lengthSel.add(new Option(n === 1 ? "1 step" : n + " steps", n));
  lengthSel.addEventListener("change", () => { sel().length = Number(lengthSel.value); timeline.render(); save(); });

  function openClip(t, clip, focus) {
    endTake();
    resetUndo();
    open = { trackId: t.id, clipId: clip.id };
    picked = { trackId: t.id, clipId: clip.id };
    if (song.selected !== t.id) selectTrack(t.id, false);
    afterChange();
    if (focus) {
      $("clip-editor").focus();
      Announce.say(`Editing ${Song.content(song, clip).name}`);
    }
  }

  function closeClip() {
    endTake();
    open = null;
    renderEditor();
    save();
  }
  $("close-clip").addEventListener("click", () => { closeClip(); Announce.say("Clip closed"); });

  function setGridBase(base, announce) {
    const t = sel();
    t.gridBase = Math.max(Song.LOWEST, Math.min(Song.HIGHEST - 12, base));
    renderEditor();
    if (announce) Announce.say(`Rows ${Notes.noteName(t.gridBase)} to ${Notes.noteName(t.gridBase + 12)}`);
    save();
  }
  $("rows-down").addEventListener("click", () => setGridBase(sel().gridBase - 12, true));
  $("rows-up").addEventListener("click", () => setGridBase(sel().gridBase + 12, true));

  // Notes that are in the clip but above or below the rows on screen.
  function showOffGrid() {
    const o = find(open);
    if (!o) { $("off-grid").textContent = ""; return; }
    const above = o.c.notes.filter((n) => n.midi > o.t.gridBase + 12).length;
    const below = o.c.notes.filter((n) => n.midi < o.t.gridBase).length;
    const parts = [];
    if (above) parts.push(`${above} note${above > 1 ? "s" : ""} higher up`);
    if (below) parts.push(`${below} lower down`);
    $("off-grid").textContent = parts.join(", ");
  }

  let undoClear = null;
  const clearBtn = $("clear");
  clearBtn.addEventListener("click", () => {
    const o = find(open);
    if (!o) return;
    if (undoClear) {
      const c = song.contents[undoClear.contentId];
      if (c) c.notes = undoClear.notes;
      undoClear = null;
      clearBtn.textContent = "Clear";
      Announce.say("Notes restored");
    } else {
      if (!o.c.notes.length) return;
      endTake();
      undoClear = { contentId: o.c.id, notes: o.c.notes };
      o.c.notes = [];
      lastTake = null;
      undoBtn.disabled = true;
      clearBtn.textContent = "Undo clear";
      Announce.say(`${o.c.name} cleared. Press Undo clear to bring the notes back.`);
    }
    afterChange();
  });
  function resetUndo() {
    undoClear = null;
    clearBtn.textContent = "Clear";
  }

  function renderEditor() {
    const o = find(open);
    if (open && !o) open = null; // the clip was deleted
    $("clip-empty").hidden = !!o;
    $("clip-body").hidden = !o;
    nameField.disabled = barsSel.disabled = $("close-clip").disabled = !o;
    if (!o) {
      $("clip-h").textContent = "Clip";
      nameField.value = "";
      return;
    }
    const { t, clip, c } = o;
    $("clip-h").textContent = "Clip: " + t.name;
    $("clip-editor").style.setProperty("--track", `var(--c-${t.color})`);
    nameField.value = c.name;
    barsSel.value = c.bars;
    const links = Song.linkCount(song, c.id);
    const span = clip.length === 1 ? `bar ${clip.start + 1}` : `bars ${clip.start + 1}–${Song.clipEnd(clip)}`;
    $("clip-status").textContent = `${c.bars}-bar loop · this clip covers ${span}` +
      (clip.length > c.bars ? ", repeating it" : "") +
      (links > 1 ? ` · linked: edits change all ${links} copies` : "");
    grid.render({ name: c.name, gridBase: t.gridBase, steps: c.bars * Song.STEPS, has: (s, m) => Song.hasNote(c, s, m) });
    $("rows-label").textContent = `${Notes.noteName(t.gridBase)} to ${Notes.noteName(t.gridBase + 12)}`;
    $("rows-down").disabled = t.gridBase <= Song.LOWEST;
    $("rows-up").disabled = t.gridBase + 12 >= Song.HIGHEST;
    lengthSel.value = t.length;
    showOffGrid();
  }

  // --- title ---
  const titleField = $("song-title");
  titleField.value = song.title;
  const showTitle = () => { document.title = `${song.title} — Sound Studio`; };
  titleField.addEventListener("input", () => { song.title = titleField.value.slice(0, 80); showTitle(); save(); });
  titleField.addEventListener("change", () => {
    song.title = titleField.value.trim() || "Untitled song";
    titleField.value = song.title;
    showTitle();
    save();
  });
  showTitle();

  // --- Note Edit: paged settings for the selected track ---
  const controls = Controls.build($("synth-controls"), {
    get: () => sel().params,
    onChange(id, value) {
      const t = sel();
      t.params = Params.sanitize({ ...t.params, [id]: value });
      if (audio[t.id]) audio[t.id].synth.set(id, live(t)[id]);
      save();
    },
  });
  // The control groups go onto their pages.
  const pageFor = { osc: "p-shape", env: "p-shape", filter: "p-filter", out: "p-filter", warp: "p-warp" };
  for (const [g, page] of Object.entries(pageFor)) $(page).append(document.querySelector(".group-" + g));

  const pages = Tabs.create(document.querySelector(".pages"), {
    onSelect(id) { ui.page = id; save(); },
  });
  pages.select($(ui.page) ? ui.page : "tab-p-sound", false);
  const pageIds = [...document.querySelectorAll(".pages [role=tab]")].map((t) => t.id);
  const turnPage = (dir) => {
    const i = (pageIds.indexOf(pages.current) + dir + pageIds.length) % pageIds.length;
    pages.select(pageIds.at(i), false);
    Announce.say(`${$(pageIds.at(i)).textContent} page, ${i + 1} of ${pageIds.length}`);
  };
  $("page-prev").addEventListener("click", () => turnPage(-1));
  $("page-next").addEventListener("click", () => turnPage(1));

  const presetSel = $("preset");
  for (const p of Presets.PRESETS) presetSel.add(new Option(p.name, p.id));
  presetSel.addEventListener("change", () => {
    const t = sel();
    const p = Presets.find(presetSel.value);
    t.preset = p.id;
    t.params = Params.sanitize(p.params);
    if (audio[t.id]) audio[t.id].synth.load(live(t));
    controls.refresh(t.params);
    mixerView.refresh();
    save();
  });

  const morphPad = MorphPad.create($("morph"), {
    onChange(pos) {
      const t = sel();
      t.morph = { x: pos.x, y: pos.y };
      if (audio[t.id]) {
        const p = live(t);
        for (const id of Morph.AFFECTS) audio[t.id].synth.set(id, p[id]);
      }
      save();
    },
  });

  const mixerView = MixerView.create($("mixer-strips"), song, {
    select: selectTrack,
    volume(id, db) { Song.track(song, id).volume = db; applyMix(); save(); },
    pan(id, v) { Song.track(song, id).pan = v; applyMix(); save(); },
    mute(id, on) { Song.track(song, id).mute = on; applyMix(); timeline.render(); save(); },
    solo(id, on) { Song.track(song, id).solo = on; applyMix(); timeline.render(); save(); },
    master(db) { song.master = db; applyMix(); save(); },
  });

  function selectTrack(id, announce = true) {
    if (song.selected !== id) {
      panic();
      endTake();
    }
    song.selected = id;
    const t = sel();
    const chip = $("note-edit-track");
    chip.textContent = t.name;
    chip.style.setProperty("--track", `var(--c-${t.color})`);
    presetSel.value = t.preset;
    morphPad.set(t.morph);
    controls.refresh(t.params);
    mixerView.refresh();
    timeline.render();
    renderEditor();
    if (announce) Announce.say("Selected " + t.name);
    save();
  }

  // --- show / hide the keyboard (the computer keys keep working) ---
  const keysToggle = $("keys-toggle");
  function showKeys(isOpen) {
    ui.keysOpen = isOpen;
    keysToggle.setAttribute("aria-expanded", String(isOpen));
    $("keys-body").hidden = !isOpen;
    if (!isOpen) kb.releaseAll();
    save();
  }
  keysToggle.addEventListener("click", () => showKeys(keysToggle.getAttribute("aria-expanded") !== "true"));
  showKeys(ui.keysOpen !== false);

  // --- sound switch ---
  const soundBtn = $("sound");
  soundBtn.addEventListener("click", () => {
    if (Engine.running()) {
      panic();
      stopLoop();
      Engine.stop();
    } else ready();
  });
  Engine.onChange(() => {
    const on = Engine.running();
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.querySelector(".state").textContent = on ? "On" : "Off";
  });

  // --- settings: layout, fullscreen, credits ---
  // The layout comes from the setting, or from the window's width on Auto.
  function applyLayout() {
    const w = window.innerWidth;
    const want = ui.layout === "desktop" ? "wide" : ui.layout === "phone" ? "compact"
      : w >= 1100 ? "wide" : w <= 640 ? "compact" : "medium";
    if (document.documentElement.dataset.layout !== want) {
      document.documentElement.dataset.layout = want;
      setKeyboard(kb.base, false);
    }
  }
  window.addEventListener("resize", applyLayout);

  const settings = $("settings");
  $("version").textContent = "v" + window.STUDIO_VERSION;
  $("settings-btn").addEventListener("click", () => {
    $("layout-" + ui.layout).checked = true;
    settings.showModal();
  });
  $("settings-close").addEventListener("click", () => settings.close());
  // A click on the dim backdrop (outside the box) closes it too.
  settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); });
  settings.addEventListener("close", () => $("settings-btn").focus());

  for (const choice of ["auto", "desktop", "phone"]) {
    $("layout-" + choice).addEventListener("change", (e) => {
      if (!e.target.checked) return;
      ui.layout = choice;
      applyLayout();
      Announce.say(`${choice === "auto" ? "Automatic" : choice === "desktop" ? "Desktop" : "Phone"} layout`);
      save();
    });
  }

  const fsBtn = $("fullscreen");
  if (!document.fullscreenEnabled) {
    // iPhones only allow fullscreen for video; add to the home screen instead.
    fsBtn.disabled = true;
    $("fullscreen-help").textContent = "This browser doesn't allow fullscreen pages. On a phone, add Sound Studio to your home screen instead.";
  }
  fsBtn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch (e) {
      Announce.say("Fullscreen isn't available here");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    fsBtn.setAttribute("aria-pressed", String(on));
    Announce.say(on ? "Fullscreen" : "Left fullscreen");
  });

  // --- first paint ---
  if (!find(picked)) picked = null;
  applyLayout();
  selectTrack(song.selected, false);
  showLoop();
  showZoom({ canIn: true, canOut: true });
})();
