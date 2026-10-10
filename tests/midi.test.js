// MIDI keyboard messages: note on, note off, and note on with velocity 0
// (how many keyboards send a release).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Midi = require("../src/ui/midi.js");

test("note on and off on any channel", () => {
  assert.deepEqual(Midi.parse([0x90, 60, 100]), { type: "on", note: 60, velocity: 100 });
  assert.deepEqual(Midi.parse([0x93, 64, 1]), { type: "on", note: 64, velocity: 1 });
  assert.deepEqual(Midi.parse([0x80, 60, 40]), { type: "off", note: 60, velocity: 40 });
  assert.deepEqual(Midi.parse([0x90, 60, 0]), { type: "off", note: 60, velocity: 0 });
});

test("other messages are ignored", () => {
  assert.equal(Midi.parse([0xb0, 64, 127]), null); // sustain pedal
  assert.equal(Midi.parse([0xf8]), null); // clock
  assert.equal(Midi.parse(null), null);
});
