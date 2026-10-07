# Sound Studio — Design

Shared, commentable version (the one to edit and hand in):
https://claude.ai/code/artifact/4335e52a-e095-44b2-b6ed-ce0a0e6edf48 — this file is the repo copy, kept in step with it.

As of 2026-10-07. Status: agreed direction, not built yet. The layout sketch is still to come.

## Overview

Sound Studio will open on an Ableton-style timeline where every track's music sits in colored blocks that you place, stretch, copy and paste. It is a browser music studio for musically inclined beginners and intermediates, sighted or visually impaired, built for Creative Coding & Innovation.

**The class brief requires:** it works on a phone, meets WCAG AA contrast, is fully keyboard-navigable and works with screen readers, ships as a live URL, and is tested by 5 people outside the class.

**What exists today** ([live site](https://soapiessoapies.github.io/sound-studio/)): four synth tracks (Lead, Bass, Pad, Hat), a mixing desk, a 16-step pattern grid with slots A–D, recording from the keyboard, a 16-bar arrangement grid, the Sound tab (synth, morph pad, Warp effects) and tabs for small screens. This design replaces the pattern grid and arrangement grid with one timeline; the sound and mixer parts stay.

## The timeline (main view)

The app opens on the timeline: every track stacked as a row, time running left to right in bars, like Ableton's Arrangement View.

- **Tracks as rows.** Lead, Bass, Pad and Hat each get a row; the selected track's row is highlighted. Selecting a track is how you reach its output settings (sound, mixer, note length).
- **It grows as you work.** There is no fixed song length. The song ends a couple of empty bars after the last block, and placing a block near the end adds more room.
- **A playhead** sweeps across while playing. Tap or click the ruler at the top to move it; Play starts from there.
- **Loop brace.** A bracket on the ruler marks a section to repeat while you work on it (Ableton's loop switch). Off = play the whole song.
- **Zoom.** Pinch on a phone, Ctrl + wheel on Windows, or + / − buttons: zoomed out shows the whole song, zoomed in shows single steps.

## Clips, not loose notes

Recommendation: the timeline holds **clips** (blocks of notes), and you open a clip to edit its notes, as in Ableton. It is the fastest way to arrange because you build a part once and reuse it everywhere.

| Action | With clips | With loose notes on the timeline |
| --- | --- | --- |
| Repeat a 1-bar beat for 8 bars | Drag the clip's right edge out | Copy and paste 8 times |
| Change the beat everywhere it repeats | Edit one linked clip | Edit every copy by hand |
| Make a variation | Duplicate the clip, then edit the copy | Select, copy, paste, edit |
| See the song's shape | Named, colored blocks per section | Thousands of tiny notes |

- **Clip editor.** Double-click (tap twice on a phone) a clip to open its notes in a piano-roll editor docked under the timeline. Notes are the colored blocks described below.
- **Linked vs independent copies.** Alt-drag (or Copy as linked) makes a linked copy that changes when the original does; a normal copy is independent. Linked clips show a small chain mark.
- **Clip library.** Each track keeps a list of its clips (this replaces the A–D slots, with no limit of four). Clips get names like "Verse beat", and can be dragged from the list onto the timeline.
- **Recording** makes a new clip where the playhead is, or adds into the clip under it (adding with Undo take, as now).

## Placing notes

In the clip editor, scrolling moves through the pitch rows, tapping places a note, and the keyboard can type notes in at a cursor. All three work on phone and Windows.

**Scrolling the pitch rows.** The editor shows about one octave at a time; scroll up and down for higher or lower notes, with the piano keys along the left edge as a guide.

| | Phone | Windows |
| --- | --- | --- |
| Move through pitches | Swipe up / down | Mouse wheel |
| Move through time | Swipe left / right | Shift + wheel, or the scrollbar |
| Place a note | Tap a square | Click a square |
| Zoom | Pinch | Ctrl + wheel |

Scrolling works well on Windows too: a wheel is quicker than the current − / + row buttons, and those buttons stay for keyboard and screen-reader users.

**Keyboard as the pitch input (step input).** Put the cursor at a point in the clip, then press a piano key (on screen or A W S E D…): that note lands at the cursor and the cursor moves on by one note length. Hold two keys for a chord. This is also the main way screen-reader users write music, since it needs no pointing.

**Note length.** Every note is a block whose width is how long it plays. Drag a block's right edge to stretch or shorten it, or set a default length for new notes (1/16, 1/8, 1/4, 1/2, one bar). It replaces today's per-track Note length dropdown, so one bass part can mix long and short notes. Keyboard: Shift + ← / → shortens or lengthens the selected notes.

## Color blocks

Each track has a color range you choose, and every note is a shade in that range set by its key, so a track's notes all read as one family and the same key always gets the same shade.

- **Per-track color.** Pick a track color from a set of swatches (orange, mint, sky, violet, rose, lime, gold, coral). The swatches are chosen so text and edges on them pass WCAG AA.
- **Shade by key.** The 12 keys (C, C#, D…B) step from deep to light through the track's color, e.g. every C on the Lead track is its deepest orange and every B its lightest. Octave doesn't change the shade.
- **Clips** on the timeline show the track color, with the notes inside drawn as tiny blocks in their key shades, so you can spot repeated parts at a glance.
- **Never color alone.** Note blocks also show their name (C4, E4) when wide enough, the row tells you the pitch, and screen readers hear "E 4, beat 3, quarter note". People who can't tell the shades apart lose nothing.
- **Option:** color by key across all tracks (every C the same color everywhere), for spotting chords and clashes between tracks.

## Copy, paste and selection

Everything can be selected and copied: notes inside a clip, whole clips, or a time range across every track. Paste lands at the playhead or cursor.

| What | Select it by | Then |
| --- | --- | --- |
| Notes in a clip | Click / tap a note; Shift adds more; drag a box around several; Ctrl + A for all | Copy, cut, paste, duplicate, delete, move, transpose (↑ / ↓ one key, Shift + ↑ / ↓ an octave) |
| Clips | Click / tap a clip; Shift adds more; drag a box on the timeline | Copy, paste, duplicate, linked copy, delete, move, rename, recolor |
| A section (a time range, all tracks) | Drag along the ruler | Copy, paste, duplicate, insert empty bars, delete bars |

- **Shortcuts (Windows):** Ctrl + C / X / V, Ctrl + D duplicate (places the copy right after), Delete, Ctrl + Z / Ctrl + Y undo and redo.
- **Phone:** long-press selects and opens a small action bar (Copy, Paste, Duplicate, Delete, Link); a second finger tap adds to the selection.
- **Screen readers:** the same actions are buttons in the action bar, and each one is announced ("3 notes copied", "Pasted at bar 5").
- **Undo everything.** One undo history covers notes, clips, sections and recording takes.

## Tempo

Notes are placed in bars and beats, not seconds, so changing the tempo speeds the song up or slows it down without moving anything, like replaying video frames at a different frame rate.

- **Any tempo, any time.** Type a BPM or drag the number (20–300). It can change while playing; the song keeps its place.
- **Tap tempo.** Tap a button (or press T) in time with the beat you hear in your head; after four taps it sets the BPM.
- **Tempo changes along the song.** Tempo markers on the ruler: a marker at bar 9 can switch from 110 to 140, either as a jump or as a gradual ramp up to it. The ruler shows the BPM at each marker.
- **Set the tempo after recording (stretch goal).** Record freely without a click, then Sound Studio suggests a tempo from the notes' spacing and snaps them to the grid. Snapping already works; guessing the tempo is the hard part, so this comes last.
- **Metronome.** An optional click while playing or recording, with a one-bar count-in before recording starts.

## Tracks, panels and song settings

Selecting a track (its row name on the timeline) switches every side panel to that track; the Sound and mixer designs stay as they are, split into smaller sections to fit beside the timeline.

- **Track panel** (opens for the selected track), in collapsible sections:
    - Sound: preset, synth, morph pad, Warp — today's Sound tab.
    - Output: fader, pan, mute, solo, color.
    - Notes: default note length, scale helper.
- **Mixer** stays a desk of strips; on wide screens it can sit at the bottom like Ableton's mixer, or open as its own view.
- **Song customization:**
    - Add, remove, rename and reorder tracks (not fixed at four); any preset on any track.
    - Song title, time signature (4/4 to start; 3/4 and 6/8 later), swing amount.
    - Key and scale helper: pick a key (e.g. A minor) and notes outside it are dimmed in the editor; optional snap-to-scale.
    - Snap grid: 1/4, 1/8, 1/16, 1/32, triplets, or off.
    - Save several songs, open and rename them; export to WAV.
- The finer details are left for later, as agreed.

## Phone, Windows and accessibility

One app serves both: Windows shows the timeline, clip editor and track panel side by side; a phone shows one at a time and swipes between them.

| Area | Windows (wide screen) | Phone |
| --- | --- | --- |
| Timeline | Top half, all tracks | Full screen, all tracks |
| Clip editor | Docked under the timeline | Opens full screen from a clip; back button returns |
| Track panel | Right side | Slides up from the bottom |
| Keyboard | Under the clip editor, can be hidden | Pinned at the bottom of the clip editor, can be hidden |
| Transport | Top bar: Play, Record, tempo, tap, metronome | Top bar, the same buttons, smaller |

**Accessibility (WCAG AA):**

- The timeline and clip editor are grids of real buttons: arrow keys move, Enter places or opens, and a screen reader hears "Bass, bar 5, clip Verse beat" or "E 4, beat 3, quarter note".
- Step input (keyboard as pitch) lets anyone write music without dragging.
- Every drag has a keyboard or button version (move, stretch, select, copy).
- Colors pass contrast checks automatically (the existing test covers every new color), and color never carries meaning alone.

## Open questions and build order

The layout sketch is still to come and goes here when it arrives; it may change the Windows and phone layouts above.

**Open questions**

- [ ] Does the clips-plus-clip-editor approach match the drawing, or should notes sit straight on the timeline?
- [ ] Should linked copies be the default when dragging a clip, or normal copies?
- [ ] Which track colors and how many tracks should a new song start with?
- [ ] Is the Week 9 phone test about writing a beat from scratch, or remixing the demo? It decides what the MVP must have.

**Build order** (each step usable on its own and pushed live)

1. Timeline with tracks, clips, playhead, ruler and zoom; today's patterns become the first clips.
2. Clip editor: piano roll with colored note blocks, scroll through pitches, stretchable lengths.
3. Selection, copy, paste, duplicate, linked copies, and one undo history.
4. Step input from the keyboard, and recording into clips.
5. Tempo tools: tap tempo, metronome and count-in, tempo markers.
6. Track panel and song customization: colors, add/rename tracks, scale helper, snap grid.
7. Save several songs, WAV export, then the tempo-from-recording stretch goal.
