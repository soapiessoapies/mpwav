// Tabs, following the standard accessible pattern: one tab is in the Tab
// order, Left/Right arrows (and Home/End) move between tabs and show each
// one straight away, and screen readers hear "Pattern, tab, 2 of 3,
// selected". Tabs with the `hidden` attribute are skipped.
(function (root) {
  "use strict";

  function create(tablist, { onSelect } = {}) {
    const all = () => [...tablist.querySelectorAll('[role="tab"]')];
    const shown = () => all().filter((t) => !t.hidden);
    const panelOf = (t) => document.getElementById(t.getAttribute("aria-controls"));
    let current = null;

    function select(tab, focus) {
      if (typeof tab === "string") tab = document.getElementById(tab);
      if (!tab || tab.hidden) tab = shown()[0];
      current = tab;
      for (const t of shown()) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panelOf(t).hidden = !on;
      }
      if (focus) tab.focus();
      if (onSelect) onSelect(tab.id);
    }

    tablist.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) select(t, false);
    });
    tablist.addEventListener("keydown", (e) => {
      const tabs = shown();
      const i = tabs.indexOf(e.target);
      if (i < 0) return;
      let next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next, true);
    });

    // Call after showing or hiding a tab: keeps a visible tab selected.
    function refresh() {
      select(current && !current.hidden ? current : shown()[0], false);
    }

    return { select, refresh, get current() { return current && current.id; } };
  }

  root.Tabs = { create };
})(window);
