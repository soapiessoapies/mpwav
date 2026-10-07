// ADSR envelopes as straight-line segments, matching what Web Audio's
// linearRampToValueAtTime plays, so the level at any moment can be worked out
// exactly. That's what lets a note be released mid-attack without a click:
// the release starts from where the level really is.
(function (root) {
  "use strict";

  // env: { start, attack, decay, sustain (0..1), peak, releasedAt?, release }
  function levelAt(env, t) {
    const held = heldLevelAt(env, Math.min(t, env.releasedAt ?? Infinity));
    if (env.releasedAt == null || t <= env.releasedAt) return held;
    const k = (t - env.releasedAt) / Math.max(env.release, 1e-6);
    return k >= 1 ? 0 : held * (1 - k);
  }

  function heldLevelAt(env, t) {
    const dt = t - env.start;
    if (dt <= 0) return 0;
    if (dt < env.attack) return env.peak * (dt / env.attack);
    const sus = env.peak * env.sustain;
    const ddt = dt - env.attack;
    if (ddt < env.decay) return env.peak + (sus - env.peak) * (ddt / env.decay);
    return sus;
  }

  // Plays the attack, decay and sustain on an AudioParam.
  function scheduleOn(param, env) {
    param.cancelScheduledValues(env.start);
    param.setValueAtTime(0, env.start);
    param.linearRampToValueAtTime(env.peak, env.start + env.attack);
    param.linearRampToValueAtTime(env.peak * env.sustain, env.start + env.attack + env.decay);
  }

  // Plays the release from wherever the envelope is at time `at`.
  // Returns when it reaches silence.
  function scheduleOff(param, env, at) {
    const from = levelAt({ ...env, releasedAt: null }, at);
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
    else param.cancelScheduledValues(at);
    param.setValueAtTime(from, at);
    param.linearRampToValueAtTime(0, at + env.release);
    env.releasedAt = at;
    return at + env.release;
  }

  const api = { levelAt, scheduleOn, scheduleOff };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Envelope = api;
})(typeof window !== "undefined" ? window : globalThis);
