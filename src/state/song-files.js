// Song files: a .mpwav file is the song plus every sound it uses, so it
// opens anywhere. Chrome and Edge can save to a file in place: the first
// Save asks where, later Saves write straight to it (the browser keeps a
// link to the file, a "handle", here in IndexedDB). Other browsers, and
// every iPhone and iPad, download a copy each time instead.
//
//   canSaveInPlace         whether this browser can keep writing to one file
//   pack(song, sounds)     the file's contents (a Blob)
//   unpack(text)           { song, sounds } from a file's text, or throws
//   save(id, name, blob)   saves; returns { name, inPlace } or null if cancelled
//   saveAs(id, name, blob) always asks where (or downloads)
//   open()                 { text, name, handle } from a picked file, or null
//   remember(id, handle) / forget(id)
//   fileOf(id)             the remembered handle, or null
(function (root) {
  "use strict";

  const EXT = ".mpwav";
  const TYPES = [{ description: "mpwav song", accept: { "application/json": [EXT, ".json"] } }];
  const canSaveInPlace = typeof root.showSaveFilePicker === "function";

  function pack(song, sounds) {
    return new Blob([JSON.stringify({ app: "mpwav", format: 1, song, sounds: sounds || {} })], { type: "application/json" });
  }
  function unpack(text) {
    const data = JSON.parse(text);
    const song = data && data.song ? data.song : data;
    if (!song || !Array.isArray(song.tracks)) throw new Error("that file isn't an mpwav song");
    return { song, sounds: (data && data.sounds) || null };
  }

  // --- handles, kept in IndexedDB by song id ---
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open("mpwav-files", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("handles");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    if (!d) return null;
    return new Promise((resolve) => {
      const t = d.transaction("handles", mode);
      const req = fn(t.objectStore("handles"));
      t.oncomplete = () => resolve(req ? req.result : null);
      t.onerror = () => resolve(null);
    });
  }
  const remember = (id, handle) => tx("readwrite", (s) => s.put(handle, id));
  const forget = (id) => tx("readwrite", (s) => s.delete(id));
  const fileOf = (id) => (canSaveInPlace ? tx("readonly", (s) => s.get(id)) : Promise.resolve(null));

  // iPhones and iPads: the share sheet ("Save to Files") is the dependable
  // way to keep a file, above all from the Home Screen app, where downloads
  // can do nothing. It needs a fresh tap, so callers offer a button for it.
  function canShare(blob, name) {
    try {
      return typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([blob], name, { type: blob.type })] });
    } catch (e) { return false; }
  }
  async function share(blob, name) {
    await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name });
  }

  // Hands the browser a file to keep (the download folder, or Files on an iPhone).
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function write(handle, blob) {
    if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
      if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("permission to save there was turned down");
    }
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function saveAs(id, name, blob) {
    const fileName = name.endsWith(EXT) ? name : name + EXT;
    if (!canSaveInPlace) {
      download(blob, fileName);
      return { name: fileName, inPlace: false };
    }
    let handle;
    try {
      handle = await root.showSaveFilePicker({ suggestedName: fileName, types: TYPES });
    } catch (e) {
      if (e && e.name === "AbortError") return null; // cancelled
      throw e;
    }
    await write(handle, blob);
    await remember(id, handle);
    return { name: handle.name, inPlace: true };
  }

  async function save(id, name, blob) {
    const handle = await fileOf(id);
    if (handle) {
      try {
        await write(handle, blob);
        return { name: handle.name, inPlace: true };
      } catch (e) {
        if (e && e.name === "NotFoundError") await forget(id); // moved or deleted: ask again
        else throw e;
      }
    }
    return saveAs(id, name, blob);
  }

  // Picks a song file. With a handle (Chrome, Edge) later Saves go back to it.
  async function open() {
    if (typeof root.showOpenFilePicker === "function") {
      let handle;
      try { [handle] = await root.showOpenFilePicker({ types: TYPES }); } catch (e) {
        if (e && e.name === "AbortError") return null;
        throw e;
      }
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = EXT + ",.json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        resolve(file ? { text: await file.text(), name: file.name, handle: null } : null);
      });
      input.click();
    });
  }

  root.SongFiles = { EXT, canSaveInPlace, pack, unpack, save, saveAs, open, remember, forget, fileOf, download, canShare, share };
})(window);
