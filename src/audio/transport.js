// The loop's clock. JavaScript timers are too jittery to play notes on time,
// so this looks a little ahead (AHEAD seconds) every few milliseconds and
// books each step's notes on the audio clock, which is sample-accurate.
// Steps are sixteenth notes.
(function (root) {
  "use strict";

  const AHEAD = 0.12;   // seconds of audio booked in advance
  const TICK_MS = 25;   // how often to look ahead

  const stepDuration = (bpm) => 60 / bpm / 4;

  // The steps that fall due before now + ahead, starting from `next`
  // ({ step, time }). Returns them and where to carry on from.
  function plan(next, now, ahead, dur, steps) {
    const due = [];
    let { step, time } = next;
    while (time < now + ahead) {
      due.push({ step, time });
      time += dur;
      step = (step + 1) % steps;
    }
    return { due, next: { step, time } };
  }

  function create(ctx, { getBpm, getSteps, onStep }) {
    let timer = 0;
    let next = null;

    function tick() {
      const dur = stepDuration(getBpm());
      // After a long stall (a background tab), skip ahead instead of
      // playing every missed step at once.
      if (next.time < ctx.currentTime - 0.25) next.time = ctx.currentTime + 0.02;
      // The loop can get shorter while playing (switching to loop mode,
      // emptying the last bars of the song): wrap back into it.
      const steps = getSteps();
      if (next.step >= steps) next.step %= steps;
      const r = plan(next, ctx.currentTime, AHEAD, dur, steps);
      for (const d of r.due) onStep(d.step, d.time, dur);
      next = r.next;
    }

    function start() {
      if (timer) return;
      next = { step: 0, time: ctx.currentTime + 0.05 };
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
