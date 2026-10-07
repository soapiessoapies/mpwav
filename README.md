# Sound Studio (working title)

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

- **Live:** https://soapiessoapies.github.io/sound-studio/ (GitHub Pages, redeploys on every push to `main`)

- **Double-click `Sound Studio.cmd`** to open it in Chrome as an app window.
- **To test on a phone:** run `npm run serve` and open the "on your network" address it prints
  from a phone on the same Wi-Fi.
- **Tests:** `npm test` covers the note math, envelopes, voices, presets, and the WCAG AA
  contrast of every color pair.

## Playing

| | |
|---|---|
| Play / stop the loop | `Space` (from anywhere), or the Play button |
| Pick a track to edit | Click its name on the mixer (Lead, Bass, Pad, Hat) |
| Add / remove a note | Click or tap a square in the pattern; drag with a mouse to paint |
| Pattern with a keyboard | Arrows move, `Enter` adds or removes |
| Mix | Faders, pan, M (mute) and S (solo) on each channel strip |
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
