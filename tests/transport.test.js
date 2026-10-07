const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/audio/transport.js");

test("a step is a sixteenth note", () => {
  assert.equal(T.stepDuration(120), 0.125);
  assert.equal(T.stepDuration(60), 0.25);
});

test("plan books every step due within the look-ahead, and wraps the loop", () => {
  const dur = 0.125;
  const r = T.plan({ step: 14, time: 1.0 }, 1.0, 0.3, dur, 16);
  assert.deepEqual(r.due, [{ step: 14, time: 1.0 }, { step: 15, time: 1.125 }, { step: 0, time: 1.25 }]);
  assert.deepEqual(r.next, { step: 1, time: 1.375 });
});

test("nothing is booked before it's due", () => {
  const r = T.plan({ step: 3, time: 2.0 }, 1.5, 0.1, 0.125, 16);
  assert.deepEqual(r.due, []);
  assert.deepEqual(r.next, { step: 3, time: 2.0 });
});

test("successive ticks never book a step twice or skip one", () => {
  let next = { step: 0, time: 0 };
  const seen = [];
  for (let now = 0; now < 4; now += 0.025) {
    const r = T.plan(next, now, T.AHEAD, 0.1, 16);
    seen.push(...r.due.map((d) => d.step));
    next = r.next;
  }
  for (let i = 0; i < seen.length; i++) assert.equal(seen[i], i % 16);
});
