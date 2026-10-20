// Sample Studio (workspace 6): a library of sound files to sample from, a
// big waveform of the one picked, and cutting it into slices (DESIGN.md,
// "Sample Studio", steps 1 and 2): cuts by hand (M, a double-click, dragging
// a cut) or for you (src/audio/slicer.js: hits, quiet gaps, bars, equal
// parts), snapped to zero crossings; each slice plays, and can be named,
// reversed, faded or made louder without touching the file. Cuts are saved
// with the sound's library entry: { id, name, cuts: [s], meta: { [startMs]:
// { name, reverse, fade, gain } } }, and have their own undo.
//
// The library is a list of sound ids with names, kept in localStorage
// (`sound-studio.samplelib`); the sounds themselves are in Samples
// (IndexedDB). Sounds in the library are kept by the storage tidy-up even
// when no song uses them.
//
//   create(panel, h)   h: { ready() (audio on), ctx() (the AudioContext),
//                      out() (where to play), songSounds() [{ id, name }],
//                      say(text), tell(text, opts), changed() }
//   LIB_KEY, libraryIds()
(function (root) {
  "use strict";

  const LIB_KEY = "sound-studio.samplelib";
  const readLib = () => {
    try {
      const v = JSON.parse(localStorage.getItem(LIB_KEY));
      return Array.isArray(v) ? v.filter((e) => e && /^snd-[a-z0-9]{1,24}$/.test(e.id)).slice(0, 500) : [];
    } catch (e) { return []; }
  };
  const libraryIds = () => readLib().map((e) => e.id);
  const clock = (s) => {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(3).padStart(6, "0")}`;
  };
  const seconds = (s) => (s < 10 ? `${s.toFixed(2)} seconds` : `${Math.round(s)} seconds`);

  function create(panel, h) {
    const $ = (id) => panel.querySelector("#" + id);
    let lib = readLib();
    let pickedId = null;
    let view = { from: 0, to: 1 }; // seconds in view
    let cursor = 0;                 // seconds: where Play starts
    let playing = null;             // { src, started, from }
    let dragCut = null;             // { index, id } while a cut is dragged
    const undoStack = [], redoStack = [];
    // The picked sound's library entry (cutting a song's sound adds it to the library).
    const entry = (create) => {
      let e = lib.find((x) => x.id === pickedId);
      if (!e && create && pickedId) { e = { id: pickedId, name: nameOf(pickedId) }; lib.push(e); }
      return e || null;
    };
    const cutsNow = () => { const e = entry(false); return e && Array.isArray(e.cuts) ? e.cuts : []; };
    const durNow = () => { const inf = pickedId && Samples.info(pickedId); return inf ? inf.duration : 0; };
    const slicesNow = () => (pickedId && Samples.info(pickedId) ? Slicer.slicesOf(cutsNow(), durNow()) : []);
    const metaOf = (sl) => { const e = entry(false); return (e && e.meta && e.meta[Math.round(sl.from * 1000)]) || {}; };
    const snap = (t) => {
      const buf = Samples.buffer(pickedId);
      return $("ss-snap").checked && buf ? Slicer.nearestZero(Samples.channels(buf), buf.sampleRate, t) : t;
    };
    // Every change to the cuts (or a slice's settings) goes through here, so Undo can take it back.
    function change(fn, words) {
      const e = entry(true);
      if (!e) return;
      undoStack.push({ id: e.id, cuts: [...(e.cuts || [])], meta: JSON.parse(JSON.stringify(e.meta || {})) });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      fn(e);
      e.cuts = Slicer.tidy(e.cuts || [], durNow());
      saveLib();
      renderList();
      renderSlices();
      draw();
      if (words) h.say(words);
    }
    function swap(from, to) {
      const snap0 = from.pop();
      if (!snap0) return false;
      let e = lib.find((x) => x.id === snap0.id);
      if (!e) return false;
      to.push({ id: e.id, cuts: [...(e.cuts || [])], meta: JSON.parse(JSON.stringify(e.meta || {})) });
      e.cuts = snap0.cuts;
      e.meta = snap0.meta;
      saveLib();
      if (pickedId !== e.id) pick(e.id); else { renderSlices(); draw(); }
      return true;
    }
    const saveLib = () => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (e) { /* storage blocked */ } };
    const nameOf = (id) => (lib.find((e) => e.id === id) || {}).name || (Samples.info(id) || {}).name || "Sound";

    // --- the list: the library, then this song's sounds that aren't in it ---
    function renderList() {
      const list = $("ss-list");
      const q = $("ss-search").value.trim().toLowerCase();
      list.textContent = "";
      const inSong = h.songSounds().filter((s) => !lib.some((e) => e.id === s.id));
      const rows = [
        ...lib.map((e) => ({ id: e.id, name: e.name, where: "library" })),
        ...inSong.map((s) => ({ id: s.id, name: s.name, where: "song" })),
      ].filter((r) => !q || r.name.toLowerCase().includes(q));
      let lastGroup = null;
      for (const r of rows) {
        if (r.where !== lastGroup) {
          lastGroup = r.where;
          const head = document.createElement("li");
          head.className = "ss-group";
          head.setAttribute("aria-hidden", "true");
          head.textContent = r.where === "library" ? "Library" : "In this song";
          list.append(head);
        }
        const li = document.createElement("li");
        li.className = "ss-row";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ss-item";
        b.dataset.id = r.id;
        b.setAttribute("aria-pressed", String(r.id === pickedId));
        const inf = Samples.info(r.id);
        const len = inf ? (inf.duration < 60 ? `${inf.duration.toFixed(2)} s` : clock(inf.duration).replace(/\.\d+$/, "")) : Samples.isMissing(r.id) ? "missing" : "…";
        b.innerHTML = '<span class="ss-item-name"></span><span class="ss-item-len"></span>';
        b.querySelector(".ss-item-name").textContent = r.name;
        b.querySelector(".ss-item-len").textContent = len;
        b.setAttribute("aria-label", `${r.name}, ${inf ? seconds(inf.duration) : "loading"}, ${r.where === "library" ? "in the library" : "used in this song"}`);
        b.addEventListener("click", () => pick(r.id, true));
        const more = ItemMenu.moreButton(r.name);
        more.addEventListener("click", () => ItemMenu.open(more, menuFor(r)));
        li.append(b, more);
        list.append(li);
      }
      $("ss-empty").hidden = rows.length > 0;
      $("ss-empty").textContent = q ? `No sound called "${$("ss-search").value.trim()}".` : "No sounds yet. Add MP3 or WAV files, or drop them here.";
    }
    function menuFor(r) {
      const inLib = lib.some((e) => e.id === r.id);
      return {
        label: r.name,
        items: [
          { label: "Play", run: () => { pick(r.id); play(0); } },
          { label: "Rename…", keepFocus: true, run: () => rename(r.id) },
          inLib
            ? { label: "Remove from the library", danger: true, run: () => removeFromLib(r.id) }
            : { label: "Keep in the library", run: () => { lib.push({ id: r.id, name: r.name }); saveLib(); renderList(); h.say(`${r.name} is in the library`); } },
        ],
      };
    }
    function rename(id) {
      const row = $("ss-list").querySelector(`[data-id="${id}"]`);
      if (!row) return;
      const input = Object.assign(document.createElement("input"), { type: "text", value: nameOf(id), maxLength: 40, className: "ss-rename" });
      input.setAttribute("aria-label", "New name");
      row.replaceWith(input);
      input.focus();
      input.select();
      const done = (keep) => {
        const name = input.value.trim().slice(0, 40);
        if (keep && name) {
          let e = lib.find((x) => x.id === id);
          if (!e) { e = { id, name }; lib.push(e); }
          e.name = name;
          saveLib();
          h.say(`Renamed to ${name}`);
        }
        renderList();
        if (id === pickedId) renderHead();
        $("ss-list").querySelector(`[data-id="${id}"]`)?.focus();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        if (e.key === "Escape") { e.preventDefault(); done(false); }
        e.stopPropagation(); // typing a name doesn't play notes
      });
      input.addEventListener("blur", () => done(true), { once: true });
    }
    function removeFromLib(id) {
      const i = lib.findIndex((e) => e.id === id);
      if (i < 0) return;
      const [e] = lib.splice(i, 1);
      saveLib();
      if (pickedId === id) { pickedId = null; renderHead(); draw(); }
      renderList();
      h.tell(`Removed ${e.name} from the library`, { action: { label: "Undo", run: () => { lib.splice(i, 0, e); saveLib(); renderList(); h.say(`${e.name} is back`); } } });
    }

    // --- adding files (the button, or dropped anywhere on the panel) ---
    async function addFiles(files) {
      const list = [...files].filter((f) => f && f.size);
      if (!list.length) return;
      let added = 0, last = null;
      const failed = [];
      for (const [i, f] of list.entries()) {
        $("ss-status").textContent = `Adding ${i + 1} of ${list.length}: ${f.name}…`;
        try {
          const id = await Samples.add(f);
          lib.push({ id, name: (Samples.info(id) || {}).name || f.name });
          added++;
          last = id;
        } catch (e) { failed.push(f.name); }
      }
      saveLib();
      renderList();
      if (last) { pick(last); if (phone()) setView2("cut"); } // on a phone, straight to cutting it
      const msg = (added ? `Added ${added} sound${added === 1 ? "" : "s"}` : "Nothing added") +
        (failed.length ? `. Couldn't read ${failed.join(", ")}: is it a sound file (MP3, WAV, OGG, M4A, FLAC)?` : "");
      $("ss-status").textContent = msg;
      h.say(msg);
      h.changed();
    }
    $("ss-add").addEventListener("click", () => $("ss-file").click());
    $("ss-file").addEventListener("change", () => { addFiles($("ss-file").files); $("ss-file").value = ""; });
    panel.addEventListener("dragover", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      panel.classList.add("ss-dropping");
    });
    panel.addEventListener("dragleave", (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove("ss-dropping"); });
    panel.addEventListener("drop", (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      panel.classList.remove("ss-dropping");
      addFiles(e.dataTransfer.files);
    });
    $("ss-search").addEventListener("input", renderList);
    // Phones: Sounds (the library) or Cut (the wave and slices).
    function setView2(v, say) {
      panel.dataset.ssview = v;
      $("ss-v-sounds").setAttribute("aria-pressed", String(v !== "cut"));
      $("ss-v-cut").setAttribute("aria-pressed", String(v === "cut"));
      if (v === "cut") requestAnimationFrame(() => { draw(); zoom.draw(); });
      if (say) h.say(v === "cut" ? "Showing the wave and slices" : "Showing the sounds");
    }
    $("ss-v-sounds").addEventListener("click", () => setView2("sounds", true));
    $("ss-v-cut").addEventListener("click", () => setView2("cut", true));
    const phone = () => document.documentElement.dataset.layout === "compact";
    $("ss-search").addEventListener("keydown", (e) => e.stopPropagation());
    // Space on the library's buttons or the slices plays the picked sound, not the song.
    panel.addEventListener("keydown", (e) => {
      if (e.key !== " " || e.target.closest("input, select, textarea, #ss-wave") || !pickedId) return;
      if (e.target.closest("button") && !e.target.closest(".ss-list, .ss-slices")) return; // Space presses other buttons
      e.preventDefault();
      e.stopPropagation();
      playing ? stop() : play(cursor);
    });

    // --- the picked sound: its name, the waveform, play ---
    async function pick(id, focusWave) {
      stop();
      pickedId = id;
      renderList();
      await Samples.load([id]);
      const inf = Samples.info(id);
      view = { from: 0, to: inf ? inf.duration : 1 };
      cursor = 0;
      renderHead();
      renderSlices();
      draw();
      zoom.draw();
      if (h.picked) h.picked();
      if (focusWave && phone()) setView2("cut");
      if (focusWave) h.say(inf ? `${nameOf(id)}, ${seconds(inf.duration)}. The wave has focus: Space plays, arrows move the cursor, M cuts.` : `${nameOf(id)} isn't in this browser`);
      if (focusWave && inf) requestAnimationFrame(() => $("ss-wave").focus());
    }
    function renderHead() {
      const inf = pickedId && Samples.info(pickedId);
      $("ss-name").textContent = pickedId ? nameOf(pickedId) : "No sound picked";
      $("ss-meta").textContent = inf ? `${seconds(inf.duration)} · ${inf.channels === 1 ? "mono" : "stereo"} · ${(inf.rate / 1000).toFixed(1)} kHz` : "";
      for (const id of ["ss-play", "ss-zoom-in", "ss-zoom-out", "ss-fit", "ss-cut", "ss-auto-btn", "ss-send"]) $(id).disabled = !inf;
      $("ss-clear").disabled = !inf || !cutsNow().length;
      $("ss-wave").setAttribute("aria-label", inf ? `${nameOf(pickedId)} waveform. Cursor at ${clock(cursor)} of ${clock(inf.duration)}${sliceWords()}. Space plays from the cursor; arrows move it; M cuts; 1 to 9 play a slice.` : "Waveform: pick a sound first");
      showTime(cursor);
    }
    // "in slice 3 of 8" for the cursor, when there are cuts.
    function sliceWords() {
      const sl = slicesNow();
      if (sl.length < 2) return "";
      const i = sl.findIndex((s) => cursor >= s.from && cursor < s.to);
      return i < 0 ? "" : `, in slice ${i + 1} of ${sl.length}`;
    }
    function showTime(t) {
      const inf = pickedId && Samples.info(pickedId);
      $("ss-time").textContent = inf ? `${clock(t)} / ${clock(inf.duration)}` : "";
    }

    const cv = $("ss-canvas");
    function draw(playAt) {
      const box = $("ss-wave");
      const W = Math.max(1, box.clientWidth), H = Math.max(1, box.clientHeight);
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const css = getComputedStyle(box);
      const color = css.getPropertyValue("--ss-wave").trim() || "#c39bff";
      const ink = css.getPropertyValue("--text").trim() || "#fff";
      g.strokeStyle = css.getPropertyValue("--line").trim() || "#555";
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      const inf = pickedId && Samples.info(pickedId);
      if (!inf) return;
      const n = Math.min(2000, Math.round(W));
      const out = Samples.outline(pickedId, false, view.from, view.to, n);
      if (out) {
        g.fillStyle = color;
        const step = W / n;
        for (let i = 0; i < n; i++) {
          const lo = out[i * 2], hi = out[i * 2 + 1];
          const y0 = H / 2 - hi * (H / 2 - 4), y1 = H / 2 - lo * (H / 2 - 4);
          g.fillRect(i * step, y0, Math.max(1, step), Math.max(1, y1 - y0));
        }
      }
      const xOf = (t) => ((t - view.from) / (view.to - view.from)) * W;
      // Slices: every other one shaded, numbered; the one under the cursor brighter.
      const sl = slicesNow();
      g.font = "700 12px system-ui, sans-serif";
      sl.forEach((s, i) => {
        const x0 = xOf(s.from), x1 = xOf(s.to);
        if (x1 < 0 || x0 > W) return;
        const here = cursor >= s.from && cursor < s.to;
        if (here || i % 2) { g.fillStyle = here ? "rgba(255,159,210,0.16)" : "rgba(255,255,255,0.04)"; g.fillRect(x0, 0, x1 - x0, H); }
        if (sl.length > 1 && x1 - x0 > 18) { g.fillStyle = color; g.fillText(String(i + 1), Math.max(2, x0 + 4), 14); }
      });
      for (const c of cutsNow()) {
        const x = Math.round(xOf(c));
        if (x < -2 || x > W + 2) continue;
        g.fillStyle = color;
        g.fillRect(x - 1, 0, 2, H);
        const hs = phone() ? 18 : 10; // a handle to drag (bigger for fingers)
        g.fillRect(x - hs / 2, H - hs, hs, hs);
      }
      g.fillStyle = ink;
      g.fillRect(Math.round(xOf(cursor)) - 1, 0, 2, H);
      if (playAt != null) {
        g.fillStyle = css.getPropertyValue("--rec").trim() || "#ff7a7a";
        g.fillRect(Math.round(xOf(playAt)) - 1, 0, 2, H);
      }
    }
    // Click or tap: the cursor goes there (and plays from there while playing).
    const timeAt = (clientX) => {
      const r = $("ss-wave").getBoundingClientRect();
      return Math.max(0, Math.min(durNow(), view.from + ((clientX - r.left) / r.width) * (view.to - view.from)));
    };
    $("ss-wave").addEventListener("pointerdown", (e) => {
      const inf = pickedId && Samples.info(pickedId);
      if (!inf || e.button > 0) return;
      const r = $("ss-wave").getBoundingClientRect();
      // On a cut (within 8 px): drag it.
      const px = (t) => r.left + ((t - view.from) / (view.to - view.from)) * r.width;
      const reach = e.pointerType === "touch" ? 20 : 8; // fingers are wider than a pointer
      const near = cutsNow().map((c, i) => ({ i, d: Math.abs(px(c) - e.clientX) })).filter((x) => x.d <= reach).sort((a, b) => a.d - b.d)[0];
      if (near) {
        $("ss-wave").setPointerCapture(e.pointerId);
        const e0 = entry(true);
        undoStack.push({ id: e0.id, cuts: [...e0.cuts], meta: JSON.parse(JSON.stringify(e0.meta || {})) });
        redoStack.length = 0;
        dragCut = { index: near.i, pointer: e.pointerId };
        return;
      }
      cursor = timeAt(e.clientX);
      const was = !!playing;
      renderHead();
      renderSlices();
      draw();
      if (was) play(cursor);
    });
    $("ss-wave").addEventListener("pointermove", (e) => {
      if (!dragCut || e.pointerId !== dragCut.pointer) return;
      const en = entry(false);
      en.cuts[dragCut.index] = timeAt(e.clientX);
      draw();
    });
    const endDrag = (e) => {
      if (!dragCut || e.pointerId !== dragCut.pointer) return;
      const en = entry(false);
      en.cuts[dragCut.index] = snap(timeAt(e.clientX));
      en.cuts = Slicer.tidy(en.cuts, durNow());
      dragCut = null;
      saveLib();
      renderSlices();
      draw();
      h.say(`Cut moved to ${clock(en.cuts.find((c) => Math.abs(c - timeAt(e.clientX)) < 0.02) ?? timeAt(e.clientX))}`);
    };
    $("ss-wave").addEventListener("pointerup", endDrag);
    $("ss-wave").addEventListener("pointercancel", endDrag);
    $("ss-wave").addEventListener("dblclick", (e) => { if (pickedId) addCut(timeAt(e.clientX)); });
    function addCut(t) {
      const at = snap(t);
      if (at <= 0.01 || at >= durNow() - 0.01) { h.say("A cut has to be inside the sound"); return; }
      change((en) => { en.cuts = [...(en.cuts || []), at]; }, `Cut at ${clock(at)}. ${slicesNow().length + 1} slices`);
    }
    function removeNearestCut() {
      const cuts = cutsNow();
      if (!cuts.length) { h.say("No cuts to remove"); return; }
      const i = cuts.map((c, k) => [Math.abs(c - cursor), k]).sort((a, b) => a[0] - b[0])[0][1];
      const at = cuts[i];
      change((en) => { en.cuts = en.cuts.filter((_, k) => k !== i); }, `Removed the cut at ${clock(at)}`);
    }
    $("ss-cut").addEventListener("click", () => addCut(cursor));
    $("ss-clear").addEventListener("click", () => change((en) => { en.cuts = []; en.meta = {}; }, "Cleared the cuts. Undo brings them back"));
    // Cut for me: replaces the cuts.
    $("ss-auto-menu").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-auto]");
      const buf = pickedId && Samples.buffer(pickedId);
      if (!b || !buf) return;
      $("ss-auto-menu").hidePopover();
      const chans = Samples.channels(buf), rate = buf.sampleRate, dur = buf.duration;
      const bar = h.barSeconds ? h.barSeconds() : 2;
      const kind = b.dataset.auto;
      let cuts, what;
      if (kind === "beats") { cuts = Slicer.beats(chans, rate, { sensitivity: Number($("ss-sens").value) }); what = "at each hit"; }
      else if (kind === "silences") { cuts = Slicer.silences(chans, rate); what = "at each quiet gap"; }
      else if (kind === "bars") { cuts = Slicer.bars(dur, bar, 1); what = "every bar"; }
      else if (kind === "beat") { cuts = Slicer.bars(dur, bar / 4, 1); what = "every beat"; }
      else { const n = Number(kind.slice(2)); cuts = Slicer.equal(dur, n); what = `into ${n} equal parts`; }
      if (kind === "beats" || kind === "silences") cuts = cuts.map(snap);
      change((en) => { en.cuts = cuts; en.meta = {}; },
        cuts.length ? `Cut ${what}: ${cuts.length + 1} slices` : `Found nothing to cut ${what}${kind === "beats" ? ": try Many" : ""}`);
      $("ss-wave").focus();
    });

    // --- the slices: play one, and its own settings ---
    function renderSlices() {
      const list = $("ss-slices");
      const sl = slicesNow();
      list.textContent = "";
      $("ss-slices-count").textContent = sl.length > 1 ? `(${sl.length})` : "";
      $("ss-clear").disabled = !pickedId || !cutsNow().length;
      if (sl.length < 2) {
        const p = document.createElement("li");
        p.className = "help";
        p.textContent = pickedId ? "No cuts yet: the whole sound is one slice." : "Pick a sound to cut it up.";
        list.append(p);
        return;
      }
      sl.forEach((s, i) => {
        const m = metaOf(s);
        const li = document.createElement("li");
        li.className = "ss-slice";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ss-slice-play";
        if (cursor >= s.from && cursor < s.to) b.setAttribute("aria-current", "true");
        const tags = [m.reverse && "reversed", m.fade && "faded", m.gain && `${m.gain > 0 ? "+" : ""}${m.gain} dB`].filter(Boolean);
        b.innerHTML = '<span class="ss-n" aria-hidden="true"></span><span class="ss-sl-name"></span><span class="ss-tags"></span>';
        b.querySelector(".ss-n").textContent = String(i + 1);
        b.querySelector(".ss-sl-name").textContent = `${m.name || `Slice ${i + 1}`} · ${(s.to - s.from).toFixed(2)} s`;
        b.querySelector(".ss-tags").textContent = tags.join(", ");
        b.setAttribute("aria-label", `Play slice ${i + 1}${m.name ? `, ${m.name}` : ""}, ${seconds(s.to - s.from)}${tags.length ? ", " + tags.join(", ") : ""}`);
        b.addEventListener("click", () => playSlice(i));
        const more = ItemMenu.moreButton(`Slice ${i + 1}`);
        more.addEventListener("click", () => ItemMenu.open(more, sliceMenu(s, i)));
        li.append(b, more);
        list.append(li);
      });
    }
    function setMeta(s, patch, words) {
      change((en) => {
        en.meta = en.meta || {};
        const k = Math.round(s.from * 1000);
        const m = { ...(en.meta[k] || {}), ...patch };
        for (const key of Object.keys(m)) if (m[key] === false || m[key] === 0 || m[key] === "") delete m[key];
        if (Object.keys(m).length) en.meta[k] = m; else delete en.meta[k];
      }, words);
    }
    function sliceMenu(s, i) {
      const m = metaOf(s);
      const g = m.gain || 0;
      return {
        label: m.name || `Slice ${i + 1}`,
        items: [
          { label: "Play", run: () => playSlice(i) },
          { label: "Rename…", keepFocus: true, run: () => renameSlice(s, i) },
          "-",
          { label: m.reverse ? "Play forwards" : "Reverse", run: () => setMeta(s, { reverse: !m.reverse }, `Slice ${i + 1} ${m.reverse ? "plays forwards" : "reversed"}`) },
          { label: m.fade ? "No fades" : "Fade the ends", run: () => setMeta(s, { fade: !m.fade }, `Slice ${i + 1} ${m.fade ? "without fades" : "fades in and out"}`) },
          { label: "Louder (+3 dB)", disabled: g >= 12, run: () => setMeta(s, { gain: Math.min(12, g + 3) }, `Slice ${i + 1} at ${g + 3} dB`) },
          { label: "Quieter (−3 dB)", disabled: g <= -24, run: () => setMeta(s, { gain: Math.max(-24, g - 3) }, `Slice ${i + 1} at ${g - 3} dB`) },
          "-",
          { label: "Add to sound pads", run: () => send("pads", i) },
          { label: h.trackName && h.trackName() ? `Use as ${h.trackName()}'s instrument` : "Use as an instrument (pick a synth track first)", disabled: !(h.trackName && h.trackName()), run: () => send("instrument", i) },
          "-",
          { label: "Join with the next slice", disabled: i >= slicesNow().length - 1, run: () => change((en) => { en.cuts = en.cuts.filter((c) => Math.abs(c - s.to) > 0.0005); }, `Joined slices ${i + 1} and ${i + 2}`) },
        ],
      };
    }
    function renameSlice(s, i) {
      const btn = $("ss-slices").children[i]?.querySelector(".ss-slice-play");
      if (!btn) return;
      const input = Object.assign(document.createElement("input"), { type: "text", value: metaOf(s).name || "", maxLength: 30, className: "ss-rename", placeholder: `Slice ${i + 1}` });
      input.setAttribute("aria-label", `Name for slice ${i + 1}`);
      btn.replaceWith(input);
      input.focus();
      let done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        if (keep) setMeta(s, { name: input.value.trim().slice(0, 30) }, input.value.trim() ? `Slice ${i + 1} is ${input.value.trim()}` : `Slice ${i + 1} has no name`);
        else renderSlices();
        $("ss-slices").children[i]?.querySelector(".ss-slice-play")?.focus();
      };
      input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); finish(false); } });
      input.addEventListener("blur", () => finish(true));
    }
    function playSlice(i) {
      const s = slicesNow()[i];
      if (!s) return;
      const m = metaOf(s);
      cursor = s.from;
      renderHead();
      renderSlices();
      play(s.from, s.to, m);
      h.say(`Slice ${i + 1}${m.name ? `, ${m.name}` : ""}`);
    }
    $("ss-wave").addEventListener("keydown", (e) => {
      const inf = pickedId && Samples.info(pickedId);
      if (!inf) return;
      const span = view.to - view.from;
      let to = null;
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) {
        // Move the cut nearest the cursor (Shift: further).
        e.preventDefault();
        e.stopPropagation();
        const cuts = cutsNow();
        if (!cuts.length) { h.say("No cuts to move: press M to cut"); return; }
        const i = cuts.map((c, k) => [Math.abs(c - cursor), k]).sort((a, b) => a[0] - b[0])[0][1];
        const by = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : Math.max(0.002, span / 200));
        const at = Math.max(0.011, Math.min(durNow() - 0.011, cuts[i] + by));
        change((en) => { en.cuts[i] = at; }, `Cut at ${clock(at)}`);
        cursor = at;
        renderHead();
        draw();
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const cuts = cutsNow();
        const next = e.key === "]" ? cuts.find((c) => c > cursor + 0.0005) : [...cuts].reverse().find((c) => c < cursor - 0.0005);
        to = next != null ? next : e.key === "]" ? inf.duration : 0;
      } else if (e.key === " ") { e.preventDefault(); e.stopPropagation(); playing ? stop() : play(cursor); return; }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") to = cursor + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : Math.max(0.01, span / 50));
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = inf.duration;
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); playing ? stop() : play(cursor); return; }
      else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); addCut(cursor); return; }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); removeNearestCut(); return; }
      else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); playSlice(Number(e.key) - 1); return; }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); e.stopPropagation(); zoomBy(1.5); return; }
      else if (e.key === "-") { e.preventDefault(); e.stopPropagation(); zoomBy(1 / 1.5); return; }
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      const before = sliceWords();
      cursor = Math.max(0, Math.min(inf.duration, to));
      if (cursor < view.from || cursor > view.to) { const half = span / 2; setView(cursor - half, cursor + half); }
      renderHead();
      renderSlices();
      draw();
      const now = sliceWords();
      h.say(clock(cursor) + (now !== before && now ? now.replace(/^, in/, ", now in") : ""));
    });

    // Plays from `from` (to `to`, for a slice), with a slice's own settings.
    function play(from, to, m = {}) {
      const buf = pickedId && Samples.buffer(pickedId, !!m.reverse);
      if (!buf) return;
      stop();
      h.ready().then(() => {
        const ctx = h.ctx();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const amp = ctx.createGain();
        src.connect(amp);
        amp.connect(h.out());
        const end = to == null ? buf.duration : to;
        const at = Math.max(0, Math.min(buf.duration - 0.001, from || 0));
        const len = Math.max(0.005, end - at);
        const t0 = ctx.currentTime + 0.02;
        const level = Math.pow(10, (m.gain || 0) / 20);
        amp.gain.setValueAtTime(m.fade ? 0 : level, t0);
        if (m.fade) {
          const f = Math.min(0.03, len / 4);
          amp.gain.linearRampToValueAtTime(level, t0 + f);
          amp.gain.setValueAtTime(level, t0 + len - f);
          amp.gain.linearRampToValueAtTime(0, t0 + len);
        }
        // Reversed: the slice's place in the backwards copy.
        src.start(t0, m.reverse ? buf.duration - end : at, len);
        playing = { src, started: t0, from: at, reverse: !!m.reverse, end };
        src.onended = () => { if (playing && playing.src === src) { playing = null; $("ss-play").textContent = "Play"; $("ss-play").setAttribute("aria-pressed", "false"); draw(); } };
        $("ss-play").textContent = "Stop";
        $("ss-play").setAttribute("aria-pressed", "true");
        const tick = () => {
          if (!playing || playing.src !== src) return;
          const t = playing.reverse ? Math.max(playing.from, playing.end - (ctx.currentTime - playing.started)) : playing.from + (ctx.currentTime - playing.started);
          if (t > view.to) setView(t, t + (view.to - view.from));
          draw(t);
          showTime(t);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    function stop() {
      if (!playing) return;
      try { playing.src.stop(); } catch (e) { /* already stopped */ }
      playing = null;
      $("ss-play").textContent = "Play";
      $("ss-play").setAttribute("aria-pressed", "false");
      draw();
      showTime(cursor);
    }
    $("ss-play").addEventListener("click", () => (playing ? stop() : play(cursor)));
    $("ss-snap").addEventListener("change", () => h.say($("ss-snap").checked ? "Cuts snap to the nearest silence point (a zero crossing), so slices don't click" : "Cuts go exactly where you put them"));

    // --- zoom: buttons, Ctrl + wheel, and the zoom bar ---
    function setView(from, to) {
      const inf = pickedId && Samples.info(pickedId);
      if (!inf) return;
      const span = Math.max(0.02, Math.min(inf.duration, to - from));
      from = Math.max(0, Math.min(inf.duration - span, from));
      view = { from, to: from + span };
      draw();
      zoom.draw();
    }
    const zoomBy = (f) => { const mid = (view.from + view.to) / 2, half = (view.to - view.from) / 2 / f; setView(mid - half, mid + half); };
    $("ss-zoom-in").addEventListener("click", () => zoomBy(1.5));
    $("ss-zoom-out").addEventListener("click", () => zoomBy(1 / 1.5));
    $("ss-fit").addEventListener("click", () => { const inf = Samples.info(pickedId); if (inf) setView(0, inf.duration); });
    $("ss-wave").addEventListener("wheel", (e) => { if (!e.ctrlKey || !pickedId) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
    // (The zoom bar works in whole units: milliseconds here, as in the wave editor.)
    const zoom = ZoomBar.create($("ss-zoombar"), {
      label: "Sample", unit: (n) => (n / 1000).toFixed(2), total: (n) => (n / 1000).toFixed(2) + " seconds",
      get: () => { const inf = pickedId && Samples.info(pickedId); return { start: view.from * 1000, end: view.to * 1000, total: Math.round((inf ? inf.duration : 1) * 1000) }; },
      set: (a, b) => setView(a / 1000, b / 1000),
      fit: () => { const inf = Samples.info(pickedId); if (inf) setView(0, inf.duration); },
    });
    new ResizeObserver(() => draw()).observe($("ss-wave"));

    // Shown: refresh the list (the song may have changed) and the picture.
    function show() {
      lib = readLib();
      const ids = [...lib.map((e) => e.id), ...h.songSounds().map((s) => s.id)];
      renderList();
      renderHead();
      Samples.load(ids).then(() => { renderList(); renderHead(); draw(); zoom.draw(); });
    }
    renderHead();
    // For the workspace header's Editing strip.
    const describe = () => {
      const inf = pickedId && Samples.info(pickedId);
      return pickedId ? `${nameOf(pickedId)}${inf ? ` · ${inf.duration.toFixed(2)} s` : ""}` : "No sound picked";
    };
    // --- sending slices: each becomes its own sound, its settings baked in ---
    function sliceSound(s, i) {
      const buf = Samples.buffer(pickedId);
      const m = metaOf(s);
      const rate = buf.sampleRate;
      const a = Math.max(0, Math.floor(s.from * rate)), b = Math.min(buf.length, Math.ceil(s.to * rate));
      const level = Math.pow(10, (m.gain || 0) / 20);
      const ramp = Math.max(1, Math.round((m.fade ? Math.min(0.03, (s.to - s.from) / 4) : 0.002) * rate));
      const chans = Samples.channels(buf).map((d) => {
        const part = d.slice(a, b);
        if (m.reverse) part.reverse();
        for (let k = 0; k < part.length; k++) {
          const edge = Math.min(1, k / ramp, (part.length - 1 - k) / ramp);
          part[k] *= level * edge;
        }
        return part;
      });
      const name = (m.name || `${nameOf(pickedId)} ${i + 1}`).slice(0, 40);
      return { name, sampleId: Samples.addChannels(chans, rate, name), from: s.from, to: s.to };
    }
    function send(kind, only) {
      if (!pickedId || !Samples.buffer(pickedId)) return;
      const all = slicesNow();
      const list = only != null ? [[all[only], only]] : all.map((s, i) => [s, i]);
      h.send(kind, list.map(([s, i]) => sliceSound(s, i)), nameOf(pickedId));
    }
    $("ss-send").addEventListener("click", () => {
      const n = slicesNow().length;
      const cur = Math.max(0, slicesNow().findIndex((s) => cursor >= s.from && cursor < s.to));
      const track = h.trackName ? h.trackName() : null;
      ItemMenu.open($("ss-send"), {
        label: n > 1 ? `Send the ${n} slices` : "Send the sound (no cuts yet)",
        items: [
          { label: `To sound pads (a new section)`, run: () => send("pads") },
          { label: `To the keys (a new kit track)`, run: () => send("kit") },
          { label: `To the timeline (a clip per bar)`, run: () => send("timeline") },
          "-",
          { label: track ? `Slice ${cur + 1} as ${track}'s instrument` : "Slice as an instrument (pick a synth track first)", disabled: !track, run: () => send("instrument", cur) },
        ],
      });
    });

    // Undo / redo for cuts (the app sends Ctrl+Z here on this workspace).
    const undo = () => { const ok = swap(undoStack, redoStack); if (ok) h.say("Undone"); return ok; };
    const redo = () => { const ok = swap(redoStack, undoStack); if (ok) h.say("Redone"); return ok; };
    return { show, stop, addFiles, describe, undo, redo, slices: () => slicesNow().map((s) => ({ ...s, ...metaOf(s) })), get picked() { return pickedId; } };
  }

  root.SampleStudio = { create, LIB_KEY, libraryIds };
})(window);
