// Undo and redo for everything: the song is saved as JSON after every
// change, and each saved version different from the last becomes a step
// back. Because saving is debounced, a drag or a slider sweep lands as one
// step, not hundreds. Undo hands back the version to restore.
(function (root) {
  "use strict";

  function create(limit = 100) {
    let present = null; // the latest saved version (a JSON string)
    const past = [];
    const future = [];

    // Records a saved version. Returns whether it was a change.
    function commit(json) {
      if (present === null) { present = json; return false; }
      if (json === present) return false;
      past.push(present);
      if (past.length > limit) past.shift();
      present = json;
      future.length = 0;
      return true;
    }

    function undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return present;
    }

    function redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return present;
    }

    // After restoring a version, the saved form of it may be spelled a
    // little differently (keys in another order): make that the present
    // without counting it as a change.
    function sync(json) { present = json; }

    return {
      commit, undo, redo, sync,
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; },
    };
  }

  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.History = api;
})(typeof window !== "undefined" ? window : globalThis);
