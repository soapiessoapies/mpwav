# mpwav (working title)

An Ableton-inspired music studio in the browser: arrangement view, synths, and a mixer.
One web app serves both screen sizes. Desktop gets the full arrangement view; phones get
a focused loop/pattern maker. It installs as an app (PWA) on Windows and on phones.

Built for **Creative Coding & Innovation**, Weeks 8–10.

## Audience

Anyone musically inclined, sighted or visually impaired, at a beginner-to-intermediate
level of sound design.

## Hypothesis

> In the required form, users will be able to create fast, simple tunes for whatever sound
> modulation they may need. In creating an app that relies on buttons and editors, the users
> will have a far easier time creating music for beginner-intermediate level sound designers.

**Measured by (draft):** at least 4 of 5 testers make and play back a loop of 8 bars or more in under
5 minutes on a phone, without help, including at least one tester using a screen reader.

## Requirements from the brief

- Works on a phone
- WCAG AA contrast, fully keyboard-navigable, screen-reader compatible
- Live deployed MVP (URL)
- Evidence from 5+ real users (not classmates)
- A documented pivot with before-and-after

## Running it

- **Live:** https://soapiessoapies.github.io/mpwav/ (GitHub Pages, redeploys on every push to `main`)

- **Install it:** Settings › App › Install mpwav (Chrome or Edge on Windows and Android), or on an
  iPhone / iPad: Safari › Share › Add to Home Screen. Once loaded it works offline (`sw.js`).
- **Double-click `mpwav.cmd`** to open it in Chrome as an app window.
- **To test on a phone:** run `npm run serve` and open the "on your network" address it prints
  from a phone on the same Wi-Fi.
- **Tests:** `npm test` covers the song model, song library, WAV encoding, undo history, note math, envelopes, voices, presets, the WCAG AA
  contrast of every color pair in every background theme, and that the offline cache lists every file the app loads.
- **Icons:** `node tools/make-icons.js` redraws `assets/icons/` (no dependencies).
- **Adding a script?** Add it to `SHELL` in `sw.js` too (a test fails until you do).

## Playing

| | |
|---|---|
| Play / stop | `Space` (from anywhere), or the Play button; Loop repeats the loop range, off plays from the cursor to the end |
| Pick a track | Click its name in the playing box (Lead, Bass, Pad, Hat) |
| Clips | Double-click an empty spot for a new clip; drag to move, drag the right edge to stretch (the loop repeats); double-click or `Enter` to open; `Delete` removes |
| Notes on the timeline | Clips show their notes (height = pitch, brightness = loudness, names when zoomed in). Drag a note to move it (snapped), drag its right end to stretch it, double-click it to delete it, Shift-click to add to the selection; the clip opens in the piano roll as you do |
| Notes (piano roll) | Click to add (drag right to draw it longer), drag to move, drag the edge to stretch, double-click to delete; scroll for higher/lower notes |
| Notes with a keyboard | Arrows move the cursor, `Enter` adds/removes, `Shift` + arrows stretch, `Alt` + arrows move, `Delete` removes the selection |
| Note page | Length, loudness and pitch of the selected notes, and **this note's sound**: pitch slide, pitch sweep, fine tune, vibrato, brightness, pan, retrigger and noise burst, on top of the track's sound (Hear it plays them; double-click a slider to reset it). Notes with their own sound wear a dot |
| Record | Plays and adds what you play to the open clip, as long as you held each key; Undo take removes the last recording |
| Mix | Note Edit › Mix: faders, pan, M (mute) and S (solo) per track |
| Copy and paste | Ctrl + C / X / V / D: notes when the piano roll has focus, clips otherwise; Ctrl + Shift + D makes a linked copy |
| Sections | Duplicate, insert a bar, or delete bars across every track, using the loop range |
| Undo | Ctrl + Z / Ctrl + Y, or the Undo / Redo buttons: every edit, one step at a time |
| Tempo | Type it, or Tap tempo; Metronome clicks on every beat; Count-in gives a bar of clicks before recording; Tempo change at cursor adds a jump or ramp, shown on the ruler |
| Step input | With the piano roll focused (or Step input on), play a key to write it at the cursor; hold keys for a chord |
| Tracks | Note Edit › Track: rename, color, move up/down, remove, add a synth track or an audio track (up to 12) |
| Sound files | Upload .wav / .mp3 (or drop them on the timeline). On an **audio track** they become audio clips (waveforms on the timeline); open one to trim (drag the edges or type Start / End), fade in / out, set gain, reverse, fit to tempo (speeds it up or down, like a record, to fill the loop), loop the whole sound or replace it. On a **synth track** (Note Edit › Sound › Instrument, or drop on its row) a sound becomes the instrument: pitched by key from its root note, still shaped by the filter, envelope, Warp and each note's own sound. Sounds are kept in this browser and travel inside exported song files |
| Song | Note Edit › Song: key and scale (dims notes outside it, optional keep-in-key), snap, swing |
| Songs | The Songs button by the title: new, from the demo, duplicate, open, delete; Export WAV; export / import a song file |
| One screen | On desktop everything fits the window (Settings › Layout › Fit to the window); a panel with more than fits scrolls inside itself. Drag the bar between two panels (or focus it and use the arrows) to share the room differently |
| Section and Tempo menus | The Section and Tempo buttons in the playing box open small menus (section tools; tap tempo, metronome, count-in, tempo changes) |
| Tips | Settings › Tutorial › Show tips puts a short how-to under each part; screen readers always hear them |
| Settings | Text and control size (Auto grows with the screen; Small to Extra large), layout (Auto / Desktop / Phone, fit to the window), Arrange panels, tutorial tips, background, look (Smooth / Pixel details / All pixel), motion, install as an app, single-key shortcuts, credits |
| Play live | Tap/click the keys (slide to glide), or computer keys `A W S E D F T G Y H U J K` |
| Octave | `Z` / `X`, or the − / + buttons |
| Stop every note | `Esc`, or Stop all notes |
| Reset a slider or fader | Double-click it |

## Layout

```
src/audio   Web Audio engine, synths, effects, mixer
src/ui      views: arrangement, sequencer, piano roll, mixer
src/state   song model, undo, save/load
styles/     CSS
assets/     icons, samples
docs/       audience statement, test notes, pivot write-up
tests/
```
