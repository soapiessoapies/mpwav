// Renders a song to audio, faster than real time, for exporting a WAV file.
// It builds the same chain playback uses (synths, mixer channels, master bus,
// reverb) on an OfflineAudioContext and plays the song into it.
//
// Notes are booked one bar at a time, pausing the render at each bar, so the
// synths' voice handling (stealing the oldest note when out of voices) sees
// the same "now" it does live instead of every note at once.
(function (root) {
  "use strict";

  const SAMPLE_RATE = 44100;
  const TAIL = 3; // seconds after the last bar, for echoes and reverb to ring out

  // live(track) -> the synth settings to play it with (the morph pad applied).
  // Bars [from, to) are rendered; by default the whole song.
  // onProgress(fraction) is called as each bar is reached.
  async function renderSong(song, live, { from = 0, to = Song.songBars(song), onProgress } = {}) {
    const steps = (to - from) * Song.STEPS;
    if (steps <= 0) throw new Error("The song has no clips to export yet.");

    // When each step starts, following tempo changes and ramps.
    const times = [];
    let t = 0.05;
    for (let i = 0; i < steps; i++) { times.push(t); t += Song.stepSeconds(song, from * Song.STEPS + i); }
    const ctx = new OfflineAudioContext(2, Math.ceil((t + TAIL) * SAMPLE_RATE), SAMPLE_RATE);

    const bus = Engine.buildBus(ctx);
    bus.master.gain.value = song.master <= Song.FADER.min ? 0 : Math.pow(10, song.master / 20);
    const parts = Song.audible(song).map((track) => {
      const channel = Mixer.createChannel(ctx, bus.input);
      channel.setVolume(track.volume, Song.FADER.min);
      channel.setPan(track.pan);
      const synth = Synth.create(ctx, channel.input, live(track), { reverb: bus.reverb, bpm: song.bpm });
      return { track, synth };
    });

    let echoBpm = null;
    function bookBar(bar) {
      for (let i = bar * Song.STEPS; i < Math.min(steps, (bar + 1) * Song.STEPS); i++) {
        const pos = from * Song.STEPS + i;
        const dur = Song.stepSeconds(song, pos);
        const at = pos % 2 ? times[i] + song.swing * dur : times[i];
        const bpm = Math.round(Song.bpmAt(song, pos));
        if (bpm !== echoBpm) { echoBpm = bpm; for (const p of parts) p.synth.setTempo(bpm); }
        for (const p of parts) {
          for (const n of Song.notesAtPos(song, p.track, pos)) {
            const v = p.synth.noteOn(n.midi, n.vel, at);
            p.synth.voiceOff(v, at + dur * (n.len - 0.08));
          }
        }
      }
    }

    bookBar(0);
    for (let bar = 1; bar < to - from; bar++) {
      const when = Math.max(0, times[bar * Song.STEPS] - 0.1);
      ctx.suspend(when).then(() => {
        bookBar(bar);
        if (onProgress) onProgress(bar / (to - from));
        ctx.resume();
      });
    }
    return ctx.startRendering();
  }

  root.Render = { renderSong, SAMPLE_RATE };
})(window);
