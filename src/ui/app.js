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
  const UI_KEY = "sound-studio.ui";

  // --- remembered state (this browser only; fine if it's unavailable) ---
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  // Saving is debounced, and every saved version of the song that differs
  // from the last is a step the undo history can go back to.
  let saveTimer = 0;
  const history = History.create(100);
  // What undo tracks: the song without where you're looking (the selected
  // track and the cursor), so clicking around isn't an undo step.
  const historyJson = () => JSON.stringify({ ...song, selected: undefined, cursor: undefined });
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 200);
  }
  function writeNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const json = JSON.stringify(song);
    history.commit(historyJson());
    showUndo();
    library.save(songId, json);
    showSaved();
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        announceNotes: ui.announceNotes, kbBase: kb.base, page: ui.page, keysOpen: ui.keysOpen, layout: ui.layout, theme: ui.theme,
        metronome: ui.metronome, countIn: ui.countIn, keysMode: ui.keysMode, singleKeys: ui.singleKeys, midi: ui.midi, collapsed: ui.collapsed,
        panels: ui.panels, folded: ui.folded, sideLeft: ui.sideLeft, look: ui.look, motion: ui.motion, fit: ui.fit, tips: ui.tips, sizes: ui.sizes, size: ui.size,
        open: open, picked: picked, songId,
      }));
    } catch (e) { /* private window or storage blocked */ }
  }

  // Songs live in a library in this browser (in memory only, if the browser blocks storage).
  let store;
  try {
    localStorage.setItem("sound-studio.probe", "1");
    localStorage.removeItem("sound-studio.probe");
    store = localStorage;
  } catch (e) { store = Library.memoryStorage(); }
  const library = Library.create(store);
  const uiSaved = load(UI_KEY) || {};
  let songId = uiSaved.songId;
  if (!library.list().length) songId = library.adoptLegacy() || library.add(Song.demoSong());
  if (!library.load(songId)) songId = library.list()[0].id;
  const song = Song.sanitize(library.load(songId));
  const ui = { announceNotes: false, page: "tab-p-note", keysOpen: true, layout: "auto", theme: "contrast", metronome: false, countIn: true, keysMode: "play", singleKeys: true, midi: false, collapsed: [], panels: null, folded: [], sideLeft: false, look: "pixel", motion: true, fit: true, tips: false, sizes: null, size: "auto", ...uiSaved };
  let arrange = null; // window edit mode (set up near the end)
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
  let tlZoom = null, rollZoom = null; // the zoom bars under the timeline and the piano roll

  // Once sound is on, every track has a synth and a mixer channel: tracks
  // added later get theirs straight away, removed ones are unplugged.
  function syncAudio() {
    const ctx = Engine.ctx;
    if (!ctx || !transport) return;
    for (const t of song.tracks) {
      if (audio[t.id]) continue;
      const channel = Mixer.createChannel(ctx, Engine.input);
      const synth = Synth.create(ctx, channel.input, live(t), { reverb: Engine.reverb, bpm: song.bpm });
      audio[t.id] = { synth, channel };
      applySampler(t);
      // A brand-new track has no strip until the mixer is redrawn; rebuildMixer hooks its meter up then.
      const canvas = mixerView.meter(t.id);
      if (canvas) Meter.add(canvas, channel.peak, true);
    }
    for (const id of Object.keys(audio)) {
      if (song.tracks.some((t) => t.id === id)) continue;
      audio[id].synth.dispose();
      audio[id].channel.dispose();
      delete audio[id];
    }
    applyMix();
  }

  // --- uploaded sounds: a synth track's instrument, or an audio track's clips ---
  const soundSecs = (id) => (Samples.info(id) || {}).duration || 0;
  function applySampler(t) {
    const a = audio[t.id];
    if (!a) return;
    const s = t.kind === "synth" && t.sampler;
    const buffer = s && Samples.buffer(s.sampleId, s.reverse);
    a.synth.setSample(buffer ? { ...s, buffer } : null);
  }
  // Decodes the song's sounds (from this browser's storage), then redraws
  // what shows them.
  function loadSounds() {
    return Samples.load(Song.soundIds(song)).then(() => {
      for (const t of song.tracks) applySampler(t);
      timeline.render();
      renderEditor();
      renderSoundPage();
    });
  }

  async function ready() {
    await Engine.start();
    if (!transport) {
      const ctx = Engine.ctx;
      Meter.add(mixerView.meter("master"), Engine.peak, true);
      transport = Transport.create(ctx, {
        // A count-in (steps below zero) runs at the tempo where play starts.
        stepLength: (count) => Song.stepSeconds(song, Song.playRange(song).start * Song.STEPS + Math.max(0, count)),
        getSteps: () => { const r = Song.playRange(song); return (r.end - r.start) * Song.STEPS; },
        onStep,
      });
      syncAudio();
    }
  }

  function applyMix() {
    if (!Object.keys(audio).length) return; // no sound yet; ready() applies it
    const on = new Set(Song.audible(song).map((t) => t.id));
    for (const t of song.tracks) {
      const a = audio[t.id];
      if (!a) continue;
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

  let echoBpm = null; // the tempo the echoes were last set to
  function onStep(count, time, dur) {
    const r = Song.playRange(song);
    if (endAt !== null) return; // reached the end; waiting to stop
    if (count < 0) {
      // The count-in: a click on every beat of the bar before.
      if ((count + 16) % 4 === 0) Engine.click(time, count === -16);
      return;
    }
    const pos = r.start * Song.STEPS + count;
    if (ui.metronome && pos % 4 === 0) Engine.click(time, pos % Song.STEPS === 0);
    // Echoes stay in time through tempo changes.
    const bpm = Math.round(Song.bpmAt(song, pos));
    if (bpm !== echoBpm) {
      echoBpm = bpm;
      for (const id in audio) audio[id].synth.setTempo(bpm);
    }
    for (const t of Song.audible(song)) {
      const { synth } = audio[t.id];
      const at = pos % 2 ? time + song.swing * dur : time; // swing: offbeat sixteenths play late
      for (const n of Song.notesAtPos(song, t, pos)) {
        if (t.id === song.selected && skipOnce.delete(pos + ":" + n.midi)) continue;
        synth.playNote(n, at, dur);
      }
      const seg = Song.audioSegment(song, t, pos, r.start * Song.STEPS, soundSecs, dur);
      if (seg) synth.playAudio(Samples.buffer(seg.sampleId, seg.reverse), seg, time);
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
      roll.setPlayhead(o && bar >= o.clip.start && bar < Song.clipEnd(o.clip) ? Song.localStep(song, o.clip, shown.pos) : -1);
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
    roll.setPlayhead(-1);
    $("play").setAttribute("aria-pressed", "false");
    Announce.say("Stopped");
  }

  async function togglePlay(countIn = false) {
    if (transport && transport.playing) { stopLoop(); return; }
    await ready();
    endAt = null;
    echoBpm = null;
    transport.start(countIn ? -Song.STEPS : 0);
    requestAnimationFrame(drawPlayhead);
    $("play").setAttribute("aria-pressed", "true");
    const r = Song.playRange(song);
    Announce.say((countIn ? "Count-in, then " : "") +
      (r.repeat ? `playing, looping bars ${r.start + 1} to ${r.end}` : `playing from bar ${r.start + 1}`));
  }
  $("play").addEventListener("click", () => togglePlay());

  const tempo = $("tempo");
  tempo.min = Song.BPM.min; tempo.max = Song.BPM.max;
  tempo.value = song.bpm;
  tempo.addEventListener("change", () => {
    const v = Math.round(Number(tempo.value));
    song.bpm = Number.isFinite(v) ? Math.min(Song.BPM.max, Math.max(Song.BPM.min, v)) : song.bpm;
    tempo.value = song.bpm;
    for (const id in audio) audio[id].synth.setTempo(song.bpm);
    renderTempoList();
    timeline.render();
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
    if (sel().kind === "audio") { Announce.say("Recording plays notes into a synth track. Pick one first."); return; }
    const target = recordTarget();
    const { clip, c, t } = target;
    // Loop the clip while recording into it.
    setLoop(clip.start, Song.clipEnd(clip), false);
    take = { contentId: c.id, trackId: t.id, notes: [], held: new Map() };
    recBtn.setAttribute("aria-pressed", "true");
    const counting = (!transport || !transport.playing) && ui.countIn;
    if (!transport || !transport.playing) await togglePlay(counting);
    Announce.say(`${counting ? "Count-in, then recording" : "Recording"} into ${c.name}, looping bars ${clip.start + 1} to ${Song.clipEnd(clip)}`);
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
    let best = ahead && ahead.step >= 0 && { pos: Song.playRange(song).start * Song.STEPS + ahead.step, time: ahead.time, upcoming: true };
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
    const n = Song.addNote(song.contents[take.contentId], local, m, 1);
    if (!n) return;
    take.notes.push(n);
    take.held.set(m, { n, from: Engine.ctx.currentTime, pos: at.pos });
    // You already heard it as you played it; don't play it again a moment later.
    if (at.upcoming) skipOnce.add(at.pos + ":" + m);
    renderEditor();
    timeline.render();
    save();
  }

  // When a recorded key lets go, its note becomes as long as it was held.
  function recordRelease(m) {
    const h = take && take.held.get(m);
    if (!h) return;
    take.held.delete(m);
    const steps = (Engine.ctx.currentTime - h.from) / Song.stepSeconds(song, h.pos);
    Song.resizeNote(song.contents[take.contentId], h.n, Math.max(1, Math.round(steps)));
    renderEditor();
    timeline.render();
    save();
  }

  // --- live notes from the keyboards, played on the selected track. The
  // same note can be held by a finger and a computer key at once; it sounds
  // until the last one lets go. ---
  const holds = new Map(); // midi -> { n, trackId }
  let lastSpoken = 0;

  let saidAudioOnly = 0;
  function noteOn(m) {
    if (sel().kind === "audio") {
      // Audio tracks have no notes; say so (not on every key).
      if (performance.now() - saidAudioOnly > 4000) {
        saidAudioOnly = performance.now();
        Announce.say(`${sel().name} is an audio track: it plays sound files. Pick a synth track to play notes.`);
      }
      return;
    }
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
    stepNoteOn(m);
  }

  function noteOff(m) {
    const h = holds.get(m);
    if (!h) return;
    if (--h.n > 0) return;
    holds.delete(m);
    kb.setLit(m, false);
    recordRelease(m);
    stepNoteOff(m);
    if (audio[h.trackId]) audio[h.trackId].synth.noteOff(m);
  }

  // A quick listen when a note is added in the piano roll (only while stopped:
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
    chordPad.releaseAll();
    compHeld.clear();
    for (const m of holds.keys()) kb.setLit(m, false);
    holds.clear();
    for (const id in audio) audio[id].synth.allOff();
  }

  // --- on-screen keyboard ---
  const kb = Keyboard.create($("keys"), { onOn: noteOn, onOff: noteOff });
  // Chord buttons (src/ui/chords.js): the song key's chords, voiced around
  // the keyboard (roots from its lowest C up an octave), through the same noteOn/noteOff as the keys.
  const chordPad = Chords.create($("chords"), { getKey: () => song.key, around: () => kb.base + 6, onOn: noteOn, onOff: noteOff });
  let chordKey = "";
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
    // Ctrl + S saves from anywhere, even while typing (Shift: Save as).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveSong(e.shiftKey);
      return;
    }
    if (inDialog(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !typingInto(e.target) && shortcut(e)) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") {
      if (spaceIsTheirs(e.target)) return;
      e.preventDefault(); // also stops a focused button from being pressed
      if (!e.repeat) togglePlay();
      return;
    }
    if (typingInto(e.target)) return;
    if (e.key === "Escape") { if (arrange.arranging) setArranging(false); panic(); return; }
    if (e.key === "?") { e.preventDefault(); openShortcuts(); return; }
    if (ui.singleKeys) {
      if (!e.repeat && !e.shiftKey && patternKey(e.code)) { e.preventDefault(); return; }
      if (e.code === "Backslash" || e.code === "Minus" || e.code === "Equal") {
        e.preventDefault();
        const target = inRoll() ? roll : timeline;
        if (e.code === "Backslash") { target.fit(); Announce.say(inRoll() ? "Whole clip in view" : "Whole song in view"); }
        else if (e.code === "Minus") target.zoomOut();
        else target.zoomIn();
        return;
      }
      if (ui.keysMode === "edit") {
        if (!e.repeat && editKey(e)) e.preventDefault();
        return; // in Edit mode, letters don't play notes
      }
    }
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
      showActions();
      if (song.selected !== t.id) selectTrack(t.id, false);
      else timeline.render();
      if (announce) Announce.say("Selected " + Song.content(song, clip).name);
      save();
    },
    onOpenClip: (t, clip) => openClip(t, clip, true),
    onNewClip(t, bar) {
      if (t.kind === "audio") { pickSound({ mode: "clip", trackId: t.id, bar }); return; }
      const clip = Song.addClip(song, t, bar, 1);
      if (!clip) { Announce.say("There's already a clip there"); return; }
      selectTrack(t.id, false);
      openClip(t, clip, true);
      Announce.say(`New clip ${Song.content(song, clip).name} at bar ${bar + 1}`);
    },
    onDeleteClip(t, clip) {
      deleteClip(t, clip, `Deleted ${Song.content(song, clip).name}`);
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
    onView: () => { if (tlZoom) tlZoom.draw(); },
    isCollapsed: (id) => ui.collapsed.includes(id),
    // An audio clip's waveform: the sound's outline and length, once loaded.
    soundView(c) {
      const info = c.audio && Samples.info(c.audio.sampleId);
      return info ? { peaks: Samples.peaks(c.audio.sampleId), duration: info.duration, stepSecs: Song.stepSeconds(song, 0) } : null;
    },
    // Notes edited right on the timeline: they're the open clip's notes, so
    // the piano roll and the Note page follow along.
    selectedNotes(c) {
      const o = find(open);
      return o && o.c === c ? selNotes : null;
    },
    onPickNote(t, clip, n, add) {
      const o = find(open);
      if (!o || o.clip.id !== clip.id) openClip(t, clip, false);
      if (add) selNotes.has(n) ? selNotes.delete(n) : selNotes.add(n);
      else if (!selNotes.has(n)) { selNotes.clear(); selNotes.add(n); }
      renderEditor();
      roll.setCursor(n.step, n.midi);
      showActions();
      timeline.render();
      preview(t, n.midi);
      Announce.say(`${Notes.spokenName(n.midi)}, step ${n.step + 1}` + (selNotes.size > 1 ? `, ${selNotes.size} notes selected` : ""));
    },
    onNoteMove(c, n, step, midi) {
      if (song.key.keep && midi !== n.midi) midi = Song.nearestInKey(song, midi, Math.sign(midi - n.midi));
      return Song.moveNote(c, n, step, midi);
    },
    onNoteResize: (c, n, len) => Song.resizeNote(c, n, len),
    onNoteDelete(c, n) {
      selNotes.delete(n);
      Song.removeNotes(c, [n]);
      afterChange(`Deleted ${Notes.spokenName(n.midi)}`);
    },
    onPreview: (t, midi) => preview(t, midi),
    onToggleRow(id) {
      const t = Song.track(song, id);
      ui.collapsed = ui.collapsed.includes(id) ? ui.collapsed.filter((x) => x !== id) : [...ui.collapsed, id];
      timeline.render();
      showRowsFold();
      Announce.say(`${t.name} row ${ui.collapsed.includes(id) ? "collapsed" : "expanded"}`);
      save();
    },
  });

  // After a finished edit (a button, a shortcut, the end of a drag): redraw,
  // and save right away so it's its own undo step.
  function afterChange(text) {
    timeline.render();
    renderEditor();
    showSongStatus();
    showActions();
    renderTempoList();
    if (text) Announce.say(text);
    writeNow();
  }

  // --- zoom bars (Premiere-style) and collapsible rows ---
  tlZoom = ZoomBar.create($("tl-zoombar"), {
    label: "Timeline", unit: (n) => "bar " + n,
    get: () => timeline.getView(), set: (a, b) => timeline.setView(a, b), fit: () => timeline.fit(),
  });
  $("zoom-in").addEventListener("click", () => timeline.zoomIn());
  $("zoom-out").addEventListener("click", () => timeline.zoomOut());
  $("zoom-fit").addEventListener("click", () => { timeline.fit(); Announce.say("Whole song in view"); });

  function showRowsFold() {
    const all = song.tracks.every((t) => ui.collapsed.includes(t.id));
    $("rows-fold").setAttribute("aria-pressed", String(all));
  }
  $("rows-fold").addEventListener("click", () => {
    const collapse = !song.tracks.every((t) => ui.collapsed.includes(t.id));
    ui.collapsed = collapse ? song.tracks.map((t) => t.id) : [];
    timeline.render();
    showRowsFold();
    Announce.say(collapse ? "All rows collapsed" : "All rows expanded");
    save();
  });

  $("new-clip").addEventListener("click", () => {
    const t = sel();
    if (t.kind === "audio") { pickSound({ mode: "clip", trackId: t.id, bar: song.cursor }); return; }
    let bar = song.cursor;
    while (!Song.fits(t, bar, 1)) bar++;
    const clip = Song.addClip(song, t, bar, 1);
    openClip(t, clip, true);
    Announce.say(`New clip ${Song.content(song, clip).name} on ${t.name}, bar ${bar + 1}`);
  });

  // --- the clip editor ---
  const selNotes = new Set(); // notes selected in the open clip (the Note page edits them)

  const roll = PianoRoll.create($("roll"), {
    onAdd(step, midi) {
      const o = find(open);
      if (!o) return null;
      if (song.key.keep) midi = Song.nearestInKey(song, midi);
      const n = Song.addNote(o.c, step, midi, o.t.length);
      if (n) preview(o.t, midi);
      return n;
    },
    onRemove(notes) {
      const o = find(open);
      if (!o) return;
      for (const n of notes) selNotes.delete(n);
      Song.removeNotes(o.c, notes);
      afterChange();
    },
    onMove(n, step, midi) {
      const o = find(open);
      if (o && song.key.keep && midi !== n.midi) midi = Song.nearestInKey(song, midi, Math.sign(midi - n.midi));
      return !!o && Song.moveNote(o.c, n, step, midi);
    },
    onResize(n, len) {
      const o = find(open);
      return o ? Song.resizeNote(o.c, n, len) : n.len;
    },
    onSelect: () => { renderNotePage(); showActions(); },
    onView: () => { if (rollZoom) rollZoom.draw(); },
    onChanged: (text) => afterChange(text),
    onPreview: (midi) => preview(sel(), midi),
    say: (text) => Announce.say(text),
  });

  rollZoom = ZoomBar.create($("roll-zoombar"), {
    label: "Piano roll", unit: (n) => "step " + n,
    get: () => roll.getView(), set: (a, b) => roll.setView(a, b), fit: () => roll.fit(),
  });

  const barsSel = $("clip-bars");
  // Note clips loop 1, 2 or 4 bars; audio clips up to 64 (whatever the sound needs).
  const AUDIO_LOOPS = [1, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
  function fillBarsChoice(c) {
    const want = c.audio ? [...new Set([...AUDIO_LOOPS, c.bars])].sort((a, b) => a - b) : Song.CONTENT_BARS;
    if (barsSel.dataset.kind === (c.audio ? "audio" : "notes") && want.length === barsSel.options.length) return;
    barsSel.dataset.kind = c.audio ? "audio" : "notes";
    barsSel.textContent = "";
    for (const n of want) barsSel.add(new Option(n === 1 ? "1 bar" : n + " bars", n));
  }
  fillBarsChoice({ bars: 1 });
  barsSel.addEventListener("change", () => {
    const o = find(open);
    if (!o) return;
    Song.setContentBars(o.c, Number(barsSel.value));
    afterChange(`${o.c.name} loops ${o.c.bars} bar${o.c.bars > 1 ? "s" : ""}`);
  });

  // Clip length without dragging its edge (WCAG 2.5.7): stops at the next clip.
  const lenField = $("clip-len");
  lenField.addEventListener("change", () => {
    const o = find(open);
    if (!o) return;
    const want = Math.max(1, Math.round(Number(lenField.value)) || 1);
    const got = Song.resizeClip(o.t, o.clip, want);
    lenField.value = got;
    afterChange(`${o.c.name} plays for ${got} bar${got > 1 ? "s" : ""}` + (got < want ? ", up to the next clip" : ""));
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
    selNotes.clear();
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
    selNotes.clear();
    renderEditor();
    save();
  }
  $("close-clip").addEventListener("click", () => { closeClip(); Announce.say("Clip closed"); });

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
    arrange?.refresh(); // an empty clip editor stops sharing the column
    nameField.disabled = barsSel.disabled = lenField.disabled = $("close-clip").disabled = !o;
    if (!o) {
      $("clip-h").textContent = "Clip";
      nameField.value = "";
      selNotes.clear();
      renderNotePage();
      return;
    }
    const { t, clip, c } = o;
    $("clip-body").classList.toggle("audio", !!c.audio);
    fillBarsChoice(c);
    $("clip-h").textContent = "Clip: " + t.name;
    $("clip-editor").style.setProperty("--track", `var(--c-${t.color})`);
    nameField.value = c.name;
    barsSel.value = c.bars;
    if (document.activeElement !== lenField) lenField.value = clip.length;
    const links = Song.linkCount(song, c.id);
    const span = clip.length === 1 ? `bar ${clip.start + 1}` : `bars ${clip.start + 1}–${Song.clipEnd(clip)}`;
    $("clip-status").textContent = `${c.bars}-bar loop · this clip covers ${span}` +
      (clip.length > c.bars ? ", repeating it" : "") +
      (links > 1 ? ` · linked: edits change all ${links} copies` : "");
    if (c.audio) {
      selNotes.clear();
      renderWave(o);
      renderNotePage();
      return;
    }
    for (const n of [...selNotes]) if (!c.notes.includes(n)) selNotes.delete(n);
    roll.render({
      c, color: t.color, name: c.name, steps: c.bars * Song.STEPS, selected: selNotes, snap: song.snap,
      inKey: (m) => Song.inKey(song, m), keySig: `${song.key.root}:${song.key.scale}`,
    });
    lengthSel.value = t.length;
    renderNotePage();
  }

  // --- Note page: the selected notes' length, loudness and pitch ---
  const noteLen = $("note-len"), noteVel = $("note-vel");
  const steps = (n) => `${n} step${n > 1 ? "s" : ""}`;

  function renderNotePage() {
    const list = [...selNotes];
    const o = find(open);
    $("note-controls").hidden = !list.length;
    $("patterns").hidden = !o;
    if (o) $("stamp-row").textContent = Notes.noteName(roll.cursor.midi);
    $("repeat-go").disabled = !list.length;
    for (const b of $("arps").querySelectorAll("button")) b.disabled = list.length < 2;
    if (!o) {
      $("note-sel").textContent = "Open a clip to edit its notes.";
      return;
    }
    if (o.c.audio) {
      $("patterns").hidden = true;
      $("note-sel").textContent = "Audio clips have no notes: trim, fade and reverse them in the clip editor.";
      return;
    }
    if (!list.length) {
      $("note-sel").textContent = "No notes selected. Click a note in the piano roll, or Shift-click to pick several.";
      return;
    }
    const first = list[0];
    $("note-sel").textContent = list.length === 1
      ? `${Notes.noteName(first.midi)} at ${o.c.bars > 1 ? `bar ${Math.floor(first.step / 16) + 1} ` : ""}step ${(first.step % 16) + 1}`
      : `${list.length} notes selected`;
    noteLen.max = o.c.bars * Song.STEPS;
    noteLen.value = first.len;
    noteVel.value = Math.round(first.vel * 100);
    const same = (k) => list.every((n) => n[k] === first[k]);
    $("note-len-out").textContent = same("len") ? steps(first.len) : "mixed";
    $("note-vel-out").textContent = same("vel") ? Math.round(first.vel * 100) + "%" : "mixed";
    noteLen.setAttribute("aria-valuetext", same("len") ? steps(first.len) : `mixed, ${steps(first.len)} on the first`);
    noteVel.setAttribute("aria-valuetext", same("vel") ? Math.round(first.vel * 100) + " percent" : "mixed");
    renderNoteFx(list);
  }

  // Applies a change to every selected note, then redraws.
  function editNotes(fn, text) {
    const o = find(open);
    if (!o || !selNotes.size) return;
    for (const n of selNotes) fn(o.c, n);
    afterChange(text);
  }
  // --- the selected notes' own sound (Song.NOTE_FX) ---
  const signed = (v, unit) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + " " + unit;
  const FX_TEXT = {
    bend: (v) => (v ? signed(v, Math.abs(v) === 1 ? "key" : "keys") : "off"),
    sweep: (v) => (v ? signed(v, Math.abs(v) === 1 ? "key" : "keys") : "off"),
    tune: (v) => (v ? signed(v, "cents") : "in tune"),
    vib: (v) => (v ? v + " cents" : "off"),
    cut: (v) => (v ? signed(v, "octaves") : "as the track"),
    pan: (v) => (v ? (v < 0 ? "left " : "right ") + Math.round(Math.abs(v) * 100) : "center"),
    ratchet: (v) => (v > 1 ? v + " times" : "off"),
    noise: (v) => (v ? Math.round(v * 100) + "%" : "off"),
  };
  const fxViews = {};
  for (const d of Song.NOTE_FX) {
    const wrap = document.createElement("div");
    wrap.className = "ctl";
    wrap.innerHTML = `<div class="ctl-head"><label for="nfx-${d.id}">${d.label}</label>` +
      `<output id="nfx-${d.id}-out" for="nfx-${d.id}" aria-hidden="true"></output></div>` +
      `<input type="range" id="nfx-${d.id}" min="${d.min}" max="${d.max}" step="${d.step}">`;
    const input = wrap.querySelector("input"), out = wrap.querySelector("output");
    if (d.help) {
      const help = document.createElement("p");
      help.id = `nfx-${d.id}-help`;
      help.className = "help tip";
      help.textContent = d.help;
      wrap.append(help);
      input.setAttribute("aria-describedby", help.id);
    }
    input.addEventListener("input", () => editNotes((c, n) => Song.setNoteFx(n, d.id, Number(input.value))));
    input.addEventListener("change", () => hearNotes());
    input.addEventListener("dblclick", () => {
      editNotes((c, n) => Song.setNoteFx(n, d.id, d.def), `${d.label} back to ${FX_TEXT[d.id](d.def)}`);
    });
    fxViews[d.id] = { input, out };
    $("note-fx-ctls").append(wrap);
  }
  function renderNoteFx(list) {
    const first = list[0];
    for (const d of Song.NOTE_FX) {
      const v = Song.noteFx(first, d.id);
      const same = list.every((n) => Song.noteFx(n, d.id) === v);
      const { input, out } = fxViews[d.id];
      if (document.activeElement !== input) input.value = v;
      out.textContent = same ? FX_TEXT[d.id](v) : "mixed";
      input.setAttribute("aria-valuetext", same ? FX_TEXT[d.id](v) : `mixed, ${FX_TEXT[d.id](v)} on the first`);
    }
    $("note-fx-reset").disabled = !list.some((n) => n.fx);
  }
  // Plays the selected notes once, with their own sound, so changes can be heard.
  function hearNotes() {
    const o = find(open);
    if (!o || !selNotes.size || (transport && transport.playing)) return;
    ready().then(() => {
      const first = Math.min(...[...selNotes].map((n) => n.step));
      const dur = Song.stepSeconds(song, 0);
      const now = Engine.ctx.currentTime + 0.03;
      for (const n of selNotes) audio[o.t.id].synth.playNote(n, now + (n.step - first) * dur, dur);
    });
  }
  $("note-fx-hear").addEventListener("click", hearNotes);
  $("note-fx-reset").addEventListener("click", () => {
    editNotes((c, n) => { delete n.fx; }, "Note sound reset to the track's");
  });

  noteLen.addEventListener("input", () => editNotes((c, n) => Song.resizeNote(c, n, Number(noteLen.value))));
  noteVel.addEventListener("input", () => editNotes((c, n) => { n.vel = Number(noteVel.value) / 100; }));
  const transpose = (by, words) => () => {
    const o = find(open);
    if (!o || !selNotes.size) return;
    // Highest first going up (lowest first going down) so notes don't block each other.
    const list = [...selNotes].sort((a, b) => (by > 0 ? b.midi - a.midi : a.midi - b.midi));
    let blocked = 0;
    for (const n of list) if (!Song.moveNote(o.c, n, n.step, n.midi + by)) blocked++;
    afterChange(blocked ? `${words}; ${blocked} couldn't move` : words);
    const first = [...selNotes][0];
    if (first && selNotes.size === 1) preview(o.t, first.midi);
  };
  $("note-up").addEventListener("click", transpose(1, "Up a key"));
  $("note-down").addEventListener("click", transpose(-1, "Down a key"));
  $("note-oct-up").addEventListener("click", transpose(12, "Up an octave"));
  $("note-oct-down").addEventListener("click", transpose(-12, "Down an octave"));
  $("note-delete").addEventListener("click", () => {
    const o = find(open);
    if (!o || !selNotes.size) return;
    const n = selNotes.size;
    Song.removeNotes(o.c, [...selNotes]);
    selNotes.clear();
    afterChange(`Deleted ${n} note${n > 1 ? "s" : ""}`);
  });

  // --- adding sound files: a clip on an audio track, or a synth track's instrument ---
  // job: { mode: "clip" | "sampler" | "replace", trackId, bar, contentId }
  const soundInput = $("sound-input");
  let soundJob = null;
  function pickSound(job) {
    soundJob = job;
    soundInput.click();
  }
  soundInput.addEventListener("change", () => {
    const files = [...(soundInput.files || [])];
    soundInput.value = "";
    if (files.length && soundJob) addSoundFiles(files, soundJob);
  });
  async function addSoundFiles(files, job) {
    const t = Song.track(song, job.trackId);
    let bar = job.bar || 0, added = 0, last = null;
    for (const file of job.mode === "clip" ? files : files.slice(0, 1)) {
      Announce.say(`Loading ${file.name}…`);
      let id;
      try { id = await Samples.add(file); } catch (e) {
        Announce.say(`Couldn't read ${file.name} as a sound. Try a .wav or .mp3 file.`);
        continue;
      }
      const info = Samples.info(id);
      if (job.mode === "sampler") {
        t.sampler = Song.cleanSampler({ sampleId: id, root: 60 });
        applySampler(t);
        selectTrack(t.id, false);
        afterChange(`${t.name} now plays ${info.name}, at its own pitch on C4`);
        return;
      }
      if (job.mode === "replace") {
        const c = song.contents[job.contentId];
        if (!c || !c.audio) return;
        c.audio = { ...c.audio, sampleId: id, start: 0, end: null };
        c.name = info.name;
        afterChange(`Clip now plays ${info.name}`);
        return;
      }
      const clip = Song.addAudioClip(song, t, bar, id, info.name, info.duration);
      if (!clip) continue;
      added++;
      last = clip;
      bar = Song.clipEnd(clip);
    }
    if (last) {
      openClip(t, last, false);
      picked = { trackId: t.id, clipId: last.id };
      afterChange(added > 1 ? `Added ${added} sounds to ${t.name}` : `Added ${Song.content(song, last).name} to ${t.name} at bar ${last.start + 1}`);
    }
  }
  // Files dropped on the timeline: on an audio row they become clips where
  // they land; on a synth row the first becomes its instrument.
  const tlEl = $("timeline");
  tlEl.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer.types || [])].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    tlEl.classList.add("dropping");
  });
  tlEl.addEventListener("dragleave", (e) => { if (!tlEl.contains(e.relatedTarget)) tlEl.classList.remove("dropping"); });
  tlEl.addEventListener("drop", (e) => {
    tlEl.classList.remove("dropping");
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest(".tl-row");
    const t = lane ? Song.track(song, lane.dataset.track) : sel();
    const laneEl = lane && lane.querySelector(".tl-lane");
    const bw = parseFloat(getComputedStyle(tlEl.querySelector(".tl")).getPropertyValue("--bar-w")) || 60;
    const bar = laneEl ? Math.max(0, Math.floor((e.clientX - laneEl.getBoundingClientRect().left) / bw)) : song.cursor;
    addSoundFiles(files, { mode: t.kind === "audio" ? "clip" : "sampler", trackId: t.id, bar });
  });

  // --- Sound page: the instrument (synth or a sound file) ---
  const instRoot = $("inst-root");
  for (let m = Song.LOWEST; m <= Song.HIGHEST; m++) instRoot.add(new Option(Notes.noteName(m), m));
  function renderSoundPage() {
    const t = sel();
    const isAudio = t.kind === "audio";
    $("audio-track-note").hidden = !isAudio;
    $("instrument").hidden = isAudio;
    document.querySelector("#p-sound .preset").hidden = isAudio;
    document.querySelector("#p-sound .morph-box:not(#instrument)").hidden = isAudio;
    if (isAudio) return;
    const s = t.sampler, info = s && Samples.info(s.sampleId);
    $("inst-now").textContent = !s ? "The synth (pick a preset below)" : info ? `Sound file: ${info.name} (${info.duration.toFixed(2)} s)`
      : Samples.isMissing(s.sampleId) ? "Sound file (not in this browser: import the song file that has it)" : "Sound file (loading…)";
    $("inst-synth").hidden = !s;
    $("inst-sample").hidden = !s;
    if (!s) return;
    $("inst-root").value = s.root;
    const keep = (el, v) => { if (document.activeElement !== el) el.value = v; };
    keep($("inst-start"), s.start);
    keep($("inst-end"), s.end == null ? (info ? +info.duration.toFixed(3) : "") : s.end);
    keep($("inst-gain"), s.gain);
    $("inst-reverse").checked = s.reverse;
  }
  function editSampler(fn, text) {
    const t = sel();
    if (!t.sampler) return;
    fn(t.sampler);
    t.sampler = Song.cleanSampler(t.sampler);
    applySampler(t);
    renderSoundPage();
    afterChange(text);
  }
  $("inst-load").addEventListener("click", () => pickSound({ mode: "sampler", trackId: sel().id }));
  $("inst-synth").addEventListener("click", () => {
    const t = sel();
    t.sampler = null;
    applySampler(t);
    renderSoundPage();
    afterChange(`${t.name} plays the synth again`);
  });
  instRoot.addEventListener("change", () => editSampler((s) => { s.root = Number(instRoot.value); }, `Plays at its own pitch on ${Notes.spokenName(Number(instRoot.value))}`));
  $("inst-start").addEventListener("change", (e) => editSampler((s) => { s.start = Number(e.target.value) || 0; }, "Start moved"));
  $("inst-end").addEventListener("change", (e) => editSampler((s) => { s.end = e.target.value === "" ? null : Number(e.target.value); }, "End moved"));
  $("inst-gain").addEventListener("change", (e) => editSampler((s) => { s.gain = Number(e.target.value) || 0; }, `Gain ${Number(e.target.value) || 0} dB`));
  $("inst-reverse").addEventListener("change", (e) => editSampler((s) => { s.reverse = e.target.checked; }, e.target.checked ? "Reversed" : "Forwards"));

  // --- the wave editor: an open audio clip's trim, fades, gain, reverse, fit ---
  const waveEl = $("wave");
  const WAVE_FIELDS = { "wave-start": "start", "wave-end": "end", "wave-fadein": "fadeIn", "wave-fadeout": "fadeOut", "wave-gain": "gain" };
  function renderWave(o) {
    const a = o.c.audio, info = Samples.info(a.sampleId);
    const dur = info ? info.duration : 0;
    const end = a.end == null ? dur : Math.min(a.end, dur);
    const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    keep("wave-start", +a.start.toFixed(3));
    keep("wave-end", +end.toFixed(3));
    keep("wave-fadein", Math.round(a.fadeIn * 1000));
    keep("wave-fadeout", Math.round(a.fadeOut * 1000));
    keep("wave-gain", a.gain);
    $("wave-start").max = $("wave-end").max = +dur.toFixed(3);
    $("wave-reverse").setAttribute("aria-pressed", String(a.reverse));
    $("wave-fit").setAttribute("aria-pressed", String(a.fit));
    const loopSecs = o.c.bars * Song.STEPS * Song.stepSeconds(song, o.clip.start * Song.STEPS);
    const trimmed = Math.max(0, end - a.start);
    $("wave-status").textContent = !info ? (Samples.isMissing(a.sampleId) ? "This sound isn't in this browser. Import the song file that has it, or Replace sound." : "Loading the sound…")
      : `${info.name}: ${dur.toFixed(2)} s, playing ${trimmed.toFixed(2)} s` +
        (a.fit ? `, fitted to the ${o.c.bars}-bar loop (${(trimmed / loopSecs).toFixed(2)}× speed)`
          : trimmed > loopSecs + 0.01 ? `; the ${o.c.bars}-bar loop (${loopSecs.toFixed(2)} s) cuts it short` : "");
    drawWave(o, dur);
  }
  // The whole sound, dimmed, with the trimmed part bright, fades as slopes,
  // and handles to drag: the trim edges and the fade corners.
  function drawWave(o, dur) {
    const a = o.c.audio, peaks = Samples.peaks(a.sampleId);
    const waveEl = $("wave");
    waveEl.textContent = "";
    waveEl.style.setProperty("--track", `var(--c-${o.t.color})`);
    if (!peaks || !dur) return;
    const W = 1000, H = 100, n = peaks.length / 2;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    let top = "", bottom = "";
    for (let i = 0; i < n; i++) {
      const k = a.reverse ? n - 1 - i : i; // reversed, the outline reads backwards
      const x = (i / (n - 1)) * W;
      top += `${x.toFixed(1)},${(H / 2 - peaks[k * 2 + 1] * H / 2).toFixed(1)} `;
      bottom = `${x.toFixed(1)},${(H / 2 - peaks[k * 2] * H / 2).toFixed(1)} ` + bottom;
    }
    const shape = document.createElementNS(ns, "polygon");
    shape.setAttribute("points", top + bottom);
    shape.setAttribute("class", "wave-shape");
    svg.append(shape);
    waveEl.append(svg);
    const end = a.end == null ? dur : Math.min(a.end, dur);
    // In the reversed view the trim shows mirrored, where it plays from.
    const x0 = (a.reverse ? dur - end : a.start) / dur, x1 = (a.reverse ? dur - a.start : end) / dur;
    const part = document.createElement("div");
    part.className = "wave-part";
    part.style.left = x0 * 100 + "%";
    part.style.width = (x1 - x0) * 100 + "%";
    // The view reads in playing order, so the fade in is always on the left.
    const len = end - a.start || 1;
    const fiW = a.fadeIn / len, foW = a.fadeOut / len;
    part.innerHTML = `<span class="wave-fade in" style="width:${Math.min(50, fiW * 100)}%"></span>` +
      `<span class="wave-fade out" style="width:${Math.min(50, foW * 100)}%"></span>` +
      `<span class="wave-edge" data-drag="${a.reverse ? "end" : "start"}"></span>` +
      `<span class="wave-edge right" data-drag="${a.reverse ? "start" : "end"}"></span>` +
      `<span class="wave-knob" data-drag="fadeIn" style="left:${Math.min(50, fiW * 100)}%"></span>` +
      `<span class="wave-knob right" data-drag="fadeOut" style="right:${Math.min(50, foW * 100)}%"></span>`;
    waveEl.append(part);
  }
  function editAudio(fn, text) {
    const o = find(open);
    if (!o || !o.c.audio) return;
    fn(o.c.audio, o);
    o.c.audio = Song.cleanAudio(o.c.audio) || o.c.audio;
    afterChange(text);
  }
  for (const [id, key] of Object.entries(WAVE_FIELDS)) {
    $(id).addEventListener("change", (e) => {
      const raw = e.target.value;
      editAudio((a) => {
        const v = Number(raw);
        if (key === "end") a.end = raw === "" ? null : v;
        else if (key === "fadeIn" || key === "fadeOut") a[key] = (v || 0) / 1000;
        else a[key] = v || 0;
      }, `${e.target.closest("label").firstChild.textContent.trim()} ${raw || "reset"}`);
    });
  }
  $("wave-reverse").addEventListener("click", () => editAudio((a) => { a.reverse = !a.reverse; }, "Reverse " + ($("wave-reverse").getAttribute("aria-pressed") === "true" ? "off" : "on")));
  $("wave-fit").addEventListener("click", () => editAudio((a) => { a.fit = !a.fit; }, "Fit to tempo " + ($("wave-fit").getAttribute("aria-pressed") === "true" ? "off" : "on")));
  $("wave-fill").addEventListener("click", () => editAudio((a, o) => {
    const info = Samples.info(a.sampleId);
    if (!info) return;
    const end = a.end == null ? info.duration : a.end;
    const bars = Song.barsFor(song, end - a.start);
    Song.setContentBars(o.c, bars);
    if (o.clip.length < bars) Song.resizeClip(o.t, o.clip, bars);
  }, "The loop now covers the whole sound"));
  $("wave-replace").addEventListener("click", () => {
    const o = find(open);
    if (o) pickSound({ mode: "replace", trackId: o.t.id, contentId: o.c.id });
  });
  $("wave-hear").addEventListener("click", () => {
    const o = find(open);
    if (!o || !o.c.audio || (transport && transport.playing)) return;
    ready().then(() => {
      const from = o.clip.start * Song.STEPS;
      const seg = Song.audioSegment(song, o.t, from, from, soundSecs, Song.stepSeconds(song, from));
      if (seg) audio[o.t.id].synth.playAudio(Samples.buffer(seg.sampleId, seg.reverse), seg, Engine.ctx.currentTime + 0.03);
    });
  });
  // Dragging the trim edges and the fade knobs.
  waveEl.addEventListener("pointerdown", (e) => {
    const what = e.target.dataset && e.target.dataset.drag;
    const o = find(open);
    if (!what || !o || !o.c.audio) return;
    const info = Samples.info(o.c.audio.sampleId);
    if (!info) return;
    e.preventDefault();
    waveEl.setPointerCapture(e.pointerId);
    const box = waveEl.getBoundingClientRect(), dur = info.duration, a = o.c.audio;
    const flip = (x) => (a.reverse ? dur - x : x); // screen position -> time in the sound
    const move = (ev) => {
      const q = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)) * dur; // seconds along the view
      const t = flip(q); // ...and in the sound itself
      const end = a.end == null ? dur : a.end;
      // The trimmed part as it shows (in playing order): fades are measured from its edges.
      const v0 = a.reverse ? dur - end : a.start, v1 = a.reverse ? dur - a.start : end, half = (end - a.start) / 2;
      if (what === "start") a.start = Math.max(0, Math.min(t, end - 0.01));
      else if (what === "end") a.end = Math.min(dur, Math.max(t, a.start + 0.01));
      else if (what === "fadeIn") a.fadeIn = Math.max(0, Math.min(q - v0, half));
      else a.fadeOut = Math.max(0, Math.min(v1 - q, half));
      renderWave(o);
      timeline.render();
    };
    const up = () => {
      waveEl.removeEventListener("pointermove", move);
      editAudio(() => {}, what === "start" || what === "end" ? `Trimmed: ${a.start.toFixed(2)} to ${(a.end == null ? dur : a.end).toFixed(2)} seconds`
        : `Fade ${what === "fadeIn" ? "in" : "out"} ${Math.round(a[what] * 1000)} ms`);
    };
    waveEl.addEventListener("pointermove", move);
    waveEl.addEventListener("pointerup", up, { once: true });
    waveEl.addEventListener("pointercancel", up, { once: true });
  });

  // --- undo / redo ---
  function showUndo() {
    $("undo").disabled = !history.canUndo;
    $("redo").disabled = !history.canRedo;
  }

  // Puts a saved version of the song back and redraws everything from it.
  function restore(json) {
    applySong(Song.sanitize({ ...JSON.parse(json), selected: song.selected, cursor: song.cursor }));
    history.sync(historyJson());
    writeNowQuiet();
  }

  // Swaps the whole song (an undo step, or another song from the library)
  // and redraws everything: the audio, the mixer, every panel.
  function applySong(next) {
    endTake();
    panic();
    for (const k of Object.keys(song)) delete song[k];
    Object.assign(song, next);
    selNotes.clear();
    if (!find(open)) open = null;
    if (!find(picked)) picked = null;
    tempo.value = song.bpm;
    titleField.value = song.title;
    showTitle();
    for (const t of song.tracks) {
      if (!audio[t.id]) continue;
      audio[t.id].synth.load(live(t));
      audio[t.id].synth.setTempo(song.bpm);
      applySampler(t);
    }
    syncAudio();
    loadSounds();
    rebuildMixer();
    applyMix();
    selectTrack(song.selected, false);
    showLoop();
    renderTempoList();
    renderSongPage();
  }
  // Saves without adding a history step (after undo / redo).
  function writeNowQuiet() {
    library.save(songId, JSON.stringify(song));
    showUndo();
  }

  function undo() {
    if (saveTimer) writeNow(); // a change still waiting to be saved counts first
    const json = history.undo();
    if (json === null) { Announce.say("Nothing to undo"); return; }
    restore(json);
    Announce.say("Undone");
  }
  function redo() {
    if (saveTimer) writeNow();
    const json = history.redo();
    if (json === null) { Announce.say("Nothing to redo"); return; }
    restore(json);
    Announce.say("Redone");
  }
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);

  // --- copy, paste and friends ---
  let clipboard = null; // { kind: "clip" | "notes", ... }
  const rollEl = $("roll");
  const inRoll = () => document.activeElement === rollEl;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Notes in the open clip
  function notesSelectAll() {
    const o = find(open);
    if (!o) return;
    selNotes.clear();
    for (const n of o.c.notes) selNotes.add(n);
    renderEditor();
    Announce.say(`Selected all ${plural(selNotes.size, "note")}`);
  }
  function notesCopy(cut) {
    const o = find(open);
    if (!o || !selNotes.size) { Announce.say("Select notes to copy first"); return; }
    clipboard = Song.copyNotes([...selNotes]);
    const n = selNotes.size;
    if (cut) {
      Song.removeNotes(o.c, [...selNotes]);
      selNotes.clear();
      afterChange(`Cut ${plural(n, "note")}`);
    } else {
      Announce.say(`Copied ${plural(n, "note")}`);
    }
    showActions();
  }
  function notesPaste() {
    const o = find(open);
    if (!o || !clipboard || clipboard.kind !== "notes") return false;
    const at = roll.cursor.step;
    const added = Song.pasteNotes(o.c, clipboard, at);
    selNotes.clear();
    for (const n of added) selNotes.add(n);
    afterChange(added.length ? `Pasted ${plural(added.length, "note")} at ${roll.where(at)}` : "No room to paste there");
    return true;
  }
  function notesDuplicate() {
    const o = find(open);
    if (!o || !selNotes.size) { Announce.say("Select notes to duplicate first"); return; }
    const added = Song.duplicateNotes(o.c, [...selNotes]);
    selNotes.clear();
    for (const n of added) selNotes.add(n);
    afterChange(added.length ? `Duplicated ${plural(added.length, "note")}` : "No room after them in the loop");
  }
  $("notes-all").addEventListener("click", notesSelectAll);
  $("notes-copy").addEventListener("click", () => notesCopy(false));
  $("notes-cut").addEventListener("click", () => notesCopy(true));
  $("notes-paste").addEventListener("click", () => { if (!notesPaste()) Announce.say("Copy some notes first"); });
  $("notes-dup").addEventListener("click", notesDuplicate);

  // Clips on the timeline
  const pickedClip = () => find(picked);
  function clipCopy(cut) {
    const p = pickedClip();
    if (!p) { Announce.say("Select a clip first"); return; }
    clipboard = Song.copyClip(song, p.clip);
    if (cut) deleteClip(p.t, p.clip, `Cut ${p.c.name}`);
    else Announce.say(`Copied ${p.c.name}`);
    showActions();
  }
  function clipPaste() {
    if (!clipboard || clipboard.kind !== "clip") return false;
    const t = sel();
    const clip = Song.pasteClip(song, t, clipboard, song.cursor);
    if (!clip) {
      Announce.say(clipboard.audio ? "Audio clips paste onto audio tracks only" : "Note clips paste onto synth tracks only");
      return true;
    }
    picked = { trackId: t.id, clipId: clip.id };
    afterChange(`Pasted ${Song.content(song, clip).name} on ${t.name} at bar ${clip.start + 1}`);
    timeline.focusClip(clip);
    return true;
  }
  function clipDuplicate(linked) {
    const p = pickedClip();
    if (!p) { Announce.say("Select a clip first"); return; }
    const copy = Song.duplicateClip(song, p.t, p.clip, linked);
    picked = { trackId: p.t.id, clipId: copy.id };
    afterChange(`${linked ? "Linked copy" : "Copy"} of ${p.c.name} at bar ${copy.start + 1}`);
    timeline.focusClip(copy);
  }
  function deleteClip(t, clip, text) {
    const i = t.clips.indexOf(clip);
    if (open && open.clipId === clip.id) closeClip();
    Song.removeClip(song, t, clip);
    picked = null;
    afterChange(text);
    const next = t.clips[i] || t.clips[i - 1];
    if (next) timeline.focusClip(next);
  }
  $("clip-copy").addEventListener("click", () => clipCopy(false));
  $("clip-cut").addEventListener("click", () => clipCopy(true));
  $("clip-paste").addEventListener("click", () => { if (!clipPaste()) Announce.say("Copy a clip first"); });
  $("clip-dup").addEventListener("click", () => clipDuplicate(false));
  $("clip-link").addEventListener("click", () => clipDuplicate(true));
  $("clip-delete").addEventListener("click", () => {
    const p = pickedClip();
    if (p) deleteClip(p.t, p.clip, `Deleted ${p.c.name}`);
    else Announce.say("Select a clip first");
  });

  // Sections: the loop range, across every track
  const range = () => `bars ${song.loop.start + 1} to ${song.loop.end}`;
  function afterSection(text) {
    if (open && !find(open)) closeClip();
    if (picked && !find(picked)) picked = null;
    showLoop();
    afterChange(text);
  }
  $("sec-dup").addEventListener("click", () => {
    const words = range();
    Song.duplicateBars(song, song.loop.start, song.loop.end);
    afterSection(`Duplicated ${words}`);
  });
  $("sec-insert").addEventListener("click", () => {
    const bar = song.cursor;
    Song.insertBars(song, bar, 1);
    afterSection(`Inserted an empty bar at bar ${bar + 1}`);
  });
  $("sec-delete").addEventListener("click", () => {
    const words = range();
    Song.deleteBars(song, song.loop.start, song.loop.end);
    afterSection(`Deleted ${words}`);
  });

  // Which buttons can do something right now
  function showActions() {
    const p = pickedClip();
    for (const id of ["clip-copy", "clip-cut", "clip-dup", "clip-link", "clip-delete"]) $(id).disabled = !p;
    $("clip-paste").disabled = !(clipboard && clipboard.kind === "clip");
    const o = find(open);
    $("notes-all").disabled = !o || !o.c.notes.length;
    for (const id of ["notes-copy", "notes-cut", "notes-dup"]) $(id).disabled = !o || !selNotes.size;
    $("notes-paste").disabled = !o || !(clipboard && clipboard.kind === "notes");
  }

  // Keyboard shortcuts with Ctrl (or Cmd). Notes when the piano roll has
  // focus, clips otherwise. Returns whether it handled the keys.
  function shortcut(e) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { undo(); return true; }
    if (k === "y" || (k === "z" && e.shiftKey)) { redo(); return true; }
    if (k === "e") { setKeysMode(ui.keysMode === "edit" ? "play" : "edit", true); return true; }
    if (k === "l" && e.shiftKey) { setArranging(!arrange.arranging); return true; }
    if (k === "r" && find(open) && selNotes.size) { repeatSelected(); return true; }
    return editAction(k, e.shiftKey);
  }

  // Copy / cut / paste / duplicate / select all: notes when the piano roll
  // has focus, clips otherwise. Shared by the Ctrl shortcuts and Edit mode.
  function editAction(k, shift) {
    if (inRoll()) {
      if (k === "a") { notesSelectAll(); return true; }
      if (k === "c") { notesCopy(false); return true; }
      if (k === "x") { notesCopy(true); return true; }
      if (k === "v") { if (!notesPaste()) clipPaste(); return true; }
      if (k === "d") { notesDuplicate(); return true; }
      return false;
    }
    if (k === "c" && pickedClip()) { clipCopy(false); return true; }
    if (k === "x" && pickedClip()) { clipCopy(true); return true; }
    if (k === "v") { if (!clipPaste()) notesPaste(); return true; }
    if (k === "d" && pickedClip()) { clipDuplicate(shift); return true; }
    return false;
  }

  // Edit mode: single letters edit. Returns whether the key did something.
  function editKey(e) {
    const k = e.key.toLowerCase();
    if (k === "r" && e.shiftKey) { recBtn.click(); return true; }
    if (k === "r") { repeatSelected(); return true; }
    if ("cxvda".includes(k) && k.length === 1) { if (!editAction(k, e.shiftKey)) Announce.say("Select something first"); return true; }
    if (k === "m") { $("metronome").click(); return true; }
    if (k === "l") { $("loop").click(); return true; }
    if (k === "n") { $("new-clip").click(); return true; }
    if (k === "b") { $("step-input").click(); return true; }
    if (k === "delete" || k === "backspace") {
      // The piano roll and the playing box handle Delete themselves.
      if (inRoll() || (e.target.closest && e.target.closest("#timeline"))) return false;
      if (find(open) && selNotes.size) { $("note-delete").click(); return true; }
      if (pickedClip()) { $("clip-delete").click(); return true; }
    }
    return false;
  }

  // --- Play / Edit keys, and the shortcut list ---
  function setKeysMode(mode, announce) {
    ui.keysMode = mode;
    $("keys-" + mode).checked = true;
    document.documentElement.dataset.keys = mode;
    if (mode === "edit") panic();
    if (announce) Announce.say(mode === "edit" ? "Keys edit: letters are shortcuts now" : "Keys play notes");
    save();
  }
  for (const mode of ["play", "edit"]) {
    $("keys-" + mode).addEventListener("change", (e) => { if (e.target.checked) setKeysMode(mode, true); });
  }

  const shortcutsDlg = $("shortcuts");
  function openShortcuts() {
    if ($("settings").open) $("settings").close();
    shortcutsDlg.showModal();
  }
  $("shortcuts-btn").addEventListener("click", openShortcuts);
  $("settings-shortcuts").addEventListener("click", openShortcuts);
  $("shortcuts-close").addEventListener("click", () => shortcutsDlg.close());
  shortcutsDlg.addEventListener("click", (e) => { if (e.target === shortcutsDlg) shortcutsDlg.close(); });

  const singleKeys = $("single-keys");
  singleKeys.addEventListener("change", () => {
    ui.singleKeys = singleKeys.checked;
    if (!ui.singleKeys) setKeysMode("play", false);
    Announce.say(ui.singleKeys ? "Single-key shortcuts on" : "Single-key shortcuts off: only Ctrl shortcuts work");
    save();
  });

  // --- MIDI keyboard (src/ui/midi.js): opt-in, since the browser asks first ---
  const midiBox = $("midi-in"), midiStatus = $("midi-status");
  let midiLink = null;
  const midiWords = (names) => names.length
    ? `Connected: ${names.join(", ")}. Its keys play the selected track.`
    : "On, but no MIDI keyboard is plugged in yet. Plug one in and it connects by itself.";
  async function setMidi(on, announce) {
    if (midiLink) { midiLink.stop(); midiLink = null; }
    ui.midi = on;
    midiBox.checked = on;
    if (!on) { midiStatus.textContent = "Off."; if (announce) Announce.say("MIDI keyboard off"); save(); return; }
    if (!Midi.supported) {
      ui.midi = false; midiBox.checked = false;
      midiStatus.textContent = "This browser can't use MIDI keyboards. Chrome and Edge can.";
      if (announce) Announce.say(midiStatus.textContent);
      save();
      return;
    }
    try {
      midiLink = await Midi.connect({
        onOn: (m) => noteOn(m),
        onOff: (m) => noteOff(m),
        onStatus: (names) => { midiStatus.textContent = midiWords(names); },
      });
      if (announce) Announce.say(midiWords(midiLink.inputs));
    } catch (e) {
      ui.midi = false; midiBox.checked = false;
      midiStatus.textContent = "The browser didn't allow MIDI. You can allow it in the site settings, then try again.";
      if (announce) Announce.say(midiStatus.textContent);
    }
    save();
  }
  midiBox.addEventListener("change", () => setMidi(midiBox.checked, true));
  if (ui.midi) setMidi(true, false);
  else midiBox.checked = false;

  // --- step input: play a key and it goes in at the piano roll's cursor ---
  const stepBtn = $("step-input");
  stepBtn.addEventListener("click", () => {
    const on = stepBtn.getAttribute("aria-pressed") !== "true";
    stepBtn.setAttribute("aria-pressed", String(on));
    Announce.say(on ? "Step input on: play keys to write notes at the cursor" : "Step input off");
  });
  let chord = null; // { step, held, names } while keys are down
  const stepMode = () => !!find(open) && !take && (stepBtn.getAttribute("aria-pressed") === "true" || inRoll());

  function stepNoteOn(m) {
    if (!stepMode()) return;
    const o = find(open);
    if (!chord) {
      chord = { step: roll.cursor.step, held: 0, names: [], added: [] };
      selNotes.clear();
    }
    chord.held++;
    const n = Song.addNote(o.c, chord.step, m, o.t.length);
    if (n) { chord.added.push(n); chord.names.push(Notes.spokenName(m)); selNotes.add(n); }
    renderEditor();
    timeline.render();
  }

  function stepNoteOff() {
    if (!chord) return;
    if (--chord.held > 0) return;
    const done = chord;
    chord = null;
    const o = find(open);
    if (!o) return;
    const at = roll.where(done.step);
    roll.setCursor(done.step + o.t.length, done.added.length ? done.added.at(-1).midi : undefined);
    afterChange(done.names.length ? `${done.names.join(", ")} at ${at}` : `Nothing added at ${at}: a note already starts there`);
  }

  // --- tempo tools: tap, metronome, count-in, tempo changes ---
  const taps = [];
  $("tap").addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps.at(-1) > 2000) taps.length = 0; // a pause starts over
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length < 2) { Announce.say("Keep tapping"); return; }
    const gaps = taps.slice(1).map((t, i) => t - taps[i]);
    const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    Song.setTempo(song, 0, bpm);
    tempo.value = song.bpm;
    for (const id in audio) audio[id].synth.setTempo(song.bpm);
    timeline.render();
    renderTempoList();
    Announce.say(`${song.bpm} BPM`);
    save();
  });

  const metroBtn = $("metronome"), countBtn = $("count-in");
  function showTempoTools() {
    metroBtn.setAttribute("aria-pressed", String(!!ui.metronome));
    countBtn.setAttribute("aria-pressed", String(!!ui.countIn));
    // The Tempo menu's button shows a dot while the metronome is on.
    document.querySelector('[popovertarget="tempo-menu"]').classList.toggle("lit", !!ui.metronome);
  }

  // --- Section and Tempo menus (popovers): they open under their button,
  // and an action closes its menu (toggles like Metronome leave it open) ---
  // Older browsers (iOS before 17) have no popovers: the button opens and
  // closes the menu itself, and it sits under the button in the page.
  const hasPopover = typeof HTMLElement.prototype.showPopover === "function";
  for (const menu of document.querySelectorAll(".menu[popover]")) {
    const btn = document.querySelector(`[popovertarget="${menu.id}"]`);
    if (!hasPopover) {
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", menu.id);
      btn.addEventListener("click", () => {
        const open = !menu.classList.contains("open");
        menu.classList.toggle("open", open);
        btn.setAttribute("aria-expanded", String(open));
      });
      menu.hidePopover = () => { menu.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
      menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu.hidePopover(); btn.focus(); } });
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b && !b.hasAttribute("aria-pressed") && b.parentElement === menu && b.id !== "tap" && b.id !== "tempo-add") { menu.hidePopover(); btn.focus(); }
      });
      continue;
    }
    menu.addEventListener("toggle", (e) => {
      if (e.newState !== "open") return;
      const r = btn.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
      const below = r.bottom + 4;
      menu.style.top = (below + menu.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - menu.offsetHeight - 4) : below) + "px";
      menu.querySelector("button")?.focus();
    });
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b && !b.hasAttribute("aria-pressed") && b.parentElement === menu && b.id !== "tap" && b.id !== "tempo-add") {
        menu.hidePopover();
        btn.focus();
      }
    });
  }
  metroBtn.addEventListener("click", () => {
    ui.metronome = !ui.metronome;
    showTempoTools();
    Announce.say(ui.metronome ? "Metronome on" : "Metronome off");
    save();
  });
  countBtn.addEventListener("click", () => {
    ui.countIn = !ui.countIn;
    showTempoTools();
    Announce.say(ui.countIn ? "Count-in on: recording starts after one bar of clicks" : "Count-in off");
    save();
  });

  $("tempo-add").addEventListener("click", () => {
    const bar = song.cursor;
    if (bar === 0) { tempo.focus(); Announce.say("Bar 1 uses the main tempo, in the transport"); return; }
    Song.setTempo(song, bar, Math.round(Song.bpmAt(song, bar * Song.STEPS)));
    afterChange(`Tempo change at bar ${bar + 1}`);
    $("tempo-list").querySelector(`[data-bar="${bar}"] input[type=number]`)?.focus();
  });

  // The tempo changes as a list: bar, BPM, ramp, remove.
  function renderTempoList() {
    const list = $("tempo-list");
    list.textContent = "";
    for (const m of song.tempos) {
      const li = document.createElement("li");
      li.dataset.bar = m.bar;
      const id = "tempo-bar-" + m.bar;
      li.innerHTML =
        `<label for="${id}">Bar ${m.bar + 1}</label>` +
        `<input id="${id}" type="number" inputmode="numeric" min="${Song.BPM.min}" max="${Song.BPM.max}" step="1" value="${m.bpm}" aria-label="Tempo at bar ${m.bar + 1}">` +
        `<span aria-hidden="true">BPM</span>` +
        `<label class="check"><input type="checkbox" ${m.ramp ? "checked" : ""}> Ramp into it</label>` +
        `<button type="button" class="quiet" aria-label="Remove the tempo change at bar ${m.bar + 1}">Remove</button>`;
      li.querySelector("input[type=number]").addEventListener("change", (e) => {
        Song.setTempo(song, m.bar, Number(e.target.value), m.ramp);
        afterChange(`Bar ${m.bar + 1}: ${m.bpm} BPM`);
      });
      li.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
        Song.setTempo(song, m.bar, m.bpm, e.target.checked);
        afterChange(e.target.checked ? `Tempo ramps up to bar ${m.bar + 1}` : `Tempo jumps at bar ${m.bar + 1}`);
      });
      li.querySelector("button").addEventListener("click", () => {
        Song.removeTempo(song, m.bar);
        afterChange(`Removed the tempo change at bar ${m.bar + 1}`);
        $("tempo-add").focus();
      });
      list.append(li);
    }
    list.hidden = !song.tempos.length;
  }

  // --- Track page: name, color, order, remove, add ---
  const trackName = $("track-name");
  const COLOR_NAMES = { orange: "Orange", mint: "Mint", sky: "Sky", violet: "Violet", rose: "Rose", lime: "Lime", gold: "Gold", coral: "Coral" };
  for (const c of Song.COLORS) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "track-color";
    input.id = "track-color-" + c;
    input.value = c;
    const label = document.createElement("label");
    label.htmlFor = input.id;
    label.innerHTML = `<span class="theme-swatch" style="background: var(--c-${c})"></span>${COLOR_NAMES[c]}`;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      sel().color = c;
      selectTrack(song.selected, false);
      afterChange(`${sel().name} is ${COLOR_NAMES[c].toLowerCase()}`);
    });
    $("track-colors").append(input, label);
  }

  function renderTrackPage() {
    const t = sel();
    if (document.activeElement !== trackName) trackName.value = t.name;
    for (const c of Song.COLORS) $("track-color-" + c).checked = t.color === c;
    const i = song.tracks.indexOf(t);
    $("track-up").disabled = i === 0;
    $("track-down").disabled = i === song.tracks.length - 1;
    $("track-remove").disabled = song.tracks.length <= 1;
    $("track-add").disabled = $("track-add-audio").disabled = song.tracks.length >= Song.MAX_TRACKS;
    $("track-count").textContent = `${song.tracks.length} of ${Song.MAX_TRACKS} tracks.`;
  }

  trackName.addEventListener("change", () => {
    const t = sel();
    const name = trackName.value.trim().slice(0, 24);
    if (!name) { trackName.value = t.name; return; }
    t.name = name;
    rebuildMixer();
    selectTrack(t.id, false);
    afterChange(`Renamed to ${name}`);
  });
  const moveSelected = (dir) => {
    const t = sel();
    if (!Song.moveTrack(song, t.id, dir)) return;
    rebuildMixer();
    selectTrack(t.id, false);
    afterChange(`${t.name} moved ${dir < 0 ? "up" : "down"}`);
  };
  $("track-up").addEventListener("click", () => moveSelected(-1));
  $("track-down").addEventListener("click", () => moveSelected(1));
  $("track-remove").addEventListener("click", () => {
    const t = sel();
    if (open && open.trackId === t.id) closeClip();
    if (picked && picked.trackId === t.id) picked = null;
    if (!Song.removeTrack(song, t.id)) return;
    syncAudio();
    rebuildMixer();
    selectTrack(song.selected, false);
    afterChange(`Removed ${t.name}. Undo brings it back.`);
  });
  $("track-add-audio").addEventListener("click", () => {
    const t = Song.addTrack(song, { kind: "audio" });
    if (!t) { Announce.say(`${Song.MAX_TRACKS} tracks is the most a song can have`); return; }
    syncAudio();
    rebuildMixer();
    selectTrack(t.id, false);
    afterChange(`Added ${t.name}, an audio track. New clip or dropping a file on its row adds a sound.`);
  });
  $("track-add").addEventListener("click", () => {
    const t = Song.addTrack(song);
    if (!t) { Announce.say(`${Song.MAX_TRACKS} tracks is the most a song can have`); return; }
    syncAudio();
    rebuildMixer();
    selectTrack(t.id, false);
    afterChange(`Added ${t.name}`);
    trackName.focus();
    trackName.select();
  });

  // --- Song page: key, snap, swing ---
  const keyRoot = $("key-root"), keyScale = $("key-scale"), keyKeep = $("key-keep"), snapSel = $("snap"), swing = $("swing");
  const ROOTS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const SCALE_NAMES = { none: "No scale", major: "Major", minor: "Minor", "pentatonic-major": "Pentatonic major", "pentatonic-minor": "Pentatonic minor", blues: "Blues", dorian: "Dorian" };
  const SNAP_NAMES = { 1: "1/16 (a step)", 2: "1/8", 4: "1/4 (a beat)", 8: "1/2", 16: "1 bar" };
  ROOTS.forEach((r, i) => keyRoot.add(new Option(r, i)));
  for (const k of Object.keys(Song.SCALES)) keyScale.add(new Option(SCALE_NAMES[k], k));
  for (const n of Song.SNAPS) snapSel.add(new Option(SNAP_NAMES[n], n));

  function renderSongPage() {
    const ck = song.key.root + " " + song.key.scale;
    if (ck !== chordKey) { chordKey = ck; chordPad.render(); }
    keyRoot.value = song.key.root;
    keyScale.value = song.key.scale;
    keyKeep.checked = song.key.keep;
    keyRoot.disabled = keyKeep.disabled = song.key.scale === "none";
    snapSel.value = song.snap;
    swing.value = Math.round(song.swing * 100);
    $("swing-out").textContent = swing.value === "0" ? "Off" : swing.value + "%";
    swing.setAttribute("aria-valuetext", swing.value === "0" ? "off" : swing.value + " percent");
  }
  const keyWords = () => (song.key.scale === "none" ? "No scale" : `${ROOTS[song.key.root]} ${SCALE_NAMES[song.key.scale].toLowerCase()}`);
  keyRoot.addEventListener("change", () => { song.key.root = Number(keyRoot.value); renderSongPage(); afterChange(keyWords()); });
  keyScale.addEventListener("change", () => { song.key.scale = keyScale.value; renderSongPage(); afterChange(keyWords()); });
  keyKeep.addEventListener("change", () => {
    song.key.keep = keyKeep.checked;
    afterChange(keyKeep.checked ? "New notes stay in key" : "Notes can go anywhere");
  });
  snapSel.addEventListener("change", () => { song.snap = Number(snapSel.value); afterChange(`Snap to ${SNAP_NAMES[song.snap]}`); });
  swing.addEventListener("input", () => { song.swing = Number(swing.value) / 100; renderSongPage(); save(); });

  // --- songs: open, new, duplicate, delete, export, import ---
  const songsDlg = $("songs");
  const exportStatus = $("export-status");

  function openSong(id) {
    if (saveTimer) writeNow();
    const data = library.load(id);
    if (!data) return;
    if (transport && transport.playing) stopLoop();
    songId = id;
    open = null;
    picked = null;
    applySong(Song.sanitize(data));
    history.reset(historyJson());
    writeNow();
    renderSongList();
    Announce.say(`Opened ${song.title}`);
  }

  function addAndOpen(data, words) {
    if (saveTimer) writeNow();
    const id = library.add(Song.sanitize(data));
    openSong(id);
    if (words) Announce.say(words);
  }

  const when = (ms) => {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins > 1 ? "s" : ""} ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)} hour${Math.round(mins / 60) > 1 ? "s" : ""} ago`;
    return new Date(ms).toLocaleDateString();
  };

  // A song's thumbnail: its timeline in miniature, a stripe per track and
  // a block per clip in the track's color.
  function thumbSvg(data) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "song-thumb");
    svg.setAttribute("aria-hidden", "true");
    let sd;
    try { sd = Song.sanitize(data); } catch (e) { return svg; }
    const bars = Math.max(8, Song.songBars(sd));
    const rows = Math.max(1, sd.tracks.length);
    svg.setAttribute("viewBox", `0 0 ${bars * 10} ${rows * 10}`);
    svg.setAttribute("preserveAspectRatio", "none");
    sd.tracks.forEach((t, i) => {
      for (const c of t.clips) {
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", c.start * 10 + 0.5);
        r.setAttribute("y", i * 10 + 2);
        r.setAttribute("width", Math.max(1, c.length * 10 - 1));
        r.setAttribute("height", 6);
        r.setAttribute("rx", 1.5);
        r.setAttribute("fill", `var(--c-${t.color})`);
        svg.append(r);
      }
    });
    return svg;
  }

  let armedDelete = null; // a song whose Remove was pressed once
  function renderSongList() {
    const list = $("song-list");
    list.textContent = "";
    $("home-current-name").textContent = song.title;
    for (const e of library.list()) {
      const data = e.id === songId ? song : library.load(e.id);
      const li = document.createElement("li");
      li.className = "song-card" + (e.id === songId ? " current" : "");
      li.dataset.id = e.id;
      const current = e.id === songId;
      let sd = null;
      try { sd = Song.sanitize(data); } catch (err) { /* unreadable: still listed */ }
      const bars = sd ? Song.songBars(sd) : 0;
      const where = !e.file ? "Only in this browser" : e.dirty ? "Changed since its last save" : e.inPlace ? `Saved in ${e.file}` : `Copy saved as ${e.file}`;
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "song-open";
      openBtn.setAttribute("aria-label", `${e.title}${current ? ", open now" : ""}, edited ${when(e.updated)}. ${where}.`);
      if (current) openBtn.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "song-name";
      name.textContent = e.title;
      const meta = document.createElement("span");
      meta.className = "song-meta";
      meta.textContent = `Edited ${when(e.updated)}` + (sd ? ` · ${sd.bpm} BPM · ${bars} bar${bars === 1 ? "" : "s"} · ${sd.tracks.length} tracks` : "");
      const badges = document.createElement("span");
      badges.className = "song-badges";
      const badge = (text, cls) => {
        const b = document.createElement("span");
        b.className = "badge " + cls;
        b.textContent = text;
        badges.append(b);
      };
      if (current) badge("Open now", "now");
      badge(where, !e.file ? "warn" : e.dirty ? "changed" : "saved");
      openBtn.append(thumbSvg(data), name, meta, badges);
      openBtn.addEventListener("click", () => { if (!current) openSong(e.id); songsDlg.close(); });
      const acts = document.createElement("div");
      acts.className = "song-acts";
      const dup = document.createElement("button");
      dup.type = "button";
      dup.textContent = "Duplicate";
      dup.setAttribute("aria-label", `Duplicate ${e.title}`);
      dup.addEventListener("click", () => {
        const copy = JSON.parse(JSON.stringify(data));
        copy.title = (e.title + " copy").slice(0, 80);
        library.add(Song.sanitize(copy));
        renderSongList();
        Announce.say(`Made ${copy.title}`);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      const armed = armedDelete === e.id;
      del.textContent = armed ? "Really remove?" : "Remove";
      del.setAttribute("aria-label", armed ? `Really remove ${e.title}? Press again to remove it` : `Remove ${e.title}` + (e.file ? "" : ": it's only in this browser"));
      del.disabled = library.list().length <= 1;
      del.addEventListener("click", () => {
        if (armedDelete !== e.id) {
          armedDelete = e.id;
          renderSongList();
          list.querySelector(`[data-id="${e.id}"] .danger`)?.focus();
          Announce.say(e.file && !e.dirty ? `Press Remove again to take ${e.title} off this list. Its file stays where you saved it.`
            : `Press Remove again to delete ${e.title}. It's only in this browser.`);
          setTimeout(() => { if (armedDelete === e.id) { armedDelete = null; renderSongList(); } }, 5000);
          return;
        }
        armedDelete = null;
        if (current) openSong(library.list().find((x) => x.id !== e.id).id);
        library.remove(e.id);
        SongFiles.forget(e.id);
        renderSongList();
        $("song-new").focus();
        Announce.say(`Removed ${e.title}`);
      });
      acts.append(dup, del);
      li.append(openBtn, acts);
      list.append(li);
    }
  }

  // --- Home: like a start screen, on every launch ---
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function showHome() {
    if (saveTimer) writeNow();
    armedDelete = null;
    exportStatus.textContent = "";
    $("songs-h").textContent = library.list().length > 1 || library.list()[0]?.file ? "Welcome back" : "Welcome to mpwav";
    $("songs-close").textContent = `Back to ${song.title}`;
    $("ios-note").hidden = !isIOS;
    $("ios-install").hidden = installed;
    $("ios-installed").hidden = !installed;
    $("save-as").hidden = !SongFiles.canSaveInPlace;
    $("export-file").textContent = SongFiles.canSaveInPlace ? "Save" : "Save song file";
    $("home-save-note").textContent = SongFiles.canSaveInPlace
      ? "Save puts a song in a .mpwav file wherever you choose (its sounds go inside), then saves to it in place. Your work is also kept in this browser as you go."
      : isIOS ? "Save song file puts a .mpwav file in Files (its sounds go inside). Your work is also kept in this browser as you go."
        : "Save song file downloads a .mpwav file (its sounds go inside). Your work is also kept in this browser as you go.";
    renderSongList();
    if (!songsDlg.open) songsDlg.showModal();
  }

  // Hands over a finished file: on iPhones and iPads a button opens the share
  // sheet (Save to Files) with a fresh tap; elsewhere it downloads.
  function deliver(blob, name, done) {
    if (isIOS && SongFiles.canShare(blob, name)) {
      exportStatus.textContent = `${name} is ready. `;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "share-btn";
      b.textContent = `Save ${name} to Files…`;
      b.addEventListener("click", async () => {
        try { await SongFiles.share(blob, name); exportStatus.textContent = done; }
        catch (e) { if (!e || e.name !== "AbortError") { SongFiles.download(blob, name); exportStatus.textContent = done; } }
      });
      exportStatus.append(b);
      b.focus();
      Announce.say(`${name} is ready: press Save to Files`);
      return;
    }
    SongFiles.download(blob, name);
    exportStatus.textContent = done;
    Announce.say(done);
  }

  // Save: to the song's file (asked for the first time), or a download.
  let saving = false;
  async function saveSong(asNew) {
    if (saving) return;
    saving = true;
    if (saveTimer) writeNow();
    try {
      const sounds = await Samples.exportAll(Song.soundIds(song));
      const blob = SongFiles.pack(JSON.parse(JSON.stringify(song)), sounds);
      const name = Wav.fileName(song.title, SongFiles.EXT);
      if (!SongFiles.canSaveInPlace) {
        library.markSaved(songId, name, false);
        showSaved();
        if (!songsDlg.open) showHome(); // the status (and the iPhone button) shows on Home
        deliver(blob, name, `Saved a copy: ${name}. ${isIOS ? "Keep it in Files." : "Check your downloads."}`);
        return;
      }
      const got = asNew ? await SongFiles.saveAs(songId, name, blob) : await SongFiles.save(songId, name, blob);
      if (!got) { Announce.say("Not saved"); return; }
      library.markSaved(songId, got.name, got.inPlace);
      // Ask the browser to keep this site's storage (it may say no).
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const text = got.inPlace ? `Saved in ${got.name}` : `Saved a copy: ${got.name}. ${isIOS ? "Keep it in Files." : "Check your downloads."}`;
      exportStatus.textContent = text;
      Announce.say(text);
      showSaved();
      if (songsDlg.open) renderSongList();
    } catch (e) {
      const text = "Couldn't save: " + (e && e.message ? e.message : e);
      exportStatus.textContent = text;
      Announce.say(text);
    } finally {
      saving = false;
    }
  }
  // The Save button says whether there's anything new to save.
  function showSaved() {
    const e = library.entry(songId);
    const btn = $("save-btn");
    const fresh = e && e.file && !e.dirty;
    btn.textContent = fresh ? "Saved" : "Save";
    btn.setAttribute("aria-label", fresh ? `Saved in ${e.file}` : e && e.file ? `Save: changed since saving ${e.file}` : "Save to a file");
  }
  $("save-btn").addEventListener("click", () => saveSong(false));
  $("save-as").addEventListener("click", () => saveSong(true));

  $("songs-btn").addEventListener("click", showHome);
  $("songs-close").addEventListener("click", () => songsDlg.close());
  songsDlg.addEventListener("click", (e) => { if (e.target === songsDlg) songsDlg.close(); });
  songsDlg.addEventListener("close", () => $("songs-btn").focus());

  $("song-new").addEventListener("click", () => {
    const blank = Song.createSong();
    blank.title = `Untitled song ${library.list().length + 1}`;
    addAndOpen(blank, `New song: ${blank.title}`);
    songsDlg.close();
  });
  $("song-demo").addEventListener("click", () => {
    const demo = Song.demoSong();
    demo.title = "Demo song";
    addAndOpen(demo, "New song from the demo");
    songsDlg.close();
  });
  $("song-dup").addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(song));
    copy.title = (song.title + " copy").slice(0, 80);
    addAndOpen(copy, `Opened ${copy.title}`);
    songsDlg.close();
  });

  // Hands the browser a file to save.
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  $("export-wav").addEventListener("click", async () => {
    const btn = $("export-wav");
    if (!Song.songBars(song)) { exportStatus.textContent = "Add a clip first: there's nothing to export yet."; return; }
    btn.disabled = true;
    exportStatus.textContent = "Rendering the song…";
    try {
      const buffer = await Render.renderSong(song, live, {
        onProgress: (f) => { exportStatus.textContent = `Rendering the song… ${Math.round(f * 100)}%`; },
      });
      const name = Wav.fileName(song.title, ".wav");
      deliver(new Blob([Wav.encode(buffer)], { type: "audio/wav" }), name,
        `Saved ${name} (${Math.round(buffer.duration)} seconds). ${isIOS ? "Keep it in Files." : "Check your downloads."}`);
    } catch (e) {
      exportStatus.textContent = "Couldn't export: " + (e && e.message ? e.message : e);
    }
    btn.disabled = false;
  });

  $("export-file").addEventListener("click", () => saveSong(false));
  // Share by link (src/state/share-link.js): the song rides in the #fragment.
  $("share-link").addEventListener("click", async () => {
    if (ShareLink.usesSounds(song)) {
      exportStatus.textContent = "This song uses sound files, which are too big for a link. Use Save song file and send the file instead.";
      Announce.say(exportStatus.textContent);
      return;
    }
    const link = ShareLink.linkFor(await ShareLink.encode(song), location.href);
    try {
      await navigator.clipboard.writeText(link);
      exportStatus.textContent = `Share link copied (${link.length.toLocaleString()} characters). Paste it anywhere: opening it adds a copy of ${song.title}.`;
    } catch (e) {
      exportStatus.textContent = "Copy the link below to share it.";
      const box = Object.assign(document.createElement("input"), { type: "text", readOnly: true, value: link, className: "share-box" });
      box.setAttribute("aria-label", "Share link");
      exportStatus.after(box);
      box.select();
    }
    Announce.say(exportStatus.textContent);
  });

  // Open: a song file becomes a song here (with its sounds); on Chrome and
  // Edge, Save goes back to that same file.
  $("import-file").addEventListener("click", async () => {
    try {
      const got = await SongFiles.open();
      if (!got) return;
      const { song: songData, sounds } = SongFiles.unpack(got.text);
      if (sounds) await Samples.importAll(sounds);
      addAndOpen(songData);
      if (got.handle) await SongFiles.remember(songId, got.handle);
      library.markSaved(songId, got.name, !!got.handle);
      showSaved();
      songsDlg.close();
      Announce.say(`Opened ${song.title} from ${got.name}`);
    } catch (e) {
      exportStatus.textContent = "Couldn't open it: " + (e && e.message ? e.message : e);
    }
  });

  // --- patterns: repeat, rhythm stamps, arpeggios ---
  const repeatEvery = $("repeat-every"), arpRate = $("arp-rate");
  for (const [n, words] of [[2, "1/8 (2 steps)"], [4, "beat"], [8, "half bar"], [16, "bar"]]) repeatEvery.add(new Option(words, n));
  repeatEvery.value = 4;
  for (const [n, words] of [[1, "1/16"], [2, "1/8"], [4, "1/4"]]) arpRate.add(new Option(words, n));
  arpRate.value = 2;

  // Number keys: 1-7 stamp rhythms, 8 / 9 / 0 arpeggiate.
  const STAMP_KEYS = ["beats", "eighths", "sixteenths", "offbeats", "backbeat", "tresillo", "clave"];
  const ARP_KEYS = [["up", "Up", "8"], ["down", "Down", "9"], ["updown", "Up-down", "0"]];
  const keyBadge = (k) => `<kbd aria-hidden="true">${k}</kbd> `;
  STAMP_KEYS.forEach((kind, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = keyBadge(i + 1) + Song.STAMPS[kind].name;
    b.setAttribute("aria-keyshortcuts", String(i + 1));
    b.addEventListener("click", () => stamp(kind));
    $("stamps").append(b);
  });
  for (const [dir, words, key] of ARP_KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = keyBadge(key) + words;
    b.setAttribute("aria-keyshortcuts", key);
    b.addEventListener("click", () => arpeggio(dir));
    $("arps").append(b);
  }

  function selectOnly(notes) {
    selNotes.clear();
    for (const n of notes) selNotes.add(n);
  }

  function stamp(kind) {
    const o = find(open);
    if (!o) { Announce.say("Open a clip first"); return; }
    const midi = roll.cursor.midi;
    const added = Song.stampNotes(o.c, kind, midi, o.t.length);
    selectOnly(added);
    preview(o.t, midi);
    afterChange(`${Song.STAMPS[kind].name} on ${Notes.spokenName(midi)}: ${plural(added.length, "note")} added`);
  }

  function repeatSelected() {
    const o = find(open);
    if (!o || !selNotes.size) { Announce.say("Select notes to repeat first"); return; }
    const every = Number(repeatEvery.value);
    const before = [...selNotes];
    const added = Song.repeatNotes(o.c, before, every);
    selectOnly([...before, ...added]);
    afterChange(added.length ? `Repeated every ${repeatEvery.selectedOptions[0].text}: ${plural(added.length, "note")} added` : "Nothing to add: the loop is already full of them");
  }
  $("repeat-go").addEventListener("click", repeatSelected);

  function arpeggio(dir) {
    const o = find(open);
    if (!o || selNotes.size < 2) { Announce.say("Select a chord (two notes or more) first"); return; }
    const added = Song.arpeggiate(o.c, [...selNotes], dir, Number(arpRate.value));
    selectOnly(added);
    afterChange(`Arpeggio ${dir === "updown" ? "up and down" : dir}: ${plural(added.length, "note")}`);
  }

  // A number key, if it means a pattern. Returns whether it did something.
  function patternKey(code) {
    const d = /^(Digit|Numpad)(\d)$/.exec(code);
    if (!d || !find(open)) return false;
    const n = Number(d[2]);
    if (n >= 1 && n <= 7) stamp(STAMP_KEYS[n - 1]);
    else arpeggio(ARP_KEYS[{ 8: 0, 9: 1, 0: 2 }[n]][0]);
    return true;
  }

  // --- title ---
  const titleField = $("song-title");
  titleField.value = song.title;
  const showTitle = () => { document.title = `${song.title} — mpwav`; };
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

  // The tab row scrolls sideways when the tabs don't fit: keep the open one in view.
  const tabRow = document.querySelector(".pages");
  const showTab = (id) => {
    const t = $(id).getBoundingClientRect(), r = tabRow.getBoundingClientRect();
    tabRow.scrollLeft += t.left - r.left - (r.width - t.width) / 2;
  };
  const pages = Tabs.create(tabRow, {
    onSelect(id) { ui.page = id; showTab(id); save(); },
  });
  pages.select($(ui.page) ? ui.page : "tab-p-note", false);
  showTab(pages.current);
  const pageIds = [...document.querySelectorAll(".pages [role=tab]")].map((t) => t.id);
  const turnPage = (dir) => {
    const i = (pageIds.indexOf(pages.current) + dir + pageIds.length) % pageIds.length;
    pages.select(pageIds.at(i), false);
    showTab(pageIds.at(i));
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

  // The mixer is drawn from the track list, so adding, removing, renaming
  // or reordering tracks redraws it (and hooks its meters back up).
  let mixerView = null;
  function rebuildMixer() {
    $("mixer-strips").textContent = "";
    mixerView = MixerView.create($("mixer-strips"), song, {
      select: selectTrack,
      volume(id, db) { Song.track(song, id).volume = db; applyMix(); save(); },
      pan(id, v) { Song.track(song, id).pan = v; applyMix(); save(); },
      mute(id, on) { Song.track(song, id).mute = on; applyMix(); timeline.render(); save(); },
      solo(id, on) { Song.track(song, id).solo = on; applyMix(); timeline.render(); save(); },
      master(db) { song.master = db; applyMix(); save(); },
    });
    for (const t of song.tracks) if (audio[t.id]) Meter.add(mixerView.meter(t.id), audio[t.id].channel.peak, true);
    if (transport) Meter.add(mixerView.meter("master"), Engine.peak, true);
  }
  rebuildMixer();

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
    renderTrackPage();
    renderSoundPage();
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
      : w >= 1000 ? "wide" : w <= 640 ? "compact" : "medium";
    const fit = ui.fit && want === "wide" ? "on" : "off";
    if (document.documentElement.dataset.layout !== want || document.documentElement.dataset.fit !== fit) {
      document.documentElement.dataset.layout = want;
      document.documentElement.dataset.fit = fit;
      setKeyboard(kb.base, false);
      roll.rebuild();
    }
  }
  window.addEventListener("resize", applyLayout);

  const settings = $("settings");
  $("version").textContent = "v" + window.STUDIO_VERSION;
  Install.init({ button: $("install-btn"), help: $("install-help"), status: $("offline-status") }, (t) => Announce.say(t));
  $("settings-btn").addEventListener("click", () => {
    $("layout-" + ui.layout).checked = true;
    ($("theme-" + ui.theme) || $("theme-contrast")).checked = true;
    ($("look-" + ui.look) || $("look-pixel")).checked = true;
    $("motion").checked = ui.motion;
    $("fit-screen").checked = ui.fit;
    $("show-tips").checked = ui.tips;
    ($("size-" + ui.size) || $("size-auto")).checked = true;
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

  // Background: high contrast unless another one was chosen and saved.
  const THEME_NAMES = { contrast: "High contrast", midnight: "Midnight", plum: "Plum", forest: "Forest", ember: "Ember" };
  for (const theme of Object.keys(THEME_NAMES)) {
    $("theme-" + theme).addEventListener("change", (e) => {
      if (!e.target.checked) return;
      ui.theme = theme;
      if (theme === "contrast") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      Meter.resetColors();
      Announce.say(`${THEME_NAMES[theme]} background`);
      save();
    });
  }

  // Look (how much is drawn in pixels) and Motion, modeled on Bezier's settings.
  const LOOK_NAMES = { smooth: "Smooth", pixel: "Pixel details", allpixel: "All pixel" };
  for (const look of Object.keys(LOOK_NAMES)) {
    $("look-" + look).addEventListener("change", (e) => {
      if (!e.target.checked) return;
      ui.look = look;
      document.documentElement.dataset.look = look;
      // Outlines and paddings changed: the timeline and the roll refit.
      timeline.render();
      roll.rebuild();
      Announce.say(`${LOOK_NAMES[look]} look`);
      save();
    });
  }
  $("motion").addEventListener("change", (e) => {
    ui.motion = e.target.checked;
    if (ui.motion) delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = "off";
    Announce.say(ui.motion ? "Motion on" : "Motion off");
    save();
  });

  // Text and control size: Auto follows the screen; the others are fixed.
  const SIZE_NAMES = { auto: "Automatic", s: "Small", m: "Medium", l: "Large", xl: "Extra large" };
  for (const size of Object.keys(SIZE_NAMES)) {
    $("size-" + size).addEventListener("change", (e) => {
      if (!e.target.checked) return;
      ui.size = size;
      if (size === "auto") delete document.documentElement.dataset.size;
      else document.documentElement.dataset.size = size;
      timeline.render();
      roll.rebuild();
      Announce.say(`${SIZE_NAMES[size]} size`);
      save();
    });
  }

  // Fit to the window (desktop): no page scrolling, panels scroll inside themselves.
  $("fit-screen").addEventListener("change", (e) => {
    ui.fit = e.target.checked;
    applyLayout();
    timeline.render();
    Announce.say(ui.fit ? "Fit to the window on" : "Fit to the window off");
    save();
  });
  // Tutorial: the how-to tips under each part show on screen, or stay for screen readers only.
  const showTips = () => {
    if (ui.tips) document.documentElement.dataset.tips = "on";
    else delete document.documentElement.dataset.tips;
  };
  // The guided tour (src/ui/tour.js): from Settings, and once on a first visit.
  $("tour-btn").addEventListener("click", () => {
    settings.close();
    Tour.start();
  });
  // First visit: Home opens at launch and blocks the page while it's up, so
  // the tour waits for Home to close (see first paint, below).
  const autoTour = () => {
    if (Tour.shouldAutoRun() && !Tour.active() && !document.querySelector("dialog[open]")) Tour.start();
  };

  $("show-tips").addEventListener("change", (e) => {
    ui.tips = e.target.checked;
    showTips();
    timeline.render();
    roll.rebuild();
    Announce.say(ui.tips ? "Tips shown" : "Tips hidden");
    save();
  });
  showTips();

  const fsBtn = $("fullscreen");
  if (!document.fullscreenEnabled) {
    // iPhones only allow fullscreen for video; add to the home screen instead.
    fsBtn.disabled = true;
    $("fullscreen-help").textContent = "This browser doesn't allow fullscreen pages. On a phone, add mpwav to your home screen instead.";
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

  // --- window edit mode: move panels between the columns ---
  arrange = Arrange.create([
    { id: "playbox", name: "Playing box" },
    { id: "clip-editor", name: "Clip editor" },
    { id: "note-edit", name: "Note Edit" },
    { id: "keys-section", name: "Keyboard" },
  ], ui.panels, ui.folded, ui.sizes, {
    onSizes(sizes) {
      ui.sizes = sizes;
      timeline.render();
      save();
    },
    onChange(layout, folded, text) {
      ui.panels = layout;
      ui.folded = folded;
      // Panels changed width: the timeline and the piano roll refit.
      timeline.render();
      roll.rebuild();
      if (text) Announce.say(text);
      save();
    },
  });
  function setArranging(on) {
    arrange.setArranging(on);
    $("arrange-bar").hidden = !on;
    if (on) {
      if ($("settings").open) $("settings").close();
      $("arrange-done").focus();
      Announce.say("Arranging panels. Drag a panel by its handle, or use its Move and Place controls. Press Done or Escape when finished.");
    } else {
      Announce.say("Panels arranged");
    }
  }
  $("arrange-btn").addEventListener("click", () => setArranging(true));
  $("arrange-done").addEventListener("click", () => setArranging(false));
  $("arrange-reset").addEventListener("click", () => arrange.reset());
  const sideLeft = $("side-left");
  const showSide = () => { document.documentElement.dataset.side = ui.sideLeft ? "left" : "right"; sideLeft.checked = ui.sideLeft; };
  sideLeft.addEventListener("change", () => {
    ui.sideLeft = sideLeft.checked;
    showSide();
    timeline.render();
    roll.rebuild();
    Announce.say(ui.sideLeft ? "Side column on the left" : "Side column on the right");
    save();
  });
  showSide();

  // --- focus never hides under sticky bars (WCAG 2.4.11) ---
  // scroll-padding keeps focused things clear when the browser scrolls to
  // them; this also catches focus that lands under a bar without a scroll.
  function measureSticky() {
    const root = document.documentElement.style;
    const bar = document.querySelector(".transport-bar");
    const keys = $("keys-section");
    const pinned = (el) => el && getComputedStyle(el).position === "sticky";
    root.setProperty("--sticky-top", (pinned(bar) ? bar.offsetHeight : 0) + "px");
    root.setProperty("--sticky-bottom", (pinned(keys) && document.documentElement.dataset.layout === "compact" ? keys.offsetHeight : 0) + "px");
  }
  new ResizeObserver(measureSticky).observe(document.querySelector(".transport-bar"));
  new ResizeObserver(measureSticky).observe($("keys-section"));
  window.addEventListener("resize", measureSticky);
  measureSticky();
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || el.closest(".transport-bar, #keys-section, dialog")) return;
    const r = el.getBoundingClientRect();
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-top")) || 0;
    const bottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-bottom")) || 0;
    if (r.top < top + 4 || r.bottom > innerHeight - bottom - 4) el.scrollIntoView({ block: "nearest" });
  });

  // --- first paint ---
  if (!find(picked)) picked = null;
  loadSounds();
  showSaved();
  // Home opens on every launch (not when the page is a test frame's reload of the same visit).
  let seen = false;
  try { seen = !!sessionStorage.getItem("mpwav.seen"); sessionStorage.setItem("mpwav.seen", "1"); } catch (e) { /* blocked */ }
  // A share link (#song=…) opens straight into a copy of that song, skipping Home.
  const shared = ShareLink.fromHash(location.hash);
  if (shared) {
    seen = true;
    window.history.replaceState(null, "", location.pathname + location.search);
    ShareLink.decode(shared)
      .then((data) => addAndOpen(data, `Opened a shared song: ${data.title || "untitled"}. It's saved in your songs.`))
      .catch(() => { Announce.say("That share link is broken or cut short."); showHome(); });
  }
  if (!seen) requestAnimationFrame(showHome);
  // The first-visit tour follows Home when Home is opening, else starts on its own.
  if (Tour.shouldAutoRun()) {
    if (!seen) songsDlg.addEventListener("close", () => setTimeout(autoTour, 150), { once: true });
    else setTimeout(autoTour, 700);
  }
  history.commit(historyJson());
  applyLayout();
  selectTrack(song.selected, false);
  showLoop();
  showRowsFold();
  // Draw the zoom bars once the layout has settled (and again after fonts load).
  const drawZooms = () => { tlZoom.draw(); rollZoom.draw(); };
  requestAnimationFrame(drawZooms);
  setTimeout(drawZooms, 250);
  window.addEventListener("load", drawZooms);
  showActions();
  showUndo();
  showTempoTools();
  renderTempoList();
  renderSongPage();
  singleKeys.checked = ui.singleKeys;
  setKeysMode(ui.singleKeys ? ui.keysMode : "play", false);
})();
