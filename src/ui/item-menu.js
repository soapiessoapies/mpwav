// The ⋯ menus: simple edits (copy, paste, delete, snip, color…) for one
// thing on screen, a clip, notes, a track. Opened by its ⋯ button, a
// right-click, a long press on a phone, or the Menu key / Shift+F10 on the
// focused thing. A real menu: arrows move, Enter picks, Esc closes, and
// focus goes back where it was.
//
//   open(anchor, { label, items, at })   items: [{ label, run, disabled, danger, keys }]
//                                        or "-" for a divider; `at` = { x, y } to open
//                                        at a point (right-click) instead of under `anchor`
//   attach(el, menuFor)                  right-click, long press and the Menu key on `el`
//                                        open menuFor(target, event) (null = no menu)
//   moreButton(label)                    a ⋯ button, labelled "<label>: more"
(function (root) {
  "use strict";

  let menu = null, back = null, backKey = null;

  function build() {
    menu = document.createElement("div");
    menu.className = "menu item-menu";
    menu.setAttribute("popover", "");
    menu.setAttribute("role", "menu");
    if (typeof menu.showPopover !== "function") {
      menu.showPopover = () => menu.classList.add("open");
      menu.hidePopover = () => { if (menu.classList.contains("open")) { menu.classList.remove("open"); returnFocus(); } };
      document.addEventListener("pointerdown", (e) => { if (!menu.contains(e.target)) menu.hidePopover(); });
    } else {
      menu.addEventListener("toggle", (e) => { if (e.newState !== "open") returnFocus(); });
    }
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (e.key === "Escape") { e.preventDefault(); menu.hidePopover(); return; }
      if (e.key === "Tab") { menu.hidePopover(); return; }
      if (to == null || !items.length) return;
      e.preventDefault();
      items[(to + items.length) % items.length].focus();
    });
    document.body.append(menu);
  }
  function returnFocus() {
    // The thing may have been redrawn meanwhile: find it again by its focus key.
    const b = back && !back.isConnected && backKey ? document.querySelector(`[data-focus-key="${backKey}"]`) : back;
    back = null;
    backKey = null;
    if (b && b.isConnected && !document.activeElement?.closest("dialog[open]")) b.focus({ preventScroll: true });
  }

  function open(anchor, { label, items, at } = {}) {
    if (!menu) build();
    if (menu.matches(":popover-open, .open")) menu.hidePopover();
    back = anchor && anchor.isConnected ? anchor : document.activeElement;
    backKey = back && back.dataset ? back.dataset.focusKey || null : null;
    menu.textContent = "";
    menu.setAttribute("aria-label", label || "Edits");
    if (label) {
      const h = document.createElement("p");
      h.className = "item-menu-head";
      h.setAttribute("aria-hidden", "true");
      h.textContent = label;
      menu.append(h);
    }
    for (const it of items) {
      if (it === "-") {
        const hr = document.createElement("hr");
        hr.setAttribute("role", "separator");
        menu.append(hr);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.className = "item-menu-item" + (it.danger ? " danger" : "");
      b.disabled = !!it.disabled;
      const name = document.createElement("span");
      name.textContent = it.label;
      b.append(name);
      if (it.keys) {
        const k = document.createElement("kbd");
        k.setAttribute("aria-hidden", "true");
        k.textContent = it.keys;
        b.append(k);
      }
      b.addEventListener("click", () => {
        back = it.keepFocus ? null : back; // an action that moves focus itself keeps it
        menu.hidePopover();
        it.run();
      });
      menu.append(b);
    }
    menu.showPopover();
    let x, y;
    if (at) { x = at.x; y = at.y; } else {
      const r = anchor.getBoundingClientRect();
      x = r.right - menu.offsetWidth;
      y = r.bottom + 4;
      if (y + menu.offsetHeight > innerHeight - 8) y = r.top - menu.offsetHeight - 4;
    }
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + "px";
    menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }

  // Right-click, long press (touch) and the Menu key / Shift+F10.
  function attach(el, menuFor) {
    const show = (target, e, at) => {
      // Where it is now (menuFor may redraw it).
      const anchor = target.closest("button, [tabindex]") || target;
      const r = anchor.getBoundingClientRect();
      const key = anchor.dataset && anchor.dataset.focusKey;
      const m = menuFor(target, e);
      if (!m) return false;
      const now = anchor.isConnected ? anchor : (key && document.querySelector(`[data-focus-key="${key}"]`)) || anchor;
      open(now, { ...m, at: at || { x: r.left, y: r.bottom + 4 } });
      return true;
    };
    el.addEventListener("contextmenu", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (show(e.target, e, { x: e.clientX, y: e.clientY })) e.preventDefault();
    });
    el.addEventListener("keydown", (e) => {
      if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
      if (show(e.target, e)) e.preventDefault();
    });
    // Long press: a touch held still for half a second (browsers that send
    // contextmenu for it get there first, and this is skipped).
    let timer = 0, start = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      start = { x: e.clientX, y: e.clientY, target: e.target };
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (start && show(start.target, e, { x: start.x, y: start.y })) el.dataset.longPressed = "1";
        start = null;
      }, 550);
    });
    const cancel = (e) => {
      if (start && e.type === "pointermove" && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10) return;
      clearTimeout(timer);
      start = null;
    };
    el.addEventListener("pointermove", cancel);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    // A long press that opened the menu doesn't also click.
    el.addEventListener("click", (e) => {
      if (el.dataset.longPressed) { delete el.dataset.longPressed; e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  function moreButton(label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "more-btn";
    b.textContent = "⋯";
    b.setAttribute("aria-label", `${label}: more`);
    b.setAttribute("aria-haspopup", "menu");
    b.title = "More: copy, paste, delete…";
    return b;
  }

  root.ItemMenu = { open, attach, moreButton };
})(window);
