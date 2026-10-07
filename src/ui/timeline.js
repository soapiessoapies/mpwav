// The playing box: the song as a timeline. A ruler of bars across the top,
// a row per track, and clips as colored blocks along the rows, with tiny
// blocks inside showing their notes (shaded by key).
//
//   pointer: drag a clip to move it, drag its right edge to stretch it (its
//            loop repeats); double-click / double-tap a clip to open it, or
//            an empty spot to make a new clip there. Click the ruler to put
//            the cursor there; drag along the ruler to set the loop.
//   keyboard: every clip is a button. Left/Right go to the next clip on the
//            row, Up/Down to the row above or below; Alt + Left/Right moves
//            the clip a bar, Shift + Left/Right stretches it; Enter opens
//            it; Delete removes it. A screen reader hears "Lead riff, Lead,
//            bars 1 to 8, 1-bar loop".
// The view never edits the song itself beyond moving and stretching clips;
// everything else goes through the handlers.
(function (root) {
  "use strict";

  const HEAD = 96; // width of the track names column
  const ZOOMS = [24, 32, 44, 60, 80, 110, 150];
  const DOUBLE_TAP_MS = 350;

  function create(scroller, h) {
    // h: { song(), selectedClip(), onSelectTrack(id), onSelectClip(t, clip), onOpenClip(t, clip),
    //      onNewClip(t, bar), onCursor(bar), onLoop(start, end), onChanged(text) }
    let zoom = 3;
    let lastTap = { id: null, at: 0 };
    let shades = {}; // track color -> 12 shades by key

    const barW = () => ZOOMS.at(zoom);
    const el = (tag, cls, attrs = {}) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };

    // Shades of a track's color by key: C deepest, B lightest.
    function shadesFor(color) {
      if (shades[color]) return shades[color];
      const hex = getComputedStyle(document.documentElement).getPropertyValue("--c-" + color).trim() || "#ffb547";
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      shades[color] = Array.from({ length: 12 }, (_, pc) => {
        const k = 0.72 - (pc / 11) * 0.5; // how much darker than the clip
        return `rgb(${rgb.map((c) => Math.round(c * (1 - k))).join(",")})`;
      });
      return shades[color];
    }

    const span = (c) => (c.length === 1 ? `bar ${c.start + 1}` : `bars ${c.start + 1} to ${c.start + c.length}`);
    function clipLabel(song, t, clip) {
      const c = Song.content(song, clip);
      const links = Song.linkCount(song, c.id);
      return `${c.name}, ${t.name}, ${span(clip)}, ${c.bars}-bar loop` +
        (links > 1 ? `, linked with ${links - 1} other clip${links > 2 ? "s" : ""}` : "");
    }

    // The tiny note blocks inside a clip, its loop drawn once per repeat.
    function notesSvg(song, t, clip) {
      const c = Song.content(song, clip);
      const total = clip.length * Song.STEPS, loop = c.bars * Song.STEPS;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "clip-notes");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("viewBox", `0 0 ${total} 24`);
      svg.setAttribute("preserveAspectRatio", "none");
      if (!c.notes.length) return svg;
      const lo = Math.min(...c.notes.map((n) => n.midi)), hi = Math.max(...c.notes.map((n) => n.midi));
      const rows = Math.max(hi - lo + 1, 6), rowH = 24 / rows;
      const colors = shadesFor(t.color);
      for (let off = 0; off < total; off += loop) {
        for (const n of c.notes) {
          const x = off + n.step;
          if (x >= total) continue;
          const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          r.setAttribute("x", x);
          r.setAttribute("y", (hi - n.midi) * rowH + (rows - (hi - lo + 1)) * rowH / 2);
          r.setAttribute("width", Math.max(0.8, Math.min(t.length, total - x) - 0.2));
          r.setAttribute("height", Math.max(rowH - 0.4, 1.2));
          r.setAttribute("fill", colors.at(Notes.pitchClass(n.midi)));
          svg.append(r);
        }
      }
      return svg;
    }

    function render() {
      const song = h.song();
      const bars = Song.viewBars(song);
      const sel = h.selectedClip();
      const hadFocus = scroller.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      scroller.textContent = "";
      const tl = el("div", "tl");
      tl.style.setProperty("--bar-w", barW() + "px");
      tl.style.setProperty("--head-w", HEAD + "px");
      tl.style.width = HEAD + bars * barW() + "px";

      // --- ruler ---
      const rulerRow = el("div", "tl-ruler-row");
      const corner = el("div", "tl-corner");
      corner.textContent = "Bar";
      const ruler = el("div", "tl-ruler", { role: "group", "aria-label": "Ruler: choose where Play starts" });
      if (song.loop.on) {
        const brace = el("div", "tl-loop", { "aria-hidden": "true" });
        brace.style.left = song.loop.start * barW() + "px";
        brace.style.width = (song.loop.end - song.loop.start) * barW() + "px";
        ruler.append(brace);
      }
      for (let b = 0; b < bars; b++) {
        const btn = el("button", "tl-bar" + (b % 4 === 0 ? " four" : ""), {
          type: "button", "aria-label": `Bar ${b + 1}` + (b === song.cursor ? ", cursor" : ""),
          "data-bar": b, "data-focus-key": "bar" + b,
        });
        btn.textContent = b + 1;
        if (b === song.cursor) btn.setAttribute("aria-current", "true");
        ruler.append(btn);
      }
      rulerRow.append(corner, ruler);
      tl.append(rulerRow);

      // --- tracks ---
      for (const t of song.tracks) {
        const row = el("div", "tl-row" + (t.id === song.selected ? " selected" : ""), { "data-track": t.id });
        const head = el("div", "tl-head");
        const name = el("button", "tl-name", {
          type: "button", "aria-pressed": String(t.id === song.selected), "data-focus-key": "head-" + t.id,
          "aria-label": `${t.name} track` + (t.mute ? ", muted" : "") + (t.solo ? ", soloed" : ""),
        });
        name.style.setProperty("--track", `var(--c-${t.color})`);
        name.innerHTML = '<span class="tl-swatch" aria-hidden="true"></span>';
        name.append(t.name);
        name.addEventListener("click", () => h.onSelectTrack(t.id));
        head.append(name);

        const lane = el("div", "tl-lane", { role: "group", "aria-label": `${t.name} clips` });
        lane.dataset.track = t.id;
        for (const clip of t.clips) {
          const c = Song.content(song, clip);
          const b = el("button", "clip" + (sel && sel.id === clip.id ? " selected" : ""), {
            type: "button", "aria-label": clipLabel(song, t, clip),
            "data-clip": clip.id, "data-focus-key": "clip-" + clip.id,
          });
          if (sel && sel.id === clip.id) b.setAttribute("aria-current", "true");
          b.style.setProperty("--track", `var(--c-${t.color})`);
          b.style.left = clip.start * barW() + "px";
          b.style.width = clip.length * barW() + "px";
          const label = el("span", "clip-name", { "aria-hidden": "true" });
          label.textContent = c.name;
          b.append(label, notesSvg(song, t, clip));
          if (Song.linkCount(song, c.id) > 1) b.append(el("span", "clip-link", { "aria-hidden": "true", title: "Linked" }));
          // Loop repeats marked with a notch where each repeat starts.
          for (let r = c.bars; r < clip.length; r += c.bars) {
            const notch = el("span", "clip-repeat", { "aria-hidden": "true" });
            notch.style.left = r * barW() + "px";
            b.append(notch);
          }
          b.append(el("span", "clip-grip", { "aria-hidden": "true" }));
          lane.append(b);
        }
        row.append(head, lane);
        tl.append(row);
      }

      // --- cursor and playhead ---
      const cursor = el("div", "tl-cursor", { "aria-hidden": "true" });
      cursor.style.left = HEAD + song.cursor * barW() + "px";
      const playhead = el("div", "tl-playhead", { "aria-hidden": "true", hidden: "" });
      tl.append(cursor, playhead);
      scroller.append(tl);

      if (hadFocus) scroller.querySelector(`[data-focus-key="${hadFocus}"]`)?.focus();
    }

    // --- finding things from events ---
    const songNow = () => h.song();
    function clipFrom(target) {
      const b = target.closest(".clip");
      if (!b) return null;
      const t = Song.track(songNow(), b.closest(".tl-lane").dataset.track);
      return { t, clip: t.clips.find((c) => c.id === b.dataset.clip), button: b };
    }
    const barFromX = (laneOrRuler, x) =>
      Math.max(0, Math.floor((x - laneOrRuler.getBoundingClientRect().left) / barW()));

    // --- pointer: clips ---
    let drag = null;
    scroller.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      const hit = clipFrom(e.target);
      if (hit) {
        e.preventDefault();
        hit.button.setPointerCapture(e.pointerId);
        drag = {
          ...hit, id: e.pointerId, x0: e.clientX,
          mode: e.target.closest(".clip-grip") ? "resize" : "move",
          start0: hit.clip.start, length0: hit.clip.length, changed: false,
        };
        h.onSelectClip(hit.t, hit.clip, false);
        return;
      }
      const lane = e.target.closest(".tl-lane");
      if (lane) {
        const t = Song.track(songNow(), lane.dataset.track);
        const bar = barFromX(lane, e.clientX);
        const now = performance.now();
        if (lastTap.id === "lane-" + t.id + bar && now - lastTap.at < DOUBLE_TAP_MS) {
          lastTap = { id: null, at: 0 };
          h.onNewClip(t, bar);
        } else {
          lastTap = { id: "lane-" + t.id + bar, at: now };
          h.onSelectTrack(t.id, false);
          h.onCursor(bar);
        }
        return;
      }
      const ruler = e.target.closest(".tl-ruler");
      if (ruler) {
        e.preventDefault();
        ruler.setPointerCapture(e.pointerId);
        drag = { mode: "ruler", ruler, id: e.pointerId, from: barFromX(ruler, e.clientX), to: null };
      }
    });

    scroller.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === "ruler") {
        const bar = barFromX(drag.ruler, e.clientX);
        if (bar !== drag.from || drag.to !== null) {
          drag.to = bar;
          const brace = drag.ruler.querySelector(".tl-loop") || drag.ruler.appendChild(el("div", "tl-loop", { "aria-hidden": "true" }));
          const a = Math.min(drag.from, bar), b = Math.max(drag.from, bar) + 1;
          brace.style.left = a * barW() + "px";
          brace.style.width = (b - a) * barW() + "px";
        }
        return;
      }
      const dx = Math.round((e.clientX - drag.x0) / barW());
      if (drag.mode === "move") {
        const at = Song.moveClip(drag.t, drag.clip, drag.start0 + dx);
        drag.button.style.left = at * barW() + "px";
        drag.changed = at !== drag.start0;
      } else {
        const len = Song.resizeClip(drag.t, drag.clip, drag.length0 + dx);
        drag.button.style.width = len * barW() + "px";
        drag.changed = len !== drag.length0;
      }
    });

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.mode === "ruler") {
        if (d.to === null) h.onCursor(d.from);
        else h.onLoop(Math.min(d.from, d.to), Math.max(d.from, d.to) + 1);
        return;
      }
      if (d.changed) {
        h.onChanged(d.mode === "move"
          ? `Moved to ${span(d.clip)}`
          : `Stretched to ${d.clip.length} bar${d.clip.length > 1 ? "s" : ""}`);
        return;
      }
      // A tap: a second one on the same clip soon after opens it.
      const now = performance.now();
      if (lastTap.id === d.clip.id && now - lastTap.at < DOUBLE_TAP_MS) {
        lastTap = { id: null, at: 0 };
        h.onOpenClip(d.t, d.clip);
      } else {
        lastTap = { id: d.clip.id, at: now };
      }
    }
    scroller.addEventListener("pointerup", endDrag);
    scroller.addEventListener("pointercancel", endDrag);

    // Ruler buttons by keyboard (and screen readers) move the cursor.
    scroller.addEventListener("click", (e) => {
      const bar = e.target.closest(".tl-bar");
      if (bar && e.detail === 0) h.onCursor(Number(bar.dataset.bar));
      const hit = clipFrom(e.target);
      if (hit && e.detail === 0) h.onSelectClip(hit.t, hit.clip, true);
    });

    // --- keyboard on clips ---
    scroller.addEventListener("keydown", (e) => {
      const hit = clipFrom(e.target);
      if (!hit) return;
      const { t, clip } = hit;
      const song = songNow();
      const dir = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (e.key === "Enter") {
        e.preventDefault();
        h.onOpenClip(t, clip);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        h.onDeleteClip(t, clip);
      } else if (dir && (e.altKey || e.ctrlKey)) {
        e.preventDefault();
        const before = clip.start;
        Song.moveClip(t, clip, clip.start + dir);
        h.onChanged(clip.start !== before ? `Moved to ${span(clip)}` : "Can't move further");
      } else if (dir && e.shiftKey) {
        e.preventDefault();
        const before = clip.length;
        Song.resizeClip(t, clip, clip.length + dir);
        h.onChanged(clip.length !== before ? `${clip.length} bar${clip.length > 1 ? "s" : ""} long` : "Can't stretch further");
      } else if (dir) {
        e.preventDefault();
        const i = t.clips.indexOf(clip) + dir;
        if (t.clips[i]) focusClip(t.clips[i]);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ti = song.tracks.indexOf(t) + (e.key === "ArrowUp" ? -1 : 1);
        const other = song.tracks[ti];
        if (!other) return;
        // The clip nearest in time on that row, or its name if it has none.
        const near = other.clips.slice().sort((a, b) => Math.abs(a.start - clip.start) - Math.abs(b.start - clip.start))[0];
        if (near) focusClip(near);
        else scroller.querySelector(`[data-focus-key="head-${other.id}"]`)?.focus();
      }
    });

    function focusClip(clip) {
      scroller.querySelector(`[data-clip="${clip.id}"]`)?.focus();
    }

    // --- zoom ---
    function setZoom(z) {
      const old = barW();
      zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
      if (barW() !== old) {
        const mid = (scroller.scrollLeft + scroller.clientWidth / 2 - HEAD) / old;
        render();
        scroller.scrollLeft = HEAD + mid * barW() - scroller.clientWidth / 2;
      }
      return { canIn: zoom < ZOOMS.length - 1, canOut: zoom > 0 };
    }
    scroller.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      h.onZoom(setZoom(zoom + (e.deltaY < 0 ? 1 : -1)));
    }, { passive: false });

    // --- playhead (pos = steps from the song's start, or -1) ---
    function setPlayhead(pos) {
      const ph = scroller.querySelector(".tl-playhead");
      if (!ph) return;
      if (pos < 0) { ph.hidden = true; return; }
      const x = HEAD + (pos / Song.STEPS) * barW();
      ph.hidden = false;
      ph.style.transform = `translateX(${x}px)`;
      // Keep it in view while playing.
      if (x < scroller.scrollLeft + HEAD || x > scroller.scrollLeft + scroller.clientWidth - 24) {
        scroller.scrollLeft = x - HEAD - 24;
      }
    }

    return {
      render, setPlayhead, focusClip,
      zoomIn: () => setZoom(zoom + 1),
      zoomOut: () => setZoom(zoom - 1),
    };
  }

  root.Timeline = { create };
})(window);
