// Slides: the studio one job at a time. Each slide shows only the panels
// that job needs, so they get the whole screen; "All" is everything at
// once, as the studio was before slides. Which panels hide, and how each
// slide is laid out, is CSS on <html data-slide="...">.
//
//   LIST            the slides, in the order you'd work through a song
//   find(id)        a slide by id ("all" if there's no such slide)
//   create(nav, h)  builds the switcher into `nav`; h.onPick(id) is called
//                   when one is chosen. Returns { show(id) }.
(function (root) {
  "use strict";

  // panels: which of the four panels the slide shows. page: the Note Edit
  // page it opens on; pages: the only Note Edit pages it offers (all of
  // them when absent). about: what's read out on arriving, and shown in the
  // workspace header. The switcher numbers the steps 1-5; All (everything at
  // once) lives in Settings > Layout.
  const LIST = [
    { id: "all", name: "All panels", about: "everything on one screen", panels: ["playbox", "clip-editor", "note-edit", "keys-section"] },
    { id: "make", name: "Make", about: "play and record ideas into one clip", panels: ["clip-editor", "note-edit", "keys-section"], page: "tab-p-note", pages: ["tab-p-note", "tab-p-track"] },
    { id: "arrange", name: "Arrange", about: "lay the clips out into a song", panels: ["playbox", "note-edit"], page: "tab-p-track", pages: ["tab-p-track", "tab-p-song"] },
    { id: "edit", name: "Edit", about: "play the whole song and change any note", panels: ["playbox", "note-edit"], page: "tab-p-note", pages: ["tab-p-note"] },
    { id: "sound", name: "Sound", about: "shape one sound", panels: ["clip-editor", "note-edit", "keys-section"], page: "tab-p-sound", pages: ["tab-p-sound", "tab-p-shape", "tab-p-filter", "tab-p-warp"] },
    { id: "mix", name: "Mix", about: "balance the tracks", panels: ["note-edit"], page: "tab-p-mix", pages: ["tab-p-mix"] },
  ];
  // The steps in the switcher (All is reached from Settings).
  const STEPS = LIST.filter((s) => s.id !== "all");
  const find = (id) => LIST.find((s) => s.id === id) || LIST[0];

  // A row of buttons, one pressed. Like tabs: one is in the Tab order and
  // the arrows move between them (Home / End go to the ends).
  function create(nav, h) {
    nav.textContent = "";
    const buttons = STEPS.map((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slide-btn";
      b.dataset.slide = s.id;
      b.innerHTML = `<span class="slide-num" aria-hidden="true">${i + 1}</span>`;
      b.append(s.name);
      b.title = s.about[0].toUpperCase() + s.about.slice(1);
      b.setAttribute("aria-keyshortcuts", `Alt+${i + 1}`);
      b.addEventListener("click", () => h.onPick(s.id));
      nav.append(b);
      return b;
    });
    nav.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(e.target);
      if (i < 0) return;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const b = buttons[(to + buttons.length) % buttons.length];
      b.focus();
      h.onPick(b.dataset.slide);
    });
    function show(id) {
      // On All, none is pressed and the first step takes the Tab stop.
      const any = buttons.some((b) => b.dataset.slide === id);
      for (const [i, b] of buttons.entries()) {
        const on = b.dataset.slide === id;
        b.setAttribute("aria-pressed", String(on));
        b.tabIndex = on || (!any && i === 0) ? 0 : -1;
      }
    }
    return { show };
  }

  const api = { LIST, STEPS, find, create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Slides = api;
})(typeof window !== "undefined" ? window : globalThis);
