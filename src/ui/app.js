// Wires the studio together: the song (tracks, patterns, mixer settings),
// one synth and mixer channel per track, the loop, and the panels. Sound
// starts on the first key or button press (browsers don't allow it sooner).
//
// Space plays and stops the loop from anywhere, except where Space is the
// only way to work a control (checkboxes, radio buttons, drop-downs, text).
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
          announceNotes: ui.announceNotes, kbBase: kb.base, tab: ui.tab, keysOpen: ui.keysOpen,
        }));
      } catch (e) { /* private window or storage blocked */ }
    }, 200);
  }

  const savedSong = load(SONG_KEY);
  const song = savedSong ? Song.sanitize(savedSong) : Song.demoSong();
  const ui = { announceNotes: false, tab: "tab-pattern", keysOpen: true, ...(load(UI_KEY) || {}) };
  const sel = () => Song.track(song, song.selected);
  // What the synth actually plays: the track's settings, pushed around by its morph pad.
  const live = (t) => Morph.apply(t.params, t.morph);

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
        const synth = Synth.create(ctx, channel.input, live(t));
        audio[t.id] = { synth, channel };
        Meter.add(mixerView.meter(t.id), channel.peak, true);
      }
      Meter.add(mixerView.meter("master"), Engine.peak, true);
      applyMix();
      transport = Transport.create(ctx, { getBpm: () => song.bpm, getSteps: () => song.steps, onStep });
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

  // --- the loop ---
  const playheadQueue = []; // { step, time } waiting to be shown

  function onStep(step, time, dur) {
    for (const t of Song.audible(song)) {
      const { synth } = audio[t.id];
      for (const midi of Song.notesAt(t, step)) {
        const v = synth.noteOn(midi, 0.85, time);
        synth.voiceOff(v, time + dur * t.length * 0.92);
      }
    }
    playheadQueue.push({ step, time });
  }

  function drawPlayhead() {
    if (transport && transport.playing) {
      const now = Engine.ctx.currentTime;
      let shown = null;
      while (playheadQueue.length && playheadQueue[0].time <= now) shown = playheadQueue.shift().step;
      if (shown != null) grid.setPlayhead(shown);
    }
    requestAnimationFrame(drawPlayhead);
  }
  requestAnimationFrame(drawPlayhead);

  function stopLoop() {
    if (!transport || !transport.playing) return;
    transport.stop();
    playheadQueue.length = 0;
    grid.setPlayhead(-1);
    $("play").setAttribute("aria-pressed", "false");
    Announce.say("Stopped");
  }

  async function togglePlay() {
    if (transport && transport.playing) { stopLoop(); return; }
    await ready();
    transport.start();
    $("play").setAttribute("aria-pressed", "true");
    Announce.say("Playing");
  }
  $("play").addEventListener("click", togglePlay);

  const tempo = $("tempo");
  tempo.min = Song.BPM.min; tempo.max = Song.BPM.max;
  tempo.value = song.bpm;
  tempo.addEventListener("change", () => {
    const v = Math.round(Number(tempo.value));
    song.bpm = Number.isFinite(v) ? Math.min(Song.BPM.max, Math.max(Song.BPM.min, v)) : song.bpm;
    tempo.value = song.bpm;
    save();
  });

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
    if (transport && Engine.running()) audio[trackId].synth.noteOn(m);
    else ready().then(() => { if (holds.get(m)) audio[trackId].synth.noteOn(m); });
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
  const narrow = matchMedia("(max-width: 640px)");

  function setKeyboard(base, announce) {
    const span = narrow.matches ? 12 : 24;
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
  narrow.addEventListener("change", () => setKeyboard(kb.base, false));
  $("oct-down").addEventListener("click", () => setKeyboard(kb.base - 12, true));
  $("oct-up").addEventListener("click", () => setKeyboard(kb.base + 12, true));
  $("panic").addEventListener("click", () => { panic(); Announce.say("All notes stopped"); });

  const announceBox = $("announce-notes");
  announceBox.checked = !!ui.announceNotes;
  announceBox.addEventListener("change", () => { ui.announceNotes = announceBox.checked; save(); });

  // --- computer keys: A W S E D ... play, Z / X change octave, Space plays
  // the loop, Esc stops every note ---
  const compHeld = new Map(); // key code -> midi, so an octave change mid-note lets go of the right one

  function typingInto(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    return t.tagName === "INPUT" && !["range", "button"].includes(t.type);
  }
  // Controls that need Space to work (checkbox, radio) keep it.
  const spaceIsTheirs = (t) => typingInto(t) || (t.tagName === "INPUT" && ["checkbox", "radio"].includes(t.type));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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

  // --- mixer ---
  const mixerView = MixerView.create($("mixer-strips"), song, {
    select: selectTrack,
    volume(id, db) { Song.track(song, id).volume = db; applyMix(); save(); },
    pan(id, v) { Song.track(song, id).pan = v; applyMix(); save(); },
    mute(id, on) { Song.track(song, id).mute = on; applyMix(); save(); },
    solo(id, on) { Song.track(song, id).solo = on; applyMix(); save(); },
    master(db) { song.master = db; applyMix(); save(); },
  });

  // --- pattern grid ---
  const grid = StepGrid.create($("grid"), {
    onToggle(step, midi) {
      const t = sel();
      const on = Song.toggleNote(t, step, midi);
      if (on) preview(t, midi);
      showOffGrid();
      save();
      return on;
    },
  });

  const lengthSel = $("note-length");
  for (const n of Song.LENGTHS) lengthSel.add(new Option(n === 1 ? "1 step" : n + " steps", n));
  lengthSel.addEventListener("change", () => { sel().length = Number(lengthSel.value); save(); });

  function setGridBase(base, announce) {
    const t = sel();
    t.gridBase = Math.max(Song.LOWEST, Math.min(Song.HIGHEST - 12, base));
    renderPattern();
    if (announce) Announce.say(`Rows ${Notes.noteName(t.gridBase)} to ${Notes.noteName(t.gridBase + 12)}`);
    save();
  }
  $("rows-down").addEventListener("click", () => setGridBase(sel().gridBase - 12, true));
  $("rows-up").addEventListener("click", () => setGridBase(sel().gridBase + 12, true));

  // Notes that are in the pattern but above or below the rows on screen.
  function showOffGrid() {
    const t = sel();
    const above = t.notes.filter((n) => n.midi > t.gridBase + 12).length;
    const below = t.notes.filter((n) => n.midi < t.gridBase).length;
    const parts = [];
    if (above) parts.push(`${above} note${above > 1 ? "s" : ""} higher up`);
    if (below) parts.push(`${below} lower down`);
    $("off-grid").textContent = parts.join(", ");
  }

  let undoClear = null;
  const clearBtn = $("clear");
  clearBtn.addEventListener("click", () => {
    const t = sel();
    if (undoClear) {
      t.notes = undoClear.notes;
      undoClear = null;
      clearBtn.textContent = "Clear";
      Announce.say("Pattern restored");
    } else {
      if (!t.notes.length) return;
      undoClear = { id: t.id, notes: t.notes };
      t.notes = [];
      clearBtn.textContent = "Undo clear";
      Announce.say(`${t.name} pattern cleared. Press Undo clear to bring it back.`);
    }
    renderPattern();
    save();
  });
  function resetUndo() {
    undoClear = null;
    clearBtn.textContent = "Clear";
  }

  function renderPattern() {
    const t = sel();
    grid.render(t, song.steps);
    $("pattern-h").textContent = "Pattern: " + t.name;
    $("rows-label").textContent = `${Notes.noteName(t.gridBase)} to ${Notes.noteName(t.gridBase + 12)}`;
    $("rows-down").disabled = t.gridBase <= Song.LOWEST;
    $("rows-up").disabled = t.gridBase + 12 >= Song.HIGHEST;
    lengthSel.value = t.length;
    showOffGrid();
  }

  // --- synth panel (for the selected track) ---
  const controls = Controls.build($("synth-controls"), {
    get: () => sel().params,
    onChange(id, value) {
      const t = sel();
      t.params = Params.sanitize({ ...t.params, [id]: value });
      if (audio[t.id]) audio[t.id].synth.set(id, live(t)[id]);
      save();
    },
  });

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

  // --- morph pad (for the selected track) ---
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

  // --- track picker (handy on phones, where the mixer is behind a tab) ---
  const trackPick = $("track-pick");
  for (const t of song.tracks) trackPick.add(new Option(t.name, t.id));
  trackPick.addEventListener("change", () => selectTrack(trackPick.value));

  function selectTrack(id, announce = true) {
    if (song.selected !== id) {
      panic();
      resetUndo();
    }
    song.selected = id;
    const t = sel();
    $("synth-h").textContent = "Synth: " + t.name;
    presetSel.value = t.preset;
    trackPick.value = t.id;
    morphPad.set(t.morph);
    controls.refresh(t.params);
    mixerView.refresh();
    renderPattern();
    if (announce) Announce.say("Editing " + t.name);
    save();
  }
  selectTrack(song.selected, false);

  // --- tabs: Pattern and Sound, plus Mixer on phones (on bigger screens
  // the mixer is always on show beside them) ---
  const tabs = Tabs.create(document.querySelector(".tabs"), {
    onSelect(id) { ui.tab = id; save(); },
  });
  function layoutMixer() {
    const mixer = $("mixer"), tab = $("tab-mixer");
    tab.hidden = !narrow.matches;
    if (narrow.matches) {
      mixer.setAttribute("role", "tabpanel");
      mixer.setAttribute("aria-labelledby", "tab-mixer");
      mixer.tabIndex = 0;
    } else {
      mixer.removeAttribute("role");
      mixer.setAttribute("aria-labelledby", "mixer-h");
      mixer.removeAttribute("tabindex");
      mixer.hidden = false;
    }
    tabs.refresh();
  }
  tabs.select(ui.tab, false);
  layoutMixer();
  narrow.addEventListener("change", layoutMixer);

  // --- show / hide the keyboard (the computer keys keep working) ---
  const keysToggle = $("keys-toggle");
  function showKeys(open) {
    ui.keysOpen = open;
    keysToggle.setAttribute("aria-expanded", String(open));
    $("keys-body").hidden = !open;
    if (!open) kb.releaseAll();
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
})();
