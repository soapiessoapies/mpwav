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
  const durationOf = (id) => (Samples.info(id) || {}).duration || 0;

  // live(track) -> the synth settings to play it with (the morph pad applied).
  // Bars [from, to) are rendered; by default the whole song.
  // onProgress(fraction) is called as each bar is reached.
  // sampleRate: 44100 or 48000. tail: let echoes and reverb ring out after
  // the last bar (off = stop right on the bar line, for loops that repeat).
  // tracks: which tracks to play (by default every track you can hear; one
  // track at a time for stems).
  async function renderSong(song, live, { from = 0, to = Song.songBars(song), onProgress, sampleRate = SAMPLE_RATE, tail = true, tracks = Song.audible(song) } = {}) {
    const steps = (to - from) * Song.STEPS;
    if (steps <= 0) throw new Error("The song has no clips to export yet.");
    await Samples.load(Song.soundIds(song)); // uploaded sounds, decoded

    // When each step starts, following tempo changes and ramps.
    const times = [];
    let t = 0.05;
    for (let i = 0; i < steps; i++) { times.push(t); t += Song.stepSeconds(song, from * Song.STEPS + i); }
    // Without a tail the file starts on the first beat, so it loops cleanly.
    if (!tail) for (let i = 0; i < times.length; i++) times[i] -= 0.05;
    const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Offline) throw new Error("this browser can't render sound");
    const ctx = new Offline(2, Math.ceil((t + (tail ? TAIL : 0) - (tail ? 0 : 0.05)) * sampleRate), sampleRate);

    const bus = Engine.buildBus(ctx);
    bus.master.gain.value = song.master <= Song.FADER.min ? 0 : Math.pow(10, song.master / 20);
    const parts = tracks.map((track) => {
      const channel = Mixer.createChannel(ctx, bus.input);
      channel.setVolume(track.volume, Song.FADER.min);
      channel.setPan(track.pan);
      const synth = Synth.create(ctx, channel.input, live(track), { reverb: bus.reverb, bpm: song.bpm });
      synth.setKit(track.kind === "drums");
      const s = track.sampler;
      if (s) synth.setSample({ ...s, buffer: Samples.buffer(s.sampleId, s.reverse) });
      else if (track.instrument && root.Instruments.zones(track.instrument)) synth.setSample({ zones: root.Instruments.zones(track.instrument) });
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
            p.synth.playNote(n, at + (n.shift || 0) * dur, dur);
          }
          const seg = Song.audioSegment(song, p.track, pos, from * Song.STEPS, durationOf, dur);
          if (seg) p.synth.playAudio(Samples.buffer(seg.sampleId, seg.reverse), seg, times[i]);
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

  root.Render = { renderSong, SAMPLE_RATE, RATES: [44100, 48000] };
})(window);
