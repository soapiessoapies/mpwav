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
        panels: ui.panels, folded: ui.folded, sideLeft: ui.sideLeft, look: ui.look, motion: ui.motion, fit: ui.fit, tips: ui.tips, sizes: ui.sizes, size: ui.size, slide: ui.slide, posterSeen: true,
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
  const ui = { announceNotes: false, page: "tab-p-note", keysOpen: true, layout: "auto", theme: "poster", metronome: false, countIn: true, keysMode: "play", singleKeys: true, midi: false, collapsed: [], panels: null, folded: [], sideLeft: false, look: "pixel", motion: true, fit: true, tips: false, sizes: null, size: "auto", slide: "all", ...uiSaved };
  let arrange = null; // window edit mode (set up near the end)
  // The Poster look arrived after some people had already been using mpwav:
  // they get it once too, and whatever they pick after that is kept.
  if (!uiSaved.posterSeen) ui.theme = "poster";
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
      synth.setKit(t.kind === "drums");
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
  // Every sound a saved song uses (and, with `withUndo`, every one an undo
  // or redo step could bring back). Anything else in storage is a leftover.
  function soundsInUse(withUndo) {
    const keep = new Set();
    const scan = (text) => { for (const m of String(text).matchAll(/snd-[a-z0-9]{1,24}/g)) keep.add(m[0]); };
    scan(JSON.stringify(song));
    for (const e of library.list()) if (e.id !== songId) scan(JSON.stringify(library.load(e.id)));
    if (withUndo) for (const json of history.all()) scan(json);
    return keep;
  }
  const megabytes = (bytes) => (bytes < 1e5 ? "under 0.1 MB" : (bytes / 1e6).toFixed(1) + " MB");
  // Settings > Storage: what's kept, and how much of it no song uses.
  function showStorage() {
    return Samples.usage(soundsInUse(false)).then((u) => {
      const sounds = (n) => `${n} sound${n === 1 ? "" : "s"}`;
      $("storage-status").textContent = !u.count ? "No sounds are kept in this browser."
        : `${sounds(u.count)} kept in this browser (${megabytes(u.bytes)}). ` +
          (u.unused ? `${u.unused} of them (${megabytes(u.unusedBytes)}) ${u.unused === 1 ? "isn't" : "aren't"} used by any song.` : u.count === 1 ? "A song uses it." : "Every one is used by a song.");
      $("storage-clear").disabled = !u.unused;
    });
  }
  $("storage-clear").addEventListener("click", () => {
    if (saveTimer) writeNow();
    Samples.tidy(soundsInUse(false), true).then((r) => {
      history.reset(historyJson()); // steps back would need the sounds just cleared
      showUndo();
      showStorage();
      Announce.say(r.removed ? `Cleared ${r.removed} unused sound${r.removed === 1 ? "" : "s"}, ${megabytes(r.bytes)}. Undo starts fresh from here.` : "Nothing to clear");
    });
  });

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

  // --- recording: while on, the song plays as it is and live notes go into
  // whichever track is selected, at the bar that's playing, snapped to the
  // nearest step. Pick another track ([ / ] or click it) and keep playing:
  // the take carries on there. A track with no clip under the playhead gets
  // one, spanning the free bars of the loop. A take is one stretch of
  // recording across any tracks; Undo take removes everything it added. ---
  let take = null;     // { notes: [{ contentId, n }], held: Map(midi -> { n, contentId, from, pos }) } while recording
  let lastTake = null; // the finished take Undo take would remove
  const recBtn = $("record");
  const undoBtn = $("undo-take");

  // The clip on `t` under bar `bar`, making one if there's none: it covers
  // the empty bars around `bar` inside the loop (or 4 bars from `bar` with
  // the loop off), so a phrase recorded across bars lands in one clip.
  function liveClip(t, bar) {
    const span = Song.freeSpan(t, bar, song.loop);
    return span ? Song.addClip(song, t, span.start, span.length) : Song.clipAt(t, bar);
  }

  async function startTake() {
    if (sel().kind === "audio") { Announce.say("Recording plays notes into a synth or drum track. Pick one first."); return; }
    take = { notes: [], held: new Map() };
    recBtn.setAttribute("aria-pressed", "true");
    const playing = transport && transport.playing;
    const counting = !playing && ui.countIn;
    if (!playing) await togglePlay(counting);
    Announce.say(`${counting ? "Count-in, then recording" : "Recording"} into ${sel().name}. Pick another track any time to add to it as the song plays.`);
  }

  function endTake() {
    if (!take) return;
    const done = take;
    take = null;
    recBtn.setAttribute("aria-pressed", "false");
    if (done.notes.length) {
      lastTake = done;
      undoBtn.disabled = false;
      const tracks = new Set(done.notes.map((x) => song.contents[x.contentId] && song.contents[x.contentId].trackId)).size;
      Announce.say(`Recorded ${done.notes.length} note${done.notes.length > 1 ? "s" : ""}` + (tracks > 1 ? ` on ${tracks} tracks` : ""));
    }
  }

  recBtn.addEventListener("click", () => (take ? endTake() : startTake()));

  undoBtn.addEventListener("click", () => {
    if (!lastTake) return;
    endTake();
    for (const { contentId, n } of lastTake.notes) {
      const c = song.contents[contentId];
      if (c) Song.removeNotes(c, [n]);
    }
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
    const t = sel();
    if (t.kind === "audio") return;
    const at = nearestStep();
    if (!at) return;
    const clip = liveClip(t, Math.floor(at.pos / Song.STEPS));
    if (!clip) return;
    const c = song.contents[clip.contentId];
    const n = Song.addNote(c, Song.localStep(song, clip, at.pos), m, 1);
    if (!n) return;
    take.notes.push({ contentId: c.id, n });
    take.held.set(m, { n, contentId: c.id, from: Engine.ctx.currentTime, pos: at.pos });
    // You already heard it as you played it; don't play it again a moment later.
    if (at.upcoming) skipOnce.add(at.pos + ":" + m);
    // Show what's being recorded: the clip it went into opens in the editor.
    const o = find(open);
    if (!o || o.clip !== clip) openClip(t, clip, false);
    else renderEditor();
    timeline.render();
    save();
  }

  // When a recorded key lets go, its note becomes as long as it was held.
  function recordRelease(m) {
    const h = take && take.held.get(m);
    if (!h) return;
    take.held.delete(m);
    const steps = (Engine.ctx.currentTime - h.from) / Song.stepSeconds(song, h.pos);
    const c = song.contents[h.contentId];
    if (c) Song.resizeNote(c, h.n, Math.max(1, Math.round(steps)));
    renderEditor();
    timeline.render();
    save();
  }

  // --- live notes from the keyboards, played on the selected track. The
  // same note can be held by a finger and a computer key at once; it sounds
  // until the last one lets go. ---
  const holds = new Map(); // midi -> { n, trackId, key }
  // A drum track's notes are drums: whose content is this?
  const drumContent = (c) => (song.tracks.find((t) => t.id === c.trackId) || {}).kind === "drums";
  // On a drum track the keys play drums (src/audio/drums.js).
  const liveNote = (m) => (sel().kind === "drums" ? Drums.fromKey(m, kb.base) : m);
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
    const key = m;
    m = liveNote(m);
    const h = holds.get(m);
    if (h) { h.n++; return; }
    const trackId = song.selected;
    holds.set(m, { n: 1, trackId, key });
    kb.setLit(key, true);
    if (ui.announceNotes && performance.now() - lastSpoken > 150) {
      lastSpoken = performance.now();
      Announce.say(sel().kind === "drums" ? Drums.nameOf(m) : Notes.spokenName(m));
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
    m = liveNote(m);
    const h = holds.get(m);
    if (!h) return;
    if (--h.n > 0) return;
    holds.delete(m);
    kb.setLit(h.key, false);
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

  // Lets go of the notes being played live, leaving the song playing.
  function releaseLive() {
    kb.releaseAll();
    chordPad.releaseAll();
    for (const m of [...compHeld.values()]) noteOff(m);
    compHeld.clear();
    for (const [m, h] of [...holds]) {
      kb.setLit(h.key, false);
      if (audio[h.trackId]) audio[h.trackId].synth.noteOff(m);
      recordRelease(m);
    }
    holds.clear();
  }

  function panic() {
    kb.releaseAll();
    chordPad.releaseAll();
    compHeld.clear();
    for (const h of holds.values()) kb.setLit(h.key, false);
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
    // Alt + 1 to 6: the slides.
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-6]$/.test(e.code)) {
      e.preventDefault();
      setSlide(Slides.LIST[Number(e.code.slice(5)) - 1].id, true);
      return;
    }
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
      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        e.preventDefault();
        stepTrack(e.code === "BracketRight" ? 1 : -1);
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
    // Opening a clip from a slide with no clip editor goes to the slide that has one.
    onOpenClip(t, clip) {
      openClip(t, clip, true);
      if (ui.slide === "arrange" || ui.slide === "mix" || (ui.slide === "edit" && t.kind === "audio")) setSlide(t.kind === "audio" ? "sound" : "make", true);
    },
    // Edit: rows as tall as the window allows, so every note is easy to hit. Arrange: short rows, more tracks.
    rowSize: () => (ui.slide === "edit" ? { fixed: document.documentElement.dataset.layout === "compact" ? 132 : 168, max: 420 } : ui.slide === "arrange" ? { max: 120 } : {}),
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
      if (song.key.keep && !drumContent(c) && midi !== n.midi) midi = Song.nearestInKey(song, midi, Math.sign(midi - n.midi));
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
      if (song.key.keep && o.t.kind !== "drums") midi = Song.nearestInKey(song, midi);
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
      if (o && song.key.keep && o.t.kind !== "drums" && midi !== n.midi) midi = Song.nearestInKey(song, midi, Math.sign(midi - n.midi));
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

  // --- the Make and Sound slides' pickers: the track, and one of its clips ---
  const makeTrack = $("make-track"), makeClip = $("make-clip");
  function renderMakeBar(o) {
    const t = sel();
    const tracks = song.tracks.map((x) => [x.id, x.name]);
    const clips = t.clips.map((c) => [c.id, `${Song.content(song, c).name} (bar ${c.start + 1}${c.length > 1 ? `–${Song.clipEnd(c)}` : ""})`]);
    const fill = (select, list, value) => {
      const sig = JSON.stringify(list);
      if (select.dataset.sig !== sig) {
        select.dataset.sig = sig;
        select.textContent = "";
        for (const [v, words] of list) select.add(new Option(words, v));
      }
      select.value = value;
    };
    fill(makeTrack, tracks, t.id);
    fill(makeClip, [["", clips.length ? "No clip open" : "No clips yet"], ...clips], o && o.t === t ? o.clip.id : "");
    makeClip.disabled = !clips.length;
    $("make-new").textContent = t.kind === "audio" ? "Add a sound…" : "New clip";
  }
  makeTrack.addEventListener("change", () => {
    selectTrack(makeTrack.value, true);
    const t = sel();
    if (t.clips.length) openClip(t, t.clips[0], false);
    else closeClip();
  });
  makeClip.addEventListener("change", () => {
    const t = sel(), clip = t.clips.find((c) => c.id === makeClip.value);
    if (clip) openClip(t, clip, false);
    else closeClip();
  });
  $("make-new").addEventListener("click", () => $("new-clip").click());
  $("make-loops").addEventListener("click", () => $("loops-btn").click());

  function renderEditor() {
    const o = find(open);
    if (open && !o) open = null; // the clip was deleted
    renderMakeBar(o);
    // The Sound slide shows the wave editor for an open audio clip, the synth's pages otherwise.
    document.documentElement.dataset.sound = o && o.c.audio ? "audio" : "synth";
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
      ...(t.kind === "drums" ? { rows: Drums.KIT.map((d) => d.midi), rowName: Drums.nameOf, inKey: null } : {}),
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
    if (o) $("stamp-row").textContent = o.t.kind === "drums" ? Drums.nameOf(roll.cursor.midi) : Notes.noteName(roll.cursor.midi);
    $("beats-box").hidden = !o || o.t.kind !== "drums";
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
      $("note-sel").textContent = "No notes selected. Click a note (in the piano roll or on the timeline), or Shift-click to pick several.";
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
    const isAudio = t.kind === "audio", isDrums = t.kind === "drums";
    $("audio-track-note").hidden = !isAudio;
    $("drum-track-note").hidden = !isDrums;
    $("instrument").hidden = isAudio || isDrums;
    document.querySelector("#p-sound .preset").hidden = isAudio || isDrums;
    document.querySelector("#p-sound .morph-box:not(#instrument)").hidden = isAudio || isDrums;
    // The keyboard: chord buttons for notes, a key-to-drum legend for drums.
    document.querySelector(".chord-row").hidden = isAudio || isDrums;
    $("drum-keys").hidden = !isDrums;
    if (isAudio || isDrums) return;
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

  // --- the wave editor: an open audio clip's trim, fades, gain, fit, and
  // edits to the sound itself. Like a classic wave editor, you select a
  // stretch (drag, or type its times) and an edit changes just that; with
  // nothing selected it changes the whole sound. ---
  const waveEl = $("wave");
  const WAVE_FIELDS = { "wave-start": "start", "wave-end": "end", "wave-fadein": "fadeIn", "wave-fadeout": "fadeOut", "wave-gain": "gain" };
  let waveSel = null;  // the selection: { from, to }, seconds in the sound
  let waveView = null; // the part in view: { start, end }, seconds along the picture (null: all of it)
  let waveFor = null;  // the clip content those two belong to
  let hearing = null;  // Hear it, while it plays: { at, from, length, rate, synth }
  let waveZoom = null; // the zoom bar under the wave
  let waveCursor = 0;  // where a paste goes when nothing is selected: seconds in the sound
  let waveCopied = null; // the copied stretch: { chans, rate, secs } (kept while mpwav is open)
  let waveSpectral = false; // View > Spectral view: the pitches over time instead of the wave's outline
  let spectralPic = null;   // the last spectral picture drawn: { key, canvas }
  let waveNoise = null; // the noise learned for Reduce noise: { level, rate } (kept while mpwav is open)
  let waveActive = false; // the wave was the last thing clicked: Ctrl + C / X / V / A are its
  const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;
  const openAudio = () => { const o = find(open); return o && o.c.audio ? o : null; };
  // The picture reads in playing order, so played backwards it's mirrored.
  const mirror = (a, dur, t) => (a.reverse ? dur - t : t);
  const viewOf = (dur) => (waveView ? { start: Math.min(waveView.start, dur), end: Math.min(waveView.end, dur) } : { start: 0, end: dur });
  const selWords = (s) => `${s.from.toFixed(2)} to ${s.to.toFixed(2)} seconds`;

  function renderWave(o) {
    const a = o.c.audio, info = Samples.info(a.sampleId);
    const dur = info ? info.duration : 0;
    if (waveFor !== o.c.id) { waveFor = o.c.id; waveSel = waveView = null; waveCursor = 0; }
    waveCursor = Math.max(0, Math.min(dur || waveCursor, waveCursor));
    // An undo can bring back a shorter sound.
    if (waveSel && dur) {
      waveSel = { from: Math.min(waveSel.from, dur), to: Math.min(waveSel.to, dur) };
      if (waveSel.to - waveSel.from < 0.001) waveSel = null;
    }
    if (waveView && dur && waveView.end - waveView.start >= dur - 1e-6) waveView = null;
    const end = a.end == null ? dur : Math.min(a.end, dur);
    const keep = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v; };
    keep("wave-start", +a.start.toFixed(3));
    keep("wave-end", +end.toFixed(3));
    keep("wave-fadein", Math.round(a.fadeIn * 1000));
    keep("wave-fadeout", Math.round(a.fadeOut * 1000));
    keep("wave-gain", a.gain);
    keep("sel-from", +(waveSel ? waveSel.from : waveCursor).toFixed(3));
    keep("sel-to", waveSel ? +waveSel.to.toFixed(3) : "");
    keep("sel-len", waveSel ? +(waveSel.to - waveSel.from).toFixed(3) : "");
    for (const id of ["wave-start", "wave-end", "sel-from", "sel-to", "sel-len"]) $(id).max = +dur.toFixed(3);
    $("wave-reverse").setAttribute("aria-pressed", String(a.reverse));
    $("wave-fit").setAttribute("aria-pressed", String(a.fit));
    $("wave-hear").textContent = hearing ? "Stop" : waveSel ? "Hear the selection" : "Hear it";
    $("wave-target").textContent = waveSel ? "Change the selection" : "Change the whole sound";
    $("fx-scope").textContent = waveSel ? "Effects change the selection." : "Effects change the whole sound.";
    $("op-scope").textContent = waveSel ? "These change the selection." : "These change the whole sound.";
    $("tp-scope").textContent = $("tone-scope").textContent = waveSel ? "These change the selection." : "These change the whole sound.";
    $("nr-learn").disabled = !waveSel;
    $("wz-spec").setAttribute("aria-pressed", String(waveSpectral));
    renderCues(a);
    $("nr-go").disabled = !waveNoise;
    for (const id of ["op-delete", "op-trim", "wz-sel", "sel-none"]) $(id).disabled = !waveSel;
    $("wz-out").disabled = $("wz-fit").disabled = !waveView;
    $("wave-cut").disabled = !waveSel;
    $("wave-paste").disabled = $("wave-paste-mix").disabled = !waveCopied;
    const loopSecs = o.c.bars * Song.STEPS * Song.stepSeconds(song, o.clip.start * Song.STEPS);
    const trimmed = Math.max(0, end - a.start);
    const peak = info ? Samples.peak(a.sampleId) : 0;
    $("wave-status").textContent = !info ? (Samples.isMissing(a.sampleId) ? "This sound isn't in this browser. Import the song file that has it, or Replace sound." : "Loading the sound…")
      : `${info.name}: ${dur.toFixed(2)} s, ${info.rate} Hz, ${info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : info.channels + " channels"}, ` +
        (peak < 1e-5 ? "silent" : `peak ${(Math.round(WaveOps.gainToDb(peak) * 10) / 10 || 0).toFixed(1).replace("-", "−")} dB`) +
        ` · playing ${trimmed.toFixed(2)} s` +
        (a.fit ? `, fitted to the ${o.c.bars}-bar loop (${(trimmed / loopSecs).toFixed(2)}× speed)`
          : trimmed > loopSecs + 0.01 ? `; the ${o.c.bars}-bar loop (${loopSecs.toFixed(2)} s) cuts it short` : "");
    if (!hearing) showWaveTime();
    drawWave(o, dur);
    drawRuler(viewOf(dur));
    if (waveZoom) waveZoom.draw();
  }
  // The big time: where the selection starts, or the pointer, or the playhead.
  function showWaveTime(t) {
    $("wave-time").textContent = clock(t == null ? (waveSel ? waveSel.from : waveCursor) : t);
  }
  // The part of the sound in view, dimmed, with the trimmed part bright,
  // fades as slopes, the selection, and handles to drag: the trim edges
  // and the fade corners.
  function drawWave(o, dur) {
    const a = o.c.audio;
    waveEl.textContent = "";
    waveEl.style.setProperty("--track", `var(--c-${o.t.color})`);
    if (!dur) return;
    const view = viewOf(dur);
    const W = 1000, H = 100, n = 1000;
    waveEl.classList.toggle("spectral", waveSpectral);
    if (waveSpectral) {
      if (!drawSpectral(a, view)) return;
    } else {
      const peaks = Samples.outline(a.sampleId, a.reverse, view.start, view.end, n);
      if (!peaks) return;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("preserveAspectRatio", "none");
      let top = "", bottom = "";
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W;
        top += `${x.toFixed(1)},${(H / 2 - peaks[i * 2 + 1] * H / 2).toFixed(1)} `;
        bottom = `${x.toFixed(1)},${(H / 2 - peaks[i * 2] * H / 2).toFixed(1)} ` + bottom;
      }
      const shape = document.createElementNS(ns, "polygon");
      shape.setAttribute("points", top + bottom);
      shape.setAttribute("class", "wave-shape");
      svg.append(shape);
      waveEl.append(svg);
    }
    const pct = (q) => ((q - view.start) / (view.end - view.start)) * 100;
    // Puts a box over seconds from..to of the sound, wherever that shows.
    const place = (el, from, to) => {
      const p0 = pct(mirror(a, dur, a.reverse ? to : from)), p1 = pct(mirror(a, dur, a.reverse ? from : to));
      el.style.left = p0 + "%";
      el.style.width = p1 - p0 + "%";
    };
    const end = a.end == null ? dur : Math.min(a.end, dur);
    const part = document.createElement("div");
    part.className = "wave-part";
    place(part, a.start, end);
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
    if (waveSel) {
      const sel = document.createElement("div");
      sel.className = "wave-sel";
      place(sel, waveSel.from, waveSel.to);
      waveEl.append(sel);
    } else {
      const cur = document.createElement("div");
      cur.className = "wave-cursor";
      cur.style.left = pct(mirror(a, dur, waveCursor)) + "%";
      waveEl.append(cur);
    }
    for (const q of a.cues || []) {
      const cue = document.createElement("div"), name = document.createElement("span");
      cue.className = "wave-cue";
      cue.style.left = pct(mirror(a, dur, q.t)) + "%";
      name.textContent = q.name;
      cue.append(name);
      waveEl.append(cue);
    }
    if (hearing) {
      const head = document.createElement("div");
      head.className = "wave-head";
      head.style.left = pct(hearing.pos == null ? hearing.from : hearing.pos) + "%";
      waveEl.append(head);
    }
  }
  // The spectral view: a picture of the pitches over time (dark = silent,
  // through purple and orange to pale yellow = loud). It's kept until the
  // sound or the view changes, so dragging a selection doesn't redo it.
  const SPEC_COLS = 500, SPEC_ROWS = 128;
  const SPEC_COLORS = [[0, 8, 8, 20], [80, 70, 20, 110], [160, 220, 90, 60], [220, 255, 200, 80], [255, 255, 255, 235]];
  function drawSpectral(a, view) {
    const key = [a.sampleId, a.reverse, view.start, view.end].join("|");
    if (!spectralPic || spectralPic.key !== key) {
      const pic = Samples.spectrum(a.sampleId, a.reverse, view.start, view.end, SPEC_COLS, SPEC_ROWS);
      if (!pic) return false;
      const canvas = document.createElement("canvas");
      canvas.width = SPEC_COLS;
      canvas.height = SPEC_ROWS;
      const g = canvas.getContext("2d"), img = g.createImageData(SPEC_COLS, SPEC_ROWS);
      for (let c = 0; c < SPEC_COLS; c++) {
        for (let r = 0; r < SPEC_ROWS; r++) {
          const v = pic[c * SPEC_ROWS + r], hi = SPEC_COLORS.findIndex((s) => s[0] >= v), lo = Math.max(0, hi - 1);
          const [v0, ...c0] = SPEC_COLORS[lo], [v1, ...c1] = SPEC_COLORS[hi], f = v1 === v0 ? 0 : (v - v0) / (v1 - v0);
          const at = ((SPEC_ROWS - 1 - r) * SPEC_COLS + c) * 4; // low pitches at the bottom
          for (let k = 0; k < 3; k++) img.data[at + k] = c0[k] + (c1[k] - c0[k]) * f;
          img.data[at + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      spectralPic = { key, canvas };
    }
    waveEl.append(spectralPic.canvas);
    const rate = Samples.info(a.sampleId).rate;
    for (const hz of [100, 1000, 10000]) {
      if (hz >= rate / 2) continue;
      const label = document.createElement("span");
      label.className = "wave-hz";
      label.style.bottom = (Math.log(hz / 50) / Math.log(rate / 2 / 50)) * 100 + "%";
      label.textContent = hz >= 1000 ? hz / 1000 + " kHz" : hz + " Hz";
      waveEl.append(label);
    }
    return true;
  }
  // Times under the wave, about eight of them however far in the view is.
  function drawRuler(view) {
    const el = $("wave-ruler"), span = view.end - view.start;
    el.textContent = "";
    if (!(span > 0)) return;
    const step = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => span / s <= 8) || 600;
    const places = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    for (let k = Math.ceil(view.start / step - 1e-9); k * step < view.end; k++) {
      const t = k * step, tick = document.createElement("span");
      tick.style.left = ((t - view.start) / span) * 100 + "%";
      tick.textContent = step >= 60 || t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : t.toFixed(places) + " s";
      el.append(tick);
    }
  }
  function redrawWave() {
    const o = openAudio();
    if (o) renderWave(o);
  }

  // --- the view: zoom in on part of the sound ---
  function setWaveView(start, end) {
    const o = openAudio(), dur = o ? soundSecs(o.c.audio.sampleId) : 0;
    if (!dur) return;
    const span = Math.max(Math.min(0.01, dur), Math.min(dur, end - start));
    const from = Math.max(0, Math.min(dur - span, start));
    waveView = span >= dur - 1e-6 ? null : { start: from, end: from + span };
    renderWave(o);
  }
  waveZoom = ZoomBar.create($("wave-zoombar"), {
    label: "Sound", unit: (n) => (n / 1000).toFixed(2), total: (n) => (n / 1000).toFixed(2) + " seconds",
    get: () => {
      const o = openAudio(), dur = o ? soundSecs(o.c.audio.sampleId) : 0, v = viewOf(dur);
      return { start: v.start * 1000, end: v.end * 1000, total: Math.round(dur * 1000) };
    },
    set: (a, b) => setWaveView(a / 1000, b / 1000),
    fit: () => setWaveView(0, Infinity),
  });
  // Zooming keeps the selection (or else the middle of the view) in the middle.
  function zoomWave(by) {
    const o = openAudio(), dur = o ? soundSecs(o.c.audio.sampleId) : 0;
    if (!dur) return;
    const a = o.c.audio, v = viewOf(dur);
    const mid = waveSel ? mirror(a, dur, (waveSel.from + waveSel.to) / 2) : (v.start + v.end) / 2;
    const half = ((v.end - v.start) * by) / 2;
    setWaveView(mid - half, mid + half);
  }
  $("wz-in").addEventListener("click", () => zoomWave(0.5));
  $("wz-out").addEventListener("click", () => zoomWave(2));
  $("wz-fit").addEventListener("click", () => { setWaveView(0, Infinity); Announce.say("Whole sound in view"); });
  $("wz-sel").addEventListener("click", () => {
    const o = openAudio();
    if (!o || !waveSel) return;
    const dur = soundSecs(o.c.audio.sampleId), len = waveSel.to - waveSel.from, pad = len * 0.05;
    const p0 = mirror(o.c.audio, dur, o.c.audio.reverse ? waveSel.to : waveSel.from);
    setWaveView(p0 - pad, p0 + len + pad);
    Announce.say("Selection in view");
  });

  // --- the selection ---
  function setWaveSel(from, to, say) {
    const o = openAudio(), dur = o ? soundSecs(o.c.audio.sampleId) : 0;
    if (!dur) return;
    const a = Math.max(0, Math.min(dur, Math.min(from, to))), b = Math.max(0, Math.min(dur, Math.max(from, to)));
    waveSel = b - a < 0.001 ? null : { from: a, to: b };
    waveCursor = a; // an empty selection is the cursor
    renderWave(o);
    if (say) Announce.say(waveSel ? `Selected ${selWords(waveSel)}` : `Nothing selected. Cursor at ${a.toFixed(2)} seconds`);
  }
  // With nothing selected, Select from is the cursor: type To or Length to select from there.
  $("sel-from").addEventListener("change", (e) => {
    const v = Number(e.target.value) || 0;
    setWaveSel(v, waveSel && waveSel.to > v ? waveSel.to : v, true);
  });
  $("sel-to").addEventListener("change", (e) => {
    const v = Number(e.target.value) || 0, from = waveSel ? waveSel.from : waveCursor;
    setWaveSel(from < v ? from : 0, v, true);
  });
  $("sel-len").addEventListener("change", (e) => {
    const from = waveSel ? waveSel.from : waveCursor;
    setWaveSel(from, from + (Number(e.target.value) || 0), true);
  });
  $("sel-all").addEventListener("click", () => setWaveSel(0, Infinity, true));
  $("sel-none").addEventListener("click", () => setWaveSel(waveCursor, waveCursor, true));
  // --- markers: named points in the sound, to jump to and select between ---
  const cueList = $("cue-list");
  const cursorTime = () => (waveSel ? waveSel.from : waveCursor);
  function renderCues(a) {
    const cues = a.cues || [], sig = JSON.stringify(cues);
    $("cue-between").disabled = !cues.length;
    $("cue-name").placeholder = `Marker ${cues.length + 1}`;
    if (cueList.dataset.sig === sig) return; // unchanged: keep the focus where it is
    cueList.dataset.sig = sig;
    cueList.textContent = "";
    cues.forEach((q, i) => {
      const li = document.createElement("li"), go = document.createElement("button"), del = document.createElement("button");
      go.type = del.type = "button";
      go.className = "cue-go";
      go.dataset.go = i;
      go.textContent = `${q.name}, ${clock(q.t)}`;
      del.className = "cue-del";
      del.dataset.del = i;
      del.textContent = "Remove";
      del.setAttribute("aria-label", `Remove marker ${q.name}`);
      li.append(go, del);
      cueList.append(li);
    });
  }
  $("cue-add").addEventListener("click", () => {
    const o = openAudio();
    if (!o) return;
    const cues = o.c.audio.cues || [], t = cursorTime();
    if (cues.length >= Song.CUES_MAX) { Announce.say(`A sound holds ${Song.CUES_MAX} markers at most. Remove one first.`); return; }
    const name = $("cue-name").value.trim() || `Marker ${cues.length + 1}`;
    $("cue-name").value = "";
    editAudio((a) => { a.cues = [...cues, { t, name }]; }, `Marker ${name} at ${t.toFixed(2)} seconds`);
  });
  cueList.addEventListener("click", (e) => {
    const o = openAudio(), b = e.target.closest("button");
    if (!o || !b) return;
    const cues = o.c.audio.cues || [], q = cues[Number(b.dataset.go ?? b.dataset.del)];
    if (!q) return;
    if (b.dataset.del != null) {
      editAudio((a) => { a.cues = cues.filter((x) => x !== q); }, `Removed marker ${q.name}`);
      (cueList.querySelector("button") || $("cue-add")).focus();
      return;
    }
    // Go: the cursor moves there, and the view follows if it's out of sight.
    const dur = soundSecs(o.c.audio.sampleId), v = viewOf(dur), at = mirror(o.c.audio, dur, q.t);
    if (at < v.start || at > v.end) { const half = (v.end - v.start) / 2; waveView = { start: Math.max(0, at - half), end: Math.max(0, at - half) + half * 2 }; }
    setWaveSel(q.t, q.t, false);
    Announce.say(`Cursor at marker ${q.name}, ${q.t.toFixed(2)} seconds`);
  });
  $("cue-between").addEventListener("click", () => {
    const o = openAudio();
    if (!o) return;
    const times = (o.c.audio.cues || []).map((q) => q.t), c = cursorTime();
    const from = Math.max(0, ...times.filter((t) => t <= c)), to = Math.min(soundSecs(o.c.audio.sampleId), ...times.filter((t) => t > c));
    setWaveSel(from, to, true);
  });
  $("wz-spec").addEventListener("click", () => {
    waveSpectral = !waveSpectral;
    redrawWave();
    Announce.say(waveSpectral ? "Spectral view: the pitches over time" : "Wave view");
  });

  // The sound without the silence before and after it.
  $("sel-sound").addEventListener("click", () => {
    const o = openAudio(), buf = o && Samples.buffer(o.c.audio.sampleId);
    if (!buf) return;
    const [a, b] = WaveOps.soundSpan(Samples.channels(buf));
    if (b <= a) { Announce.say("The whole sound is silent"); return; }
    setWaveSel(a / buf.sampleRate, b / buf.sampleRate, true);
  });
  // Moves each end of the selection (or the cursor) to the nearest place
  // the wave crosses zero, within a 50th of a second: cuts there don't click.
  $("sel-zero").addEventListener("click", () => {
    const o = openAudio(), buf = o && Samples.buffer(o.c.audio.sampleId);
    if (!buf) return;
    const rate = buf.sampleRate, chans = Samples.channels(buf);
    const snap = (t) => WaveOps.zeroNear(chans, t * rate, Math.round(rate / 50)) / rate;
    if (waveSel) setWaveSel(snap(waveSel.from), snap(waveSel.to), true);
    else setWaveSel(snap(waveCursor), snap(waveCursor), true);
  });
  $("sel-trim").addEventListener("click", () => {
    const o = openAudio();
    if (o) setWaveSel(o.c.audio.start, o.c.audio.end == null ? Infinity : o.c.audio.end, true);
  });

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
  $("wave-reverse").addEventListener("click", () => editAudio((a) => { a.reverse = !a.reverse; waveView = null; }, "Play backwards " + ($("wave-reverse").getAttribute("aria-pressed") === "true" ? "off" : "on")));
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

  // --- edits to the sound itself. Each makes an edited copy of the sound
  // and points the clip at it, so Undo (the old id) brings the sound back. ---
  // fn(chans, from, to, a) -> { chans, say, then(a) } or null; from/to are frames.
  function editSound(fn) {
    const o = openAudio();
    const buf = o && Samples.buffer(o.c.audio.sampleId);
    if (!buf) return;
    stopHearing();
    const a = o.c.audio, sel = waveSel, rate = buf.sampleRate;
    const from = sel ? Math.round(sel.from * rate) : 0, to = sel ? Math.round(sel.to * rate) : buf.length;
    const done = fn(Samples.channels(buf), from, to, a);
    if (!done) return;
    const id = Samples.addEdited(a.sampleId, done.chans);
    if (!id) return;
    a.sampleId = id;
    // An edit that changed the sound's length says where each moment went:
    // the trim points and the markers follow.
    if (done.move) {
      a.start = done.move(a.start);
      a.end = a.end == null ? null : done.move(a.end);
      if ((a.end == null ? soundSecs(id) : a.end) - a.start < 0.01) { a.start = 0; a.end = null; }
      if (a.cues) a.cues = a.cues.map((q) => ({ ...q, t: done.move(q.t) }));
    }
    o.c.audio = Song.cleanAudio(a) || a;
    afterChange(done.where === "" ? done.say : `${done.say}: ${sel ? selWords(sel) : "the whole sound"}`);
  }

  // --- copy, cut and paste a stretch (in this sound, or into another clip's) ---
  function waveCopy(cut) {
    const o = openAudio();
    const buf = o && Samples.buffer(o.c.audio.sampleId);
    if (!buf) return;
    if (cut && !waveSel) { Announce.say("Select the stretch to cut first"); return; }
    const sel = waveSel || { from: 0, to: buf.duration }, rate = buf.sampleRate;
    waveCopied = { chans: WaveOps.slice(Samples.channels(buf), sel.from * rate, sel.to * rate), rate, secs: sel.to - sel.from };
    if (cut) { cutWaveSel("Cut"); return; }
    renderWave(o);
    Announce.say(`Copied ${waveSel ? selWords(sel) : "the whole sound"}`);
  }
  // Cuts the selection out of the sound; the trim points move with it.
  function cutWaveSel(say) {
    const sel = waveSel;
    if (!sel) return;
    editSound((chans, from, to) => {
      const out = WaveOps.remove(chans, from, to);
      if (out[0].length < 64) { Announce.say("That would leave no sound. Select a part of it."); return null; }
      waveSel = waveView = null;
      waveCursor = sel.from;
      return {
        chans: out, say,
        move: (t) => WaveOps.afterCut(t, sel.from, sel.to),
      };
    });
  }
  // Paste goes in at the cursor, or takes the selection's place; mixed in,
  // it lays on top from there and nothing moves.
  function wavePaste(mixed) {
    if (!waveCopied) { Announce.say("Nothing copied yet. Select a stretch and Copy it first."); return; }
    const copied = waveCopied;
    putPiece(() => copied, mixed, mixed ? "Mixed in" : "Pasted");
  }
  // Puts a piece of sound in: `make(rate)` gives { chans, rate } (a copy, or
  // a newly generated sound at this sound's own sample rate).
  function putPiece(make, mixed, verb) {
    if (!openAudio()) return;
    const sel = waveSel, at = sel ? sel.from : waveCursor;
    editSound((chans, from, to, a) => {
      const rate = Samples.info(a.sampleId).rate, made = make(rate);
      const piece = WaveOps.fit(made.chans, made.rate, rate, chans.length);
      const secs = piece[0].length / rate, frame = Math.round(at * rate);
      const out = mixed ? WaveOps.mix(chans, frame, piece) : WaveOps.insert(sel ? WaveOps.remove(chans, from, to) : chans, frame, piece);
      waveSel = { from: at, to: at + secs };
      waveView = null;
      return {
        chans: out, where: "",
        say: `${verb} ${secs.toFixed(2)} seconds at ${at.toFixed(2)}` + (mixed && WaveOps.peak(out, frame, frame + piece[0].length) > 1 ? ", and too loud now (the tops are cut flat)" : ""),
        move: mixed ? null : (t) => WaveOps.afterInsert(sel ? WaveOps.afterCut(t, sel.from, sel.to) : t, at, secs),
      };
    });
  }
  $("wave-copy").addEventListener("click", () => waveCopy(false));
  $("wave-cut").addEventListener("click", () => waveCopy(true));
  $("wave-paste").addEventListener("click", () => wavePaste(false));
  $("wave-paste-mix").addEventListener("click", () => wavePaste(true));

  // --- Generate: silence, a tone or noise, put in like a paste ---
  const field = (id, lo, hi, fallback) => { const v = Number($(id).value); return Number.isFinite(v) && $(id).value !== "" ? Math.max(lo, Math.min(hi, v)) : fallback; };
  const genSecs = () => field("gen-secs", 0.01, 60, 1);
  $("gen-silence").addEventListener("click", () => {
    const secs = genSecs();
    putPiece((rate) => ({ chans: [new Float32Array(Math.round(secs * rate))], rate }), false, "Inserted silence,");
  });
  $("gen-tone").addEventListener("click", () => {
    const secs = genSecs(), hz = field("gen-hz", 20, 16000, 440), shape = $("gen-shape").value, level = WaveOps.dbToGain(field("gen-db", -48, 0, -6));
    putPiece((rate) => ({ chans: WaveOps.tone(rate, secs, { shape, hz, level }), rate }), false, `Inserted a ${hz} Hz ${shape} tone,`);
  });
  $("gen-noise").addEventListener("click", () => {
    const secs = genSecs(), level = WaveOps.dbToGain(field("gen-db", -48, 0, -6));
    putPiece((rate) => ({ chans: WaveOps.noise(rate, secs, level), rate }), false, "Inserted noise,");
  });

  // --- Effects: on the selection, or the whole sound ---
  const tooLoud = (chans, from, to) => (WaveOps.peak(chans, from, to) > 1 ? ", and too loud now (the tops are cut flat)" : "");
  $("fx-echo").addEventListener("click", () => {
    const delay = field("fx-delay", 10, 2000, 250) / 1000, feedback = field("fx-feedback", 5, 90, 40) / 100;
    editSound((chans, from, to, a) => {
      const out = WaveOps.echo(chans, from, to, Samples.info(a.sampleId).rate, { delay, feedback });
      return { chans: out, say: `Echo every ${Math.round(delay * 1000)} ms` + tooLoud(out, from, out[0].length) };
    });
  });
  for (const kind of ["low", "high"]) {
    $("fx-" + kind).addEventListener("click", () => {
      const hz = field("fx-hz", 20, 20000, 1000);
      editSound((chans, from, to, a) => ({
        chans: WaveOps.filter(chans, from, to, Samples.info(a.sampleId).rate, kind, hz),
        say: `${kind === "low" ? "Highs" : "Lows"} cut ${kind === "low" ? "above" : "below"} ${hz} Hz`,
      }));
    });
  }
  $("fx-reverb").addEventListener("click", () => {
    const size = field("fx-room", 0, 100, 50) / 100, mix = field("fx-wet", 5, 100, 35) / 100;
    editSound((chans, from, to, a) => {
      const out = WaveOps.reverb(chans, from, to, Samples.info(a.sampleId).rate, { size, mix });
      return { chans: out, say: `Reverb, a ${size < 0.34 ? "small" : size < 0.67 ? "medium" : "big"} room` + tooLoud(out, from, out[0].length) };
    });
  });
  $("fx-compress").addEventListener("click", () => {
    const threshold = field("fx-thresh", -60, 0, -18), ratio = field("fx-ratio", 1.5, 20, 4);
    editSound((chans, from, to, a) => {
      const { chans: out, db, touched } = WaveOps.compress(chans, from, to, Samples.info(a.sampleId).rate, { threshold, ratio });
      if (!touched) { Announce.say(`Nothing here is louder than ${threshold} dB. Type a lower number in Squash above.`); return null; }
      return { chans: out, say: `Compressed: quiet parts are ${db.toFixed(1)} dB louder` };
    });
  });

  for (const kind of ["chorus", "flanger"]) {
    $("fx-" + kind).addEventListener("click", () => editSound((chans, from, to, a) =>
      ({ chans: WaveOps[kind](chans, from, to, Samples.info(a.sampleId).rate), say: kind === "chorus" ? "Chorus" : "Flanger" })));
  }
  const signedDb = (v) => `${v > 0 ? "up" : "down"} ${Math.abs(v)} dB`;
  $("eq-go").addEventListener("click", () => {
    const set = { bass: field("eq-bass", -18, 18, 0), mid: field("eq-mid", -18, 18, 0), treble: field("eq-treble", -18, 18, 0) };
    const words = [["bass", set.bass], ["middle", set.mid], ["treble", set.treble]].filter(([, v]) => v).map(([n, v]) => `${n} ${signedDb(v)}`);
    if (!words.length) { Announce.say("Type how many decibels to turn the bass, middle or treble up. Minus turns it down."); return; }
    editSound((chans, from, to, a) => {
      const out = WaveOps.eq(chans, from, to, Samples.info(a.sampleId).rate, set);
      return { chans: out, say: `Equalized, ${words.join(", ")}` + tooLoud(out, from, to) };
    });
  });

  // --- Clean up: noise reduction (learn the noise, then take it out) and silences ---
  $("nr-learn").addEventListener("click", () => {
    const o = openAudio(), buf = o && Samples.buffer(o.c.audio.sampleId);
    if (!buf || !waveSel) { Announce.say("Select a stretch that is only the noise first"); return; }
    const rate = buf.sampleRate, profile = WaveOps.noiseProfile(Samples.channels(buf), waveSel.from * rate, waveSel.to * rate, rate);
    if (!profile) { Announce.say(`That's too short to learn from. Select at least ${(1024 / rate).toFixed(2)} seconds of noise.`); return; }
    waveNoise = profile;
    $("nr-status").textContent = `Noise learned from ${selWords(waveSel)}. Now select what to clean and Reduce noise.`;
    $("nr-go").disabled = false;
    Announce.say($("nr-status").textContent);
  });
  $("nr-go").addEventListener("click", () => {
    const profile = waveNoise, amount = field("nr-amount", 10, 100, 80) / 100;
    if (!profile) { Announce.say("Learn the noise first: select a stretch that is only the noise."); return; }
    editSound((chans, from, to, a) => {
      if (Samples.info(a.sampleId).rate !== profile.rate) { Announce.say("That noise was learned from a different kind of sound file. Learn it again from this sound."); return null; }
      return { chans: WaveOps.denoise(chans, from, to, profile, amount), say: `Noise reduced by ${Math.round(amount * 100)} %` };
    });
  });
  $("dc-go").addEventListener("click", () => editSound((chans, from, to) => {
    const { chans: out, count } = WaveOps.declick(chans, from, to);
    if (!count) { Announce.say("No clicks found here"); return null; }
    return { chans: out, say: `Mended ${count} click${count === 1 ? "" : "s"}` };
  }));
  $("ds-go").addEventListener("click", () => {
    const gap = field("ds-gap", 50, 10000, 300) / 1000, floor = WaveOps.dbToGain(field("ds-floor", -80, -20, -48));
    editSound((chans, from, to, a) => {
      const rate = Samples.info(a.sampleId).rate, { chans: out, cuts } = WaveOps.deleteSilence(chans, from, to, rate, { floor, gap });
      if (!cuts.length) { Announce.say(`No silences over ${Math.round(gap * 1000)} ms here`); return null; }
      if (out[0].length < 64) { Announce.say("It's all silence: that would leave no sound."); return null; }
      const gone = cuts.reduce((s, [x, y]) => s + y - x, 0) / rate;
      waveSel = waveView = null;
      waveCursor = from / rate;
      return {
        chans: out, say: `Deleted ${cuts.length} silence${cuts.length === 1 ? "" : "s"}, ${gone.toFixed(2)} seconds`,
        move: (t) => cuts.reduceRight((at, [x, y]) => WaveOps.afterCut(at, x / rate, y / rate), t),
      };
    });
  });

  // --- Time and pitch: the stretch changes length, so the selection and the trim follow it ---
  function resizeSound(say, fn) {
    const sel = waveSel;
    editSound((chans, from, to, a) => {
      const rate = Samples.info(a.sampleId).rate, out = fn(chans, from, to, rate);
      const t0 = from / rate, t1 = to / rate, len = (to - from + out[0].length - chans[0].length) / rate;
      if (sel) waveSel = { from: t0, to: t0 + len };
      waveView = null;
      return {
        chans: out, say,
        move: (t) => WaveOps.afterResize(t, t0, t1, len),
      };
    });
  }
  const semitones = () => {
    const semis = Math.round(field("fx-semis", -24, 24, 0));
    if (!semis) Announce.say("Type how many semitones to shift by. 12 is an octave up, minus 12 an octave down.");
    return semis;
  };
  const semiWords = (n) => `${Math.abs(n)} semitone${Math.abs(n) === 1 ? "" : "s"}`;
  $("fx-speed").addEventListener("click", () => {
    const semis = semitones();
    if (semis) resizeSound(`${semiWords(semis)} ${semis > 0 ? "higher and faster" : "lower and slower"}`, (chans, from, to) => WaveOps.speed(chans, from, to, Math.pow(2, semis / 12)));
  });
  $("tp-pitch").addEventListener("click", () => {
    const semis = semitones();
    if (semis) resizeSound(`${semiWords(semis)} ${semis > 0 ? "higher" : "lower"}, the same length`, (chans, from, to, rate) => WaveOps.pitch(chans, from, to, rate, semis));
  });
  $("tp-stretch").addEventListener("click", () => {
    const percent = Math.round(field("tp-percent", 25, 400, 100));
    if (percent === 100) { Announce.say("Type how long to make it: 200 is twice as long, 50 half."); return; }
    resizeSound(`Stretched to ${percent} % as long, at the same pitch`, (chans, from, to, rate) => WaveOps.stretch(chans, from, to, rate, percent / 100));
  });
  // The wave has the keys once it's clicked, until something outside the wave editor is.
  document.addEventListener("pointerdown", (e) => { waveActive = !!(e.target.closest && e.target.closest("#wave-editor")); }, true);
  $("op-amplify").addEventListener("click", () => {
    const db = Math.max(-48, Math.min(48, Number($("op-db").value) || 0));
    if (!db) { Announce.say("Type how many decibels to amplify by. Minus makes it quieter."); return; }
    editSound((chans, from, to) => {
      const out = WaveOps.amplify(chans, from, to, db);
      return { chans: out, say: `${db > 0 ? "Louder" : "Quieter"} by ${Math.abs(db)} dB` + (WaveOps.peak(out, from, to) > 1 ? ", and too loud now (the tops are cut flat)" : "") };
    });
  });
  $("op-normalize").addEventListener("click", () => editSound((chans, from, to) => {
    const { chans: out, db } = WaveOps.normalize(chans, from, to);
    if (Math.abs(db) < 0.05) { Announce.say(WaveOps.peak(chans, from, to) > 0.5 ? "Already as loud as it goes" : "Nothing to normalize: it's silent"); return null; }
    return { chans: out, say: `Normalized, ${db > 0 ? "up" : "down"} ${Math.abs(db).toFixed(1)} dB` };
  }));
  $("op-ramp").addEventListener("click", () => {
    const db0 = field("ramp-from", -60, 24, 0), db1 = field("ramp-to", -60, 24, -12);
    if (db0 === db1) { Announce.say("Type two different levels to slide between. For one level, use Amplify."); return; }
    // Played backwards, the picture is mirrored: ramp the way it looks and sounds.
    editSound((chans, from, to, a) => {
      const out = a.reverse ? WaveOps.ramp(chans, from, to, db1, db0) : WaveOps.ramp(chans, from, to, db0, db1);
      return { chans: out, say: `Volume ramp from ${db0} to ${db1} dB` + tooLoud(out, from, to) };
    });
  });
  // Played backwards, the picture is mirrored: fade the way it looks and sounds.
  for (const dir of ["in", "out"]) {
    $("op-fade" + dir).addEventListener("click", () => editSound((chans, from, to, a) =>
      ({ chans: WaveOps.fade(chans, from, to, a.reverse ? (dir === "in" ? "out" : "in") : dir), say: "Faded " + dir })));
  }
  $("op-silence").addEventListener("click", () => editSound((chans, from, to) => ({ chans: WaveOps.silence(chans, from, to), say: "Silenced" })));
  $("op-reverse").addEventListener("click", () => editSound((chans, from, to) => ({ chans: WaveOps.reverse(chans, from, to), say: "Reversed" })));
  $("op-delete").addEventListener("click", () => cutWaveSel("Deleted"));
  $("op-trim").addEventListener("click", () => {
    const sel = waveSel;
    if (sel) editAudio((a) => { a.start = sel.from; a.end = sel.to; }, `The clip now plays only ${selWords(sel)}`);
  });

  // --- Hear it: the selection, or the clip as it plays in the song ---
  function stopHearing() {
    if (!hearing) return;
    hearing.synth.allOff();
    hearing = null;
    redrawWave();
  }
  function followHearing() {
    const o = hearing && openAudio();
    if (!o) { hearing = null; return; }
    const pos = hearing.from + (Engine.ctx.currentTime - hearing.at) * hearing.rate;
    if (pos >= hearing.from + hearing.length) { hearing = null; renderWave(o); return; }
    const a = o.c.audio, dur = soundSecs(a.sampleId), view = viewOf(dur);
    hearing.pos = Math.max(hearing.from, pos);
    const head = waveEl.querySelector(".wave-head");
    if (head) head.style.left = ((hearing.pos - view.start) / (view.end - view.start)) * 100 + "%";
    showWaveTime(mirror(a, dur, hearing.pos));
    requestAnimationFrame(followHearing);
  }
  $("wave-hear").addEventListener("click", () => {
    if (hearing) { stopHearing(); return; }
    const o = openAudio();
    if (!o || (transport && transport.playing)) return;
    ready().then(() => {
      const a = o.c.audio, buf = Samples.buffer(a.sampleId, a.reverse);
      if (!buf || hearing) return;
      const from = o.clip.start * Song.STEPS;
      const seg = waveSel
        ? { offset: a.reverse ? buf.duration - waveSel.to : waveSel.from, length: waveSel.to - waveSel.from, rate: 1, fadeIn: 0, fadeOut: 0, gain: a.gain }
        : Song.audioSegment(song, o.t, from, from, soundSecs, Song.stepSeconds(song, from));
      if (!seg) return;
      const synth = audio[o.t.id].synth, at = Engine.ctx.currentTime + 0.03;
      synth.playAudio(buf, seg, at);
      hearing = { at, from: seg.offset, length: seg.length, rate: seg.rate, synth };
      renderWave(o);
      requestAnimationFrame(followHearing);
    });
  });

  // Dragging: the trim edges and the fade knobs, or anywhere else to select.
  waveEl.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    const what = (e.target.dataset && e.target.dataset.drag) || "select";
    const o = openAudio();
    const info = o && Samples.info(o.c.audio.sampleId);
    if (!info) return;
    e.preventDefault();
    waveEl.setPointerCapture(e.pointerId);
    const box = waveEl.getBoundingClientRect(), dur = info.duration, a = o.c.audio, view = viewOf(dur);
    const at = (ev) => view.start + Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width)) * (view.end - view.start); // seconds along the picture
    const anchor = mirror(a, dur, at(e));
    let moved = false;
    const move = (ev) => {
      const q = at(ev), t = mirror(a, dur, q); // ...and in the sound itself
      if (what === "select") {
        if (!moved && Math.abs(ev.clientX - e.clientX) < 3) return;
        moved = true;
        waveSel = Math.abs(t - anchor) < 0.001 ? null : { from: Math.min(anchor, t), to: Math.max(anchor, t) };
      } else {
        const end = a.end == null ? dur : a.end;
        // The trimmed part as it shows (in playing order): fades are measured from its edges.
        const v0 = a.reverse ? dur - end : a.start, v1 = a.reverse ? dur - a.start : end, half = (end - a.start) / 2;
        if (what === "start") a.start = Math.max(0, Math.min(t, end - 0.01));
        else if (what === "end") a.end = Math.min(dur, Math.max(t, a.start + 0.01));
        else if (what === "fadeIn") a.fadeIn = Math.max(0, Math.min(q - v0, half));
        else a.fadeOut = Math.max(0, Math.min(v1 - q, half));
        timeline.render();
      }
      renderWave(o);
    };
    const up = () => {
      waveEl.removeEventListener("pointermove", move);
      if (what === "select") {
        if (!moved) { waveSel = null; waveCursor = anchor; } // a plain click lets go of the selection and puts the cursor there
        renderWave(o);
        if (moved && waveSel) Announce.say(`Selected ${selWords(waveSel)}`);
        return;
      }
      editAudio(() => {}, what === "start" || what === "end" ? `Trimmed: ${a.start.toFixed(2)} to ${(a.end == null ? dur : a.end).toFixed(2)} seconds`
        : `Fade ${what === "fadeIn" ? "in" : "out"} ${Math.round(a[what] * 1000)} ms`);
    };
    waveEl.addEventListener("pointermove", move);
    waveEl.addEventListener("pointerup", up, { once: true });
    waveEl.addEventListener("pointercancel", up, { once: true });
  });
  // The big time follows the pointer over the wave.
  waveEl.addEventListener("pointermove", (e) => {
    const o = openAudio(), dur = o ? soundSecs(o.c.audio.sampleId) : 0;
    if (!dur || hearing) return;
    const box = waveEl.getBoundingClientRect(), view = viewOf(dur);
    showWaveTime(mirror(o.c.audio, dur, view.start + Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * (view.end - view.start)));
  });
  waveEl.addEventListener("pointerleave", () => { if (!hearing) showWaveTime(); });

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
  // Split: the selected clip, at the play cursor (clips sit on bar lines,
  // so that's where they cut). Each half is its own clip from then on.
  function clipSplit() {
    const p = pickedClip();
    if (!p) { Announce.say("Select a clip first"); return; }
    const bar = song.cursor, end = Song.clipEnd(p.clip);
    if (bar <= p.clip.start || bar >= end) {
      Announce.say(p.clip.length < 2 ? `${p.c.name} is one bar long, and clips split on a bar line. Stretch it first.`
        : `Put the play cursor inside ${p.c.name} first: click the ruler at bar ${p.clip.start + 2}${end - p.clip.start > 2 ? ` to ${end}` : ""}.`);
      return;
    }
    const right = Song.splitApart(song, p.t, p.clip, bar, soundSecs, Song.stepSeconds(song, bar * Song.STEPS));
    picked = { trackId: p.t.id, clipId: right.id };
    afterChange(`Split ${p.c.name} at bar ${bar + 1}. The second half is its own clip now: ${Song.content(song, right).name}`);
    timeline.focusClip(right);
  }
  $("clip-split").addEventListener("click", clipSplit);
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
    for (const id of ["clip-copy", "clip-cut", "clip-dup", "clip-link", "clip-split", "clip-delete"]) $(id).disabled = !p;
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

  // Copy / cut / paste / duplicate / select all: the sound's selection when
  // the wave was clicked last, notes when the piano roll has focus, clips otherwise. Shared by the Ctrl shortcuts and Edit mode.
  function editAction(k, shift) {
    if (waveActive && openAudio()) {
      if (k === "a") { setWaveSel(0, Infinity, true); return true; }
      if (k === "c") { waveCopy(false); return true; }
      if (k === "x") { waveCopy(true); return true; }
      if (k === "v") { wavePaste(false); return true; }
      return false;
    }
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
  // and an action closes its menu (toggles like Metronome, and buttons
  // marked data-stay like Zoom in, leave it open) ---
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
        if (b && !b.hasAttribute("aria-pressed") && !b.hasAttribute("data-stay") && b.parentElement === menu && b.id !== "tap" && b.id !== "tempo-add") { menu.hidePopover(); btn.focus(); }
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
      if (b && !b.hasAttribute("aria-pressed") && !b.hasAttribute("data-stay") && b.parentElement === menu && b.id !== "tap" && b.id !== "tempo-add") {
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
    $("track-add").disabled = $("track-add-audio").disabled = $("track-add-drums").disabled = song.tracks.length >= Song.MAX_TRACKS;
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
  // A drum track starts with a beat to build on: a 1-bar loop, repeated.
  $("track-add-drums").addEventListener("click", () => {
    const t = Song.addTrack(song, { kind: "drums", name: "Drums" });
    if (!t) { Announce.say(`${Song.MAX_TRACKS} tracks is the most a song can have`); return; }
    const beat = Drums.BEATS[0];
    const c = Song.makeContent(song, t.id, beat.name, 1, Drums.beatNotes(beat, 1));
    const loop = song.loop && song.loop.on;
    Song.addClip(song, t, loop ? song.loop.start : 0, loop ? Math.max(1, song.loop.end - song.loop.start) : 4, c.id);
    syncAudio();
    rebuildMixer();
    selectTrack(t.id, false);
    afterChange(`Added a drum track with the ${beat.name} beat. Open its clip to change the hits or pick another beat.`);
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

  // `fresh`: a song just started (not one opened or copied) begins on the
  // Make slide with a clip open, ready to play into. An empty song gets
  // its first clip made for it.
  function addAndOpen(data, words, fresh) {
    if (saveTimer) writeNow();
    const id = library.add(Song.sanitize(data));
    openSong(id);
    if (fresh) {
      const t = sel();
      if (!t.clips.length && t.kind !== "audio") Song.addClip(song, t, 0, 1);
      if (t.clips.length) openClip(t, t.clips[0], false);
      history.reset(historyJson()); // that first clip isn't a step to undo
      setSlide("make", false);
    }
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
        Samples.tidy(soundsInUse(true)); // its sounds go with it, unless another song (or Undo) uses them
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
  function deliver(blob, name, done, status = exportStatus) {
    if (isIOS && SongFiles.canShare(blob, name)) {
      status.textContent = `${name} is ready. `;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "share-btn";
      b.textContent = `Save ${name} to Files…`;
      b.addEventListener("click", async () => {
        try { await SongFiles.share(blob, name); status.textContent = done; }
        catch (e) { if (!e || e.name !== "AbortError") { SongFiles.download(blob, name); status.textContent = done; } }
      });
      status.append(b);
      b.focus();
      Announce.say(`${name} is ready: press Save to Files`);
      return;
    }
    SongFiles.download(blob, name);
    status.textContent = done;
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
    addAndOpen(blank, `New song: ${blank.title}. You're on the Make slide, with an empty clip open on ${blank.tracks[0].name}.`, true);
    songsDlg.close();
  });
  $("song-demo").addEventListener("click", () => {
    const demo = Song.demoSong();
    demo.title = "Demo song";
    addAndOpen(demo, "New song from the demo, on the Make slide", true);
    songsDlg.close();
  });
  // --- starter loops (src/state/loops.js): a genre's parts into this song,
  // or a new song from them ---
  const loopsDlg = $("loops");
  let loopGenre = Loops.GENRES[0];
  const loopPlace = () => {
    const on = song.loop.on;
    return { bar: on ? song.loop.start : song.cursor, length: on ? song.loop.end - song.loop.start : Loops.BARS };
  };
  // The track a part goes on: the song's drum track for drums; for the rest,
  // a track of that name (added before) or a new one with the part's sound.
  function loopTrack(g, part) {
    if (part.kind === "drums") return song.tracks.find((t) => t.kind === "drums") || Song.addTrack(song, { kind: "drums", name: "Drums" });
    const name = `${g.name} ${part.name}`.slice(0, 24);
    return song.tracks.find((t) => t.kind === "synth" && t.name === name) || Song.addTrack(song, { name, preset: part.preset });
  }
  // Places one part; returns the track, or null if there's no room.
  function addLoopPart(g, part) {
    const t = loopTrack(g, part);
    if (!t) return null;
    const notes = Loops.partNotes(part, Loops.keyFor(song, g));
    const c = Song.makeContent(song, t.id, `${g.name} ${part.name}`.slice(0, 40), Loops.BARS, notes);
    const at = loopPlace();
    let bar = at.bar;
    while (!Song.fits(t, bar, at.length)) bar++;
    if (!Song.addClip(song, t, bar, at.length, c.id)) return null;
    return t;
  }
  function afterLoopAdd(words) {
    syncAudio();
    rebuildMixer();
    timeline.render();
    renderTrackPage();
    afterChange(words);
    $("loop-status").textContent = words;
  }
  function renderLoops() {
    const genres = $("loop-genres");
    genres.textContent = "";
    for (const g of Loops.GENRES) {
      const id = "loop-g-" + g.id;
      const r = Object.assign(document.createElement("input"), { type: "radio", name: "loop-genre", id, value: g.id, checked: g === loopGenre });
      r.addEventListener("change", () => { loopGenre = g; renderLoops(); });
      const l = Object.assign(document.createElement("label"), { htmlFor: id, textContent: g.name });
      genres.append(r, l);
    }
    $("loop-blurb").textContent = `${loopGenre.blurb} ${loopGenre.bpm} bpm.`;
    const list = $("loop-parts");
    list.textContent = "";
    for (const part of loopGenre.parts) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = part.name + (part.kind === "drums" ? " (drum track)" : "");
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: "Add" });
      b.setAttribute("aria-label", `Add ${loopGenre.name} ${part.name}`);
      b.addEventListener("click", () => {
        const had = song.tracks.length;
        const t = addLoopPart(loopGenre, part);
        afterLoopAdd(!t ? "No room: the song already has the most tracks it can"
          : song.tracks.length > had ? `Added ${loopGenre.name} ${part.name} on a new track`
          : `Added ${loopGenre.name} ${part.name} to ${t.name}`);
      });
      li.append(name, b);
      list.append(li);
    }
  }
  function openLoops() {
    if (songsDlg.open) songsDlg.close();
    $("loop-status").textContent = "";
    renderLoops();
    loopsDlg.showModal();
  }
  $("loops-btn").addEventListener("click", openLoops);
  $("song-loops").addEventListener("click", openLoops);
  $("loops-close").addEventListener("click", () => loopsDlg.close());
  loopsDlg.addEventListener("click", (e) => { if (e.target === loopsDlg) loopsDlg.close(); });
  $("loop-add-all").addEventListener("click", () => {
    const added = loopGenre.parts.filter((p) => addLoopPart(loopGenre, p)).length;
    afterLoopAdd(added ? `Added ${added} ${loopGenre.name} part${added > 1 ? "s" : ""}` : "No room for more tracks");
  });
  $("loop-new-song").addEventListener("click", () => {
    const g = loopGenre;
    const s = Song.createSong();
    s.title = `${g.name} song`;
    s.bpm = g.bpm;
    s.key = { ...s.key, root: g.key.root, scale: g.key.scale };
    s.swing = g.swing;
    s.tracks = [];
    for (const part of g.parts) {
      const t = part.kind === "drums" ? Song.addTrack(s, { kind: "drums", name: "Drums" }) : Song.addTrack(s, { name: part.name, preset: part.preset });
      const c = Song.makeContent(s, t.id, `${g.name} ${part.name}`.slice(0, 40), Loops.BARS, Loops.partNotes(part, g.key));
      Song.addClip(s, t, 0, Loops.BARS, c.id);
    }
    s.selected = s.tracks[s.tracks.length - 1].id;
    s.loop = { on: true, start: 0, end: Loops.BARS };
    loopsDlg.close();
    addAndOpen(s, `New ${g.name} song: ${g.parts.length} tracks, looping 4 bars. Press Space to play, then Record to add your own on any track.`, true);
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

  // --- Export (like a DAW's bounce dialog): the mix as WAV or AIFF, stems
  // (a file per track, in a .zip), MIDI notes, or the song info as text ---
  const exportDlg = $("export");
  const exportMsg = $("export-dlg-status");
  const EXPORT_KEY = "sound-studio.export";
  const exportPrefs = (() => { try { return JSON.parse(localStorage.getItem(EXPORT_KEY)) || {}; } catch (e) { return {}; } })();
  const radio = (name) => exportDlg.querySelector(`input[name="${name}"]:checked`).value;
  const setRadio = (name, v) => { const r = exportDlg.querySelector(`input[name="${name}"][value="${v}"]`); if (r) r.checked = true; };

  function syncExport() {
    const what = radio("export-what");
    $("export-audio").disabled = what === "midi" || what === "info";
    // A clip covers its own bars; the song info has none.
    $("export-range-box").disabled = what === "info" || what === "clip";
    const fmt = $("export-format").value;
    $("export-dither").disabled = !fmt.endsWith("16");
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify({
        what, range: radio("export-range"), format: fmt, rate: $("export-rate").value,
        normalize: $("export-normalize").checked, dither: $("export-dither").checked, tail: $("export-tail").checked,
      }));
    } catch (e) { /* private window: just not remembered */ }
  }

  // The clip to export: the one selected on the timeline, else the one open in the editor.
  const exportClip = () => find(picked) || find(open);

  function openExport() {
    const bars = Song.songBars(song);
    const ec = exportClip();
    const clipRadio = exportDlg.querySelector('input[name="export-what"][value="clip"]');
    clipRadio.disabled = !ec;
    $("export-clip-name").textContent = ec
      ? `${ec.c.name} on ${ec.t.name}, bars ${ec.clip.start + 1}-${ec.clip.start + ec.clip.length}`
      : "the selected clip (pick one on the timeline first)";
    $("export-range-all").textContent = `The whole song (bars 1 to ${Math.max(1, bars)})`;
    $("export-range-loop").textContent = `The loop (bars ${song.loop.start + 1} to ${song.loop.end})`;
    $("export-from").max = $("export-to").max = String(Math.max(1, bars));
    if (exportPrefs.what && !(exportPrefs.what === "clip" && !ec)) setRadio("export-what", exportPrefs.what);
    else if (exportPrefs.what === "clip") setRadio("export-what", "mix");
    if (exportPrefs.range && exportPrefs.range !== "bars") setRadio("export-range", exportPrefs.range);
    if (exportPrefs.format) $("export-format").value = exportPrefs.format;
    if (exportPrefs.rate) $("export-rate").value = exportPrefs.rate;
    for (const k of ["normalize", "dither", "tail"]) if (typeof exportPrefs[k] === "boolean") $(`export-${k}`).checked = exportPrefs[k];
    exportMsg.textContent = "";
    syncExport();
    exportDlg.showModal();
  }

  // The bars to export, [from, to), or a reason it can't.
  function exportRange() {
    const bars = Song.songBars(song);
    const range = radio("export-range");
    if (range === "loop") return { from: song.loop.start, to: song.loop.end, label: ` bars ${song.loop.start + 1}-${song.loop.end}` };
    if (range === "bars") {
      const from = Math.round(Number($("export-from").value)), to = Math.round(Number($("export-to").value));
      if (!(from >= 1 && to >= from)) return { error: "Pick the bars to export: from a bar, to the same bar or a later one." };
      return { from: from - 1, to, label: ` bars ${from}-${to}` };
    }
    return { from: 0, to: bars, label: "" };
  }

  // One sound file from a rendered buffer, in the chosen format.
  function soundFile(buffer, gain) {
    const fmt = $("export-format").value;
    const bitDepth = Number(fmt.replace(/\D/g, ""));
    const opts = { bitDepth, gain, dither: bitDepth === 16 && $("export-dither").checked };
    return fmt.startsWith("aiff")
      ? { bytes: Wav.encodeAiff(buffer, opts), ext: ".aiff", type: "audio/aiff" }
      : { bytes: Wav.encode(buffer, opts), ext: ".wav", type: "audio/wav" };
  }

  async function runExport() {
    const what = radio("export-what");
    const go = $("export-go");
    const done = (name, extra = "") => `Saved ${name}${extra}. ${isIOS ? "Keep it in Files." : "Check your downloads."}`;
    if (what === "info") {
      const name = Wav.fileName(song.title, " info.txt");
      deliver(new Blob([SongInfo.text(song)], { type: "text/plain" }), name, done(name), exportMsg);
      return;
    }
    if (!Song.songBars(song)) { exportMsg.textContent = "Add a clip first: there's nothing to export yet."; return; }
    const r = what === "clip" ? { from: 0, to: 0, label: "" } : exportRange(); // a clip covers its own bars
    if (r.error) { exportMsg.textContent = r.error; return; }
    if (what === "midi") {
      const noteTracks = song.tracks.filter((t) => t.kind !== "audio");
      if (!noteTracks.length) { exportMsg.textContent = "This song has only sound-file tracks: there are no notes to export as MIDI."; return; }
      const name = Wav.fileName(song.title + r.label, ".mid");
      deliver(new Blob([MidiFile.encode(song, r)], { type: "audio/midi" }), name, done(name, ` (${noteTracks.length} track${noteTracks.length === 1 ? "" : "s"})`), exportMsg);
      return;
    }
    const opts = { from: r.from, to: r.to, sampleRate: Number($("export-rate").value), tail: $("export-tail").checked };
    go.disabled = true;
    try {
      if (what === "clip") {
        // The clip's track alone, over the clip's bars: clips on a track never
        // overlap, so that's this clip and nothing else, muted or not.
        const ec = exportClip();
        if (!ec) throw new Error("pick a clip on the timeline first");
        const range = { from: ec.clip.start, to: ec.clip.start + ec.clip.length };
        exportMsg.textContent = `Rendering ${ec.c.name}…`;
        const buffer = await Render.renderSong(song, live, { ...opts, ...range, tracks: [ec.t], onProgress: (f) => { exportMsg.textContent = `Rendering ${ec.c.name}… ${Math.round(f * 100)}%`; } });
        const file = soundFile(buffer, $("export-normalize").checked ? Wav.normalizeGain(buffer) : 1);
        const name = Wav.fileName(`${ec.t.name} - ${ec.c.name}`, file.ext);
        const notes = !ec.c.audio && ec.c.notes.length;
        if (!notes) {
          deliver(new Blob([file.bytes], { type: file.type }), name, done(name, ` (${Math.round(buffer.duration)} seconds)`), exportMsg);
        } else {
          // A note clip: its sound and its notes, together in a .zip.
          const solo = { ...song, tracks: [ec.t] };
          const files = [
            { name, data: file.bytes },
            { name: Wav.fileName(`${ec.t.name} - ${ec.c.name}`, ".mid"), data: MidiFile.encode(solo, range) },
          ];
          const zipName = Wav.fileName(`${ec.t.name} - ${ec.c.name}`, ".zip");
          deliver(new Blob([Zip.zip(files)], { type: "application/zip" }), zipName, done(zipName, ` (the sound and its ${ec.c.notes.length} notes as MIDI)`), exportMsg);
        }
      } else if (what === "mix") {
        exportMsg.textContent = "Rendering the mix…";
        const buffer = await Render.renderSong(song, live, { ...opts, onProgress: (f) => { exportMsg.textContent = `Rendering the mix… ${Math.round(f * 100)}%`; } });
        const file = soundFile(buffer, $("export-normalize").checked ? Wav.normalizeGain(buffer) : 1);
        const name = Wav.fileName(song.title + r.label, file.ext);
        deliver(new Blob([file.bytes], { type: file.type }), name, done(name, ` (${Math.round(buffer.duration)} seconds)`), exportMsg);
      } else {
        const tracks = Song.audible(song);
        if (!tracks.length) throw new Error("every track is muted");
        const buffers = [];
        for (const [i, t] of tracks.entries()) {
          const label = `Rendering stem ${i + 1} of ${tracks.length}: ${t.name}`;
          exportMsg.textContent = label + "…";
          buffers.push(await Render.renderSong(song, live, { ...opts, tracks: [t], onProgress: (f) => { exportMsg.textContent = `${label}… ${Math.round(f * 100)}%`; } }));
        }
        // Normalizing stems uses one gain for all of them, so they still mix back to the same balance.
        const gain = $("export-normalize").checked ? Math.min(...buffers.map((b) => Wav.normalizeGain(b))) : 1;
        const files = buffers.map((b, i) => {
          const f = soundFile(b, gain);
          return { name: `${String(i + 1).padStart(2, "0")} ${Wav.fileName(tracks[i].name, f.ext)}`, data: f.bytes };
        });
        files.push({ name: "song info.txt", data: new TextEncoder().encode(SongInfo.text(song)) });
        const name = Wav.fileName(song.title + r.label + " stems", ".zip");
        deliver(new Blob([Zip.zip(files)], { type: "application/zip" }), name, done(name, ` (${tracks.length} stem${tracks.length === 1 ? "" : "s"})`), exportMsg);
      }
    } catch (e) {
      exportMsg.textContent = "Couldn't export: " + (e && e.message ? e.message : e);
    }
    go.disabled = false;
  }

  $("export-wav").addEventListener("click", openExport);
  $("export-close").addEventListener("click", () => exportDlg.close());
  exportDlg.addEventListener("click", (e) => { if (e.target === exportDlg) exportDlg.close(); });
  exportDlg.addEventListener("change", (e) => {
    if (e.target.id === "export-from" || e.target.id === "export-to") setRadio("export-range", "bars");
    syncExport();
  });
  $("export-go").addEventListener("click", runExport);

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
  // Drum beats: starting patterns for a drum track's open clip, added over
  // every bar of the loop (hits already there stay).
  for (const beat of Drums.BEATS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = beat.name;
    b.addEventListener("click", () => {
      const o = find(open);
      if (!o || o.t.kind !== "drums") return;
      let added = 0;
      for (const n of Drums.beatNotes(beat, o.c.bars)) if (Song.addNote(o.c, n.step, n.midi, n.len, n.vel)) added++;
      renderEditor();
      timeline.render();
      afterChange(added ? `Added the ${beat.name} beat (${added} hits)` : `The ${beat.name} beat is already all there`);
    });
    $("beats").append(b);
  }
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

  // The track above (-1) or below (1) the selected one.
  function stepTrack(dir) {
    const i = song.tracks.findIndex((t) => t.id === song.selected);
    const next = song.tracks[Math.max(0, Math.min(song.tracks.length - 1, i + dir))];
    if (next && next.id !== song.selected) selectTrack(next.id, true);
  }

  function selectTrack(id, announce = true) {
    // A recording carries on into the newly picked track; only the notes
    // being held on the old one let go.
    if (song.selected !== id) releaseLive();
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
    // The slide switcher: in the transport bar on a desktop, on its own row under it otherwise.
    const bar = document.querySelector(".transport-bar"), nav = $("slides");
    if (want === "wide" && nav.parentElement !== bar) bar.insertBefore(nav, bar.querySelector(".tempo"));
    else if (want !== "wide" && nav.parentElement === bar) bar.after(nav);
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
    showStorage();
    $("layout-" + ui.layout).checked = true;
    ($("theme-" + ui.theme) || $("theme-poster")).checked = true;
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
  const THEME_NAMES = { poster: "Poster", contrast: "High contrast", midnight: "Midnight", plum: "Plum", forest: "Forest", ember: "Ember" };
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
  // It points at every panel, so it runs on the All slide and then goes back.
  const runTour = () => {
    const back = ui.slide;
    setSlide("all", false);
    Tour.start({ onEnd: () => setSlide(back, false) });
  };
  $("tour-btn").addEventListener("click", () => {
    settings.close();
    runTour();
  });
  // First visit: Home opens at launch and blocks the page while it's up, so
  // the tour waits for Home to close (see first paint, below).
  const autoTour = () => {
    if (Tour.shouldAutoRun() && !Tour.active() && !document.querySelector("dialog[open]")) runTour();
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
    if (on) setSlide("all", false); // every panel has to be there to be moved
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

  // --- slides: one job at a time ---
  const slideNav = Slides.create($("slides"), { onPick: (id) => setSlide(id, true) });
  function setSlide(id, byHand) {
    const s = Slides.find(id), was = ui.slide;
    ui.slide = s.id;
    document.documentElement.dataset.slide = s.id;
    slideNav.show(s.id);
    $("note-edit-h").textContent = s.id === "mix" ? "Mixer" : s.id === "sound" ? "Sound" : "Note Edit";
    if (byHand && arrange.arranging) setArranging(false);
    if (byHand && s.page && s.id !== was) pages.select(s.page, false);
    // Make and Sound work on one clip: open the selected one, or the track's first.
    if (byHand && (s.id === "make" || s.id === "sound") && !find(open)) {
      const p = pickedClip(), t = sel();
      if (p) openClip(p.t, p.clip, false);
      else if (t.clips.length) openClip(t, t.clips[0], false);
    }
    arrange.refresh();
    renderEditor();
    timeline.render();
    roll.rebuild();
    requestAnimationFrame(() => { timeline.render(); drawZooms(); redrawWave(); });
    if (byHand) Announce.say(`${s.name} slide: ${s.about}`);
    save();
  }
  setSlide(ui.slide, false);
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
  // Sound versions left over from earlier edits: nothing can undo back to them now.
  Samples.tidy(soundsInUse(true));
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
  const drawZooms = () => { tlZoom.draw(); rollZoom.draw(); waveZoom.draw(); };
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
