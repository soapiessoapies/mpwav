const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/audio/envelope.js");

const env = () => ({ start: 1, attack: 0.1, decay: 0.2, sustain: 0.5, peak: 1, release: 0.4 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("attack rises, decay falls to sustain, then holds", () => {
  const e = env();
  close(E.levelAt(e, 0.5), 0);
  close(E.levelAt(e, 1.05), 0.5);
  close(E.levelAt(e, 1.1), 1);
  close(E.levelAt(e, 1.2), 0.75);
  close(E.levelAt(e, 1.3), 0.5);
  close(E.levelAt(e, 9), 0.5);
});

test("release fades from wherever the level was, even mid-attack", () => {
  const e = { ...env(), releasedAt: 1.05 };
  close(E.levelAt(e, 1.05), 0.5);
  close(E.levelAt(e, 1.25), 0.25);
  close(E.levelAt(e, 1.45), 0);
  close(E.levelAt(e, 5), 0);
});

// Records what would be scheduled on an AudioParam.
function fakeParam() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    cancelScheduledValues: rec("cancel"),
    cancelAndHoldAtTime: rec("hold"),
    setValueAtTime: rec("set"),
    linearRampToValueAtTime: rec("ramp"),
  };
}

test("scheduleOn plays the attack then the decay as ramps", () => {
  const p = fakeParam();
  E.scheduleOn(p, env());
  assert.deepEqual(p.calls, [["cancel", 1], ["set", 0, 1], ["ramp", 1, 1.1], ["ramp", 0.5, 1.3]]);
});

test("scheduleOff ramps to zero from the current level and says when it's silent", () => {
  const p = fakeParam();
  const e = env();
  const end = E.scheduleOff(p, e, 1.2);
  close(end, 1.6);
  assert.equal(e.releasedAt, 1.2);
  assert.deepEqual(p.calls.map((c) => c[0]), ["hold", "set", "ramp"]);
  close(p.calls[1][1], 0.75);
  assert.deepEqual(p.calls[2], ["ramp", 0, 1.6]);
});
