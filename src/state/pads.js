// Sound pads: your own sounds (a drum hit you like, a wave you made) on keys
// beside the keyboard, to play and drop into songs quickly. They're grouped
// into named sections (Percussion, Bass, Treble…) and kept across songs: the
// bank is yours, not a song's. Each pad keeps a sound's id; the sound itself
// lives with the other sounds (src/state/samples.js).
//
//   bank = { sections: [{ id, name, pads: [{ id, name, sampleId }] }], nextId }
//
// Plain data and pure functions, so the bank saves as JSON and tests run in Node.
(function (root) {
  "use strict";

  const MAX_SECTIONS = 12;
  const MAX_PADS = 24; // per section
  const NAME_MAX = 24;
  const DEFAULT_SECTIONS = ["Percussion", "Bass", "Treble"];
  const SOUND_RE = /^snd-[a-z0-9]{1,24}$/;

  const cleanName = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim().slice(0, NAME_MAX) : fallback);

  function create() {
    const bank = { sections: [], nextId: 1 };
    for (const name of DEFAULT_SECTIONS) addSection(bank, name);
    return bank;
  }

  const newId = (bank, prefix) => prefix + bank.nextId++;
  const section = (bank, id) => bank.sections.find((s) => s.id === id) || null;
  function findPad(bank, padId) {
    for (const s of bank.sections) {
      const pad = s.pads.find((p) => p.id === padId);
      if (pad) return { section: s, pad };
    }
    return null;
  }

  function addSection(bank, name) {
    if (bank.sections.length >= MAX_SECTIONS) return null;
    const s = { id: newId(bank, "sec"), name: cleanName(name, `Section ${bank.sections.length + 1}`), pads: [] };
    bank.sections.push(s);
    return s;
  }

  function renameSection(bank, id, name) {
    const s = section(bank, id);
    if (s) s.name = cleanName(name, s.name);
    return s;
  }

  // Removing a section keeps its pads: they move to the section before it
  // (or after, for the first). The last section can't be removed.
  function removeSection(bank, id) {
    const i = bank.sections.findIndex((s) => s.id === id);
    if (i < 0 || bank.sections.length < 2) return false;
    const [gone] = bank.sections.splice(i, 1);
    const to = bank.sections[Math.max(0, i - 1)];
    to.pads.push(...gone.pads.slice(0, MAX_PADS - to.pads.length));
    return true;
  }

  function moveSection(bank, id, dir) {
    const i = bank.sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= bank.sections.length) return false;
    [bank.sections[i], bank.sections[j]] = [bank.sections[j], bank.sections[i]];
    return true;
  }

  function addPad(bank, sectionId, { name, sampleId }) {
    const s = section(bank, sectionId) || bank.sections[0];
    if (!s || s.pads.length >= MAX_PADS || !SOUND_RE.test(sampleId || "")) return null;
    const pad = { id: newId(bank, "pad"), name: cleanName(name, `Pad ${s.pads.length + 1}`), sampleId };
    s.pads.push(pad);
    return pad;
  }

  function renamePad(bank, padId, name) {
    const f = findPad(bank, padId);
    if (f) f.pad.name = cleanName(name, f.pad.name);
    return f ? f.pad : null;
  }

  function movePad(bank, padId, sectionId) {
    const f = findPad(bank, padId);
    const to = section(bank, sectionId);
    if (!f || !to || to === f.section || to.pads.length >= MAX_PADS) return false;
    f.section.pads.splice(f.section.pads.indexOf(f.pad), 1);
    to.pads.push(f.pad);
    return true;
  }

  function removePad(bank, padId) {
    const f = findPad(bank, padId);
    if (!f) return false;
    f.section.pads.splice(f.section.pads.indexOf(f.pad), 1);
    return true;
  }

  // Every sound the bank uses (so clearing unused sounds keeps them).
  const soundIds = (bank) => bank.sections.flatMap((s) => s.pads.map((p) => p.sampleId));

  // A bank from saved JSON, whatever state it's in.
  function sanitize(input) {
    const bank = { sections: [], nextId: 1 };
    const src = input && Array.isArray(input.sections) ? input.sections : null;
    if (!src) return create();
    let n = 1;
    for (const s of src.slice(0, MAX_SECTIONS)) {
      if (!s || typeof s !== "object") continue;
      const pads = (Array.isArray(s.pads) ? s.pads : [])
        .filter((p) => p && SOUND_RE.test(p.sampleId || ""))
        .slice(0, MAX_PADS)
        .map((p) => ({ id: "pad" + n++, name: cleanName(p.name, "Pad"), sampleId: p.sampleId }));
      bank.sections.push({ id: "sec" + n++, name: cleanName(s.name, "Section"), pads });
    }
    if (!bank.sections.length) return create();
    bank.nextId = n;
    return bank;
  }

  const api = {
    create, sanitize, section, findPad, addSection, renameSection, removeSection, moveSection,
    addPad, renamePad, movePad, removePad, soundIds, MAX_SECTIONS, MAX_PADS, DEFAULT_SECTIONS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pads = api;
})(typeof window !== "undefined" ? window : globalThis);
