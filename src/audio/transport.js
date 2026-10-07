// The loop's clock. JavaScript timers are too jittery to play notes on time,
// so this looks a little ahead (AHEAD seconds) every few milliseconds and
// books each step's notes on the audio clock, which is sample-accurate.
// Steps are sixteenth notes; each one can have its own length, so tempo
// changes and ramps land exactly where they should.
(function (root) {
  "use strict";

  const AHEAD = 0.12;   // seconds of audio booked in advance
  const TICK_MS = 25;   // how often to look ahead

  const stepDuration = (bpm) => 60 / bpm / 4;

  // The steps that fall due before now + ahead, starting from `next`
  // ({ step, time }). `dur` is a step's length in seconds, or a function
  // giving the length of a given step. Steps below zero (a count-in) run
  // up to 0 and then wrap within `steps`. Returns the due steps and where
  // to carry on from.
  function plan(next, now, ahead, dur, steps) {
    const lengthOf = typeof dur === "function" ? dur : () => dur;
    const due = [];
    let { step, time } = next;
    while (time < now + ahead) {
      const d = lengthOf(step);
      due.push({ step, time, dur: d });
      time += d;
      step = step < 0 ? step + 1 : (step + 1) % steps;
    }
    return { due, next: { step, time } };
  }

  // stepLength(step): seconds that step lasts. getSteps(): how many steps the
  // loop runs before going round. onStep(step, time, dur) books a step.
  function create(ctx, { stepLength, getSteps, onStep }) {
    let timer = 0;
    let next = null;

    function tick() {
      // After a long stall (a background tab), skip ahead instead of
      // playing every missed step at once.
      if (next.time < ctx.currentTime - 0.25) next.time = ctx.currentTime + 0.02;
      // The loop can get shorter while playing (a smaller loop range, the
      // last clips removed): wrap back into it.
      const steps = getSteps();
      if (next.step >= steps) next.step %= steps;
      const r = plan(next, ctx.currentTime, AHEAD, stepLength, steps);
      for (const d of r.due) onStep(d.step, d.time, d.dur);
      next = r.next;
    }

    // Starts from step `from`: 0, or below zero for a count-in before it.
    function start(from = 0) {
      if (timer) return;
      next = { step: from, time: ctx.currentTime + 0.05 };
      tick();
      timer = setInterval(tick, TICK_MS);
    }

    function stop() {
      clearInterval(timer);
      timer = 0;
    }

    // The next step to be booked ({ step, time }), or null when stopped.
    const peek = () => (timer && next ? { ...next } : null);

    return { start, stop, peek, get playing() { return !!timer; } };
  }

  const api = { stepDuration, plan, AHEAD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Transport = { ...api, create };
})(typeof window !== "undefined" ? window : globalThis);
