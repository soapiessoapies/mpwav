// Several songs, kept in the browser: an index of { id, title, updated }
// and each song's data under its own key. Works on any storage with
// getItem / setItem / removeItem (localStorage, or a stand-in in tests or
// when the browser blocks storage).
(function (root) {
  "use strict";

  const INDEX = "sound-studio.library";
  const SONG = (id) => "sound-studio.song." + id;
  const LEGACY = "sound-studio.song"; // where the one-song versions kept their song

  function create(storage, now = () => Date.now()) {
    const read = (key) => { try { return JSON.parse(storage.getItem(key)); } catch (e) { return null; } };
    const write = (key, value) => { try { storage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } };

    let index = Array.isArray(read(INDEX)) ? read(INDEX).filter((e) => e && typeof e.id === "string") : [];
    const saveIndex = () => write(INDEX, index);

    const newId = () => "s" + now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
    const titleOf = (data) => (data && typeof data.title === "string" && data.title.trim()) || "Untitled song";

    // Newest first.
    const list = () => index.slice().sort((a, b) => b.updated - a.updated);

    const load = (id) => (index.some((e) => e.id === id) ? read(SONG(id)) : null);

    // Saves a song's data (an object or a JSON string) under its id.
    function save(id, data) {
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      const entry = index.find((e) => e.id === id);
      if (!entry) return false;
      entry.title = titleOf(obj);
      entry.updated = now();
      const ok = write(SONG(id), obj);
      saveIndex();
      return ok;
    }

    // Adds a song to the library. Returns its id.
    function add(data) {
      const id = newId();
      index.push({ id, title: titleOf(data), updated: now() });
      write(SONG(id), data);
      saveIndex();
      return id;
    }

    function remove(id) {
      index = index.filter((e) => e.id !== id);
      try { storage.removeItem(SONG(id)); } catch (e) { /* storage blocked */ }
      saveIndex();
    }

    // A one-song save from before the library becomes its first song.
    function adoptLegacy() {
      const old = read(LEGACY);
      if (!old) return null;
      const id = add(old);
      try { storage.removeItem(LEGACY); } catch (e) { /* storage blocked */ }
      return id;
    }

    return { list, load, save, add, remove, adoptLegacy };
  }

  // A stand-in for localStorage when the browser won't allow storage
  // (some private windows): songs then last until the page closes.
  function memoryStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }

  const api = { create, memoryStorage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Library = api;
})(typeof window !== "undefined" ? window : globalThis);
