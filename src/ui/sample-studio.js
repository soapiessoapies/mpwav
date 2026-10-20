// Sample Studio (workspace 6): a library of sound files to sample from, and
// a big waveform of the one picked. Step 1 of 4 (DESIGN.md, "Sample
// Studio"): the library (upload, drag and drop, rename, find, remove) and
// the waveform (zoom, a cursor, play from it). Slicing and sending slices
// to pads, keys and the timeline come next.
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
      if (last) pick(last);
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
    $("ss-search").addEventListener("keydown", (e) => e.stopPropagation());

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
      draw();
      zoom.draw();
      if (h.picked) h.picked();
      if (focusWave) h.say(inf ? `${nameOf(id)}, ${seconds(inf.duration)}. The wave has focus: Enter plays, arrows move the cursor.` : `${nameOf(id)} isn't in this browser`);
      if (focusWave && inf) $("ss-wave").focus();
    }
    function renderHead() {
      const inf = pickedId && Samples.info(pickedId);
      $("ss-name").textContent = pickedId ? nameOf(pickedId) : "No sound picked";
      $("ss-meta").textContent = inf ? `${seconds(inf.duration)} · ${inf.channels === 1 ? "mono" : "stereo"} · ${(inf.rate / 1000).toFixed(1)} kHz` : "";
      for (const id of ["ss-play", "ss-zoom-in", "ss-zoom-out", "ss-fit"]) $(id).disabled = !inf;
      $("ss-wave").setAttribute("aria-label", inf ? `${nameOf(pickedId)} waveform. Cursor at ${clock(cursor)} of ${clock(inf.duration)}. Enter plays from the cursor; arrows move it, Shift for a second; plus and minus zoom.` : "Waveform: pick a sound first");
      showTime(cursor);
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
      g.fillStyle = ink;
      g.fillRect(Math.round(xOf(cursor)) - 1, 0, 2, H);
      if (playAt != null) {
        g.fillStyle = css.getPropertyValue("--rec").trim() || "#ff7a7a";
        g.fillRect(Math.round(xOf(playAt)) - 1, 0, 2, H);
      }
    }
    // Click or tap: the cursor goes there (and plays from there while playing).
    $("ss-wave").addEventListener("pointerdown", (e) => {
      const inf = pickedId && Samples.info(pickedId);
      if (!inf) return;
      const r = $("ss-wave").getBoundingClientRect();
      cursor = Math.max(0, Math.min(inf.duration, view.from + ((e.clientX - r.left) / r.width) * (view.to - view.from)));
      const was = !!playing;
      renderHead();
      draw();
      if (was) play(cursor);
    });
    $("ss-wave").addEventListener("keydown", (e) => {
      const inf = pickedId && Samples.info(pickedId);
      if (!inf) return;
      const span = view.to - view.from;
      let to = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") to = cursor + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : Math.max(0.01, span / 50));
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = inf.duration;
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); playing ? stop() : play(cursor); return; }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); e.stopPropagation(); zoomBy(1.5); return; }
      else if (e.key === "-") { e.preventDefault(); e.stopPropagation(); zoomBy(1 / 1.5); return; }
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      cursor = Math.max(0, Math.min(inf.duration, to));
      if (cursor < view.from || cursor > view.to) { const half = span / 2; setView(cursor - half, cursor + half); }
      renderHead();
      draw();
      h.say(clock(cursor));
    });

    function play(from) {
      const buf = pickedId && Samples.buffer(pickedId);
      if (!buf) return;
      stop();
      h.ready().then(() => {
        const ctx = h.ctx();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(h.out());
        const at = Math.max(0, Math.min(buf.duration - 0.001, from || 0));
        src.start(ctx.currentTime + 0.02, at);
        playing = { src, started: ctx.currentTime + 0.02, from: at };
        src.onended = () => { if (playing && playing.src === src) { playing = null; $("ss-play").textContent = "Play"; $("ss-play").setAttribute("aria-pressed", "false"); draw(); } };
        $("ss-play").textContent = "Stop";
        $("ss-play").setAttribute("aria-pressed", "true");
        const tick = () => {
          if (!playing || playing.src !== src) return;
          const t = playing.from + (ctx.currentTime - playing.started);
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
    return { show, stop, addFiles, describe, get picked() { return pickedId; } };
  }

  root.SampleStudio = { create, LIB_KEY, libraryIds };
})(window);
