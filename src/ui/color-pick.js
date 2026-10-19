// Color picks for tracks, clips and notes. The eight named track colors are
// quick picks; "Custom…" opens a palette: 24 more swatches, any color (the
// system color picker), a hex box and the last few custom colors used.
// Text on every color is picked to stay readable (Colors.inkOn), so any
// color is allowed.
//
//   NAMED, PALETTE      [id or hex, name] pairs
//   nameOf(color)       "Orange", "Teal", "custom color #3fa7b0"
//   open(btn, o)        shows the palette under `btn`. o: { current, onPick(color|null),
//                       quick (show the named colors too), none (label for "no color of
//                       its own", e.g. "Same as track"), title }
//   recent() / remember(hex)   the recent custom colors (kept by the app)
(function (root) {
  "use strict";

  const NAMED = [["orange", "Orange"], ["mint", "Mint"], ["sky", "Sky"], ["violet", "Violet"],
    ["rose", "Rose"], ["lime", "Lime"], ["gold", "Gold"], ["coral", "Coral"]];
  const PALETTE = [
    ["#e5484d", "Red"], ["#f76b15", "Tomato"], ["#ffb224", "Amber"], ["#ffe629", "Yellow"],
    ["#30a46c", "Green"], ["#12a594", "Teal"], ["#00a2c7", "Cyan"], ["#0090ff", "Blue"],
    ["#3e63dd", "Indigo"], ["#6f88ff", "Periwinkle"], ["#8e4ec6", "Purple"], ["#995bff", "Poster violet"],
    ["#d6409f", "Pink"], ["#a18072", "Brown"], ["#6b7280", "Slate"], ["#2b2f3a", "Charcoal"],
    ["#ffc2c2", "Blush"], ["#ffd3b0", "Peach"], ["#fff2e5", "Cream"], ["#c9f2c7", "Pistachio"],
    ["#b8efe3", "Seafoam"], ["#c6ecff", "Ice"], ["#e2d1ff", "Lavender"], ["#ffc8e8", "Candy"],
  ];
  const NAMES = new Map([...NAMED, ...PALETTE]);
  const nameOf = (color) => (color ? NAMES.get(color) || `custom color ${color}` : "");

  let recentList = [];
  const recent = () => recentList.slice();
  const setRecent = (list) => { recentList = (Array.isArray(list) ? list : []).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 6); };
  // A custom color (not one of the named ones) goes to the front of the recent row.
  function remember(color) {
    if (!/^#[0-9a-f]{6}$/.test(color || "") || NAMES.has(color)) return;
    recentList = [color, ...recentList.filter((c) => c !== color)].slice(0, 6);
  }

  let menu = null, opts = null, opener = null;
  function swatch(color, label, pressed) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cp-swatch";
    b.style.setProperty("--sw", color ? Colors.cssOf(color) : "transparent");
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(pressed));
    b.title = label;
    b.addEventListener("click", () => pick(color));
    return b;
  }
  function pick(color) {
    if (color && Colors.isHex(color)) remember(color);
    const o = opts;
    menu.hidePopover();
    if (o) o.onPick(color);
  }

  function build() {
    menu = document.createElement("div");
    menu.className = "menu color-menu";
    menu.setAttribute("popover", "");
    menu.setAttribute("role", "dialog");
    menu.addEventListener("toggle", (e) => {
      if (e.newState !== "open" && opener && opener.isConnected) opener.focus();
    });
    document.body.append(menu);
    // Older browsers (iOS before 17) have no popovers: show it as a fixed box,
    // closed by Esc, a pick, or a tap outside.
    if (typeof menu.showPopover !== "function") {
      const close = () => {
        if (!menu.classList.contains("open")) return;
        menu.classList.remove("open");
        if (opener && opener.isConnected) opener.focus();
      };
      menu.showPopover = () => menu.classList.add("open");
      menu.hidePopover = close;
      menu.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      document.addEventListener("pointerdown", (e) => { if (!menu.contains(e.target) && e.target !== opener) close(); });
    }
  }

  function open(btn, o) {
    if (!menu) build();
    opts = o;
    opener = btn;
    const cur = o.current || null;
    menu.textContent = "";
    menu.setAttribute("aria-label", o.title || "Color");
    const head = document.createElement("h3");
    head.className = "cp-head";
    head.textContent = o.title || "Color";
    menu.append(head);
    const group = (title, items) => {
      const h = document.createElement("p");
      h.className = "menu-note";
      h.textContent = title;
      const row = document.createElement("div");
      row.className = "cp-grid";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", title);
      row.append(...items);
      menu.append(h, row);
    };
    if (o.none) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cp-none";
      b.textContent = o.none;
      b.setAttribute("aria-pressed", String(!cur));
      b.addEventListener("click", () => pick(null));
      menu.append(b);
    }
    if (o.quick) group("Quick colors", NAMED.map(([id, name]) => swatch(id, name, cur === id)));
    group("Palette", PALETTE.map(([hex, name]) => swatch(hex, name, cur === hex)));
    const rec = recentList.filter((c) => !NAMES.has(c));
    if (rec.length) group("Recent", rec.map((hex) => swatch(hex, `Custom ${hex}`, cur === hex)));

    // Any color: the system picker, and a hex box for typing one.
    const any = document.createElement("div");
    any.className = "cp-any";
    const startHex = Colors.isHex(cur) ? cur : "#6f88ff";
    const wheelLabel = document.createElement("label");
    wheelLabel.className = "inline";
    wheelLabel.textContent = "Any color ";
    const wheel = Object.assign(document.createElement("input"), { type: "color", value: startHex });
    wheel.addEventListener("change", () => pick(wheel.value.toLowerCase()));
    wheelLabel.append(wheel);
    const hexLabel = document.createElement("label");
    hexLabel.className = "inline";
    hexLabel.textContent = "Hex ";
    const hex = Object.assign(document.createElement("input"), { type: "text", value: startHex, maxLength: 7, spellcheck: false, autocomplete: "off" });
    hex.className = "cp-hex";
    hex.setAttribute("aria-describedby", "cp-hex-help");
    const use = Object.assign(document.createElement("button"), { type: "button", textContent: "Use" });
    const help = Object.assign(document.createElement("span"), { id: "cp-hex-help", className: "sr-only", textContent: "Six hex digits, like #3fa7b0" });
    const tryHex = () => {
      let v = hex.value.trim().toLowerCase();
      if (/^[0-9a-f]{6}$/.test(v)) v = "#" + v;
      if (/^#[0-9a-f]{6}$/.test(v)) pick(v);
      else { hex.setAttribute("aria-invalid", "true"); Announce.say("That isn't a color: use six hex digits, like #3fa7b0"); }
    };
    hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tryHex(); } });
    hex.addEventListener("input", () => hex.removeAttribute("aria-invalid"));
    use.addEventListener("click", tryHex);
    hexLabel.append(hex);
    any.append(wheelLabel, hexLabel, use, help);
    menu.append(any);

    menu.showPopover();
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
    const top = r.bottom + 4 + menu.offsetHeight > innerHeight - 8 ? r.top - menu.offsetHeight - 4 : r.bottom + 4;
    menu.style.top = Math.max(8, Math.min(top, innerHeight - menu.offsetHeight - 8)) + "px"; // always on screen
    (menu.querySelector('[aria-pressed="true"]') || menu.querySelector("button")).focus();
  }

  root.ColorPick = { NAMED, PALETTE, nameOf, open, recent, setRecent, remember };
})(window);
