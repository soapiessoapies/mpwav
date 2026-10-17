# Credits and Rights Sheet

Everything mpwav uses, where it came from, the license or terms that cover it, and what
those terms ask of us. mpwav has no npm dependencies and loads nothing from a CDN at run
time: every file it serves is in this repo.

## Made by

| Who | What |
|---|---|
| Phie Cassin | Idea, design and direction, the poster and its lettering, testing |
| Claude (Anthropic), through Claude Code | Code, written with Phie in this repo |

Made for CTEC 200: Innovation and Creative Coding, Ringling College, Fall 2026.

## What we made (owned by us)

| Item | Where | Notes |
|---|---|---|
| All app code | `src/`, `index.html`, `styles/`, `sw.js`, `tools/`, `tests/` | Written for mpwav |
| The poster look and lettering | `assets/art/mpwav-poster-title.jpg`, poster colors in `styles/` | Cropped from Phie's mpwav poster |
| App icons | `assets/icons/` | Drawn by `tools/make-icons.js` |
| Demo song, starter loops, drum beats, presets | `src/state/`, `src/audio/drums.js` | Written for mpwav. No samples or recordings from anyone else |
| Every sound | Made live by the Web Audio API | The app ships no audio files. Sounds people add stay on their own device |
| The guided tour | `src/ui/tour.js` | Ported from Phie's own Critters project |
| The paper-and-pixel look | `styles/look.css`, `src/ui/fill.js` | Modeled on Phie's own Bezier project |

No license has been chosen for our code yet, so for now all rights are reserved by the authors.

## Fonts (borrowed)

| Font | Copyright | License | What it asks of us |
|---|---|---|---|
| Nunito | 2014 The Nunito Project Authors | SIL Open Font License 1.1 | Keep the license with the font files, and don't sell the fonts on their own. Done: `assets/fonts/OFL-Nunito.txt` |
| Pixelify Sans | 2021 The Pixelify Sans Project Authors | SIL Open Font License 1.1 | Same. Done: `assets/fonts/OFL-Pixelify-Sans.txt` |
| Caveat Brush | 2015 Google Inc. | SIL Open Font License 1.1 | Same. Done: `assets/fonts/OFL-Caveat-Brush.txt` |

## Methods and standards (ideas we used, no code copied)

| What | Source | Terms |
|---|---|---|
| Reverb layout ("Freeverb") | Jezar at Dreampoint, 2000 | Released into the public domain. Our code is our own version of the layout |
| Time stretch that keeps the pitch (WSOLA) | Verhelst & Roelands, 1993 | A published method. Ideas aren't copyrightable; our code is our own |
| Loudness in LUFS | ITU-R BS.1770 | A public standard |
| Drum note numbers, MIDI file format | General MIDI and Standard MIDI File specs (MIDI Association) | Public specs. They need no attribution, but we credit them anyway |
| WAV and AIFF file formats | Microsoft/IBM RIFF and Apple AIFF specs | Public formats |
| WCAG 2.2 AA | W3C | We follow the guidelines; nothing is copied |

## Browser APIs (built into the browser, no terms to follow)

Web Audio API (with OfflineAudioContext for exports), Web MIDI API (opt-in), IndexedDB and
localStorage, CompressionStream (share links), Service Worker and Web App Manifest (install
and offline), the Fullscreen API.

## Hosting

GitHub Pages hosts the live site at https://soapiessoapies.github.io/mpwav/, under
[GitHub's Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service).
The repo is public so the free plan can serve it.

## Tools (used to build and test; not shipped)

| Tool | Used for | Terms |
|---|---|---|
| Claude Code (Anthropic) | Writing code with Phie | Anthropic's terms. Output belongs to the user |
| WebStorm (JetBrains) | Editor | JetBrains student license |
| Node.js | Tests (`node --test`), the local server, icon drawing | MIT |
| axe-core (Deque) | Accessibility audits, loaded into a local test page during audits | Mozilla Public License 2.0. Not part of the app |
| Google Chrome (headless) | Automated browser tests | Google's terms |
| Git and GitHub | Version control and hosting | GPL-2.0 (Git), GitHub's terms |

## References for function (no code, art or sound taken)

mpwav's workflow borrows ideas from apps Phie knows. None of their code, art, sounds or
branding is used:

- **Ableton Live**: the timeline, clips, Session-style recording, Space to play
- **Cool Edit Pro**: the wave editor's tools and menus
- **SoundCraft**: the Export dialog (bounce mix, stems, MIDI, session info)
- **Krotos**: the XY morph pad idea

Their names show up in the Guide and on hover hints only to help people who already know
those apps find their way around.
