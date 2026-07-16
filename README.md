# Note Compass — Guitar Note Trainer

A drill app for learning where the notes live on a guitar fretboard. The app shows a note and a target string; click the fret (or open string) where that note lives.

## Features

- Interactive 6-string fretboard with realistic fret spacing, inlays, and string gauges
- Fine-grained difficulty: fret count (3–12), per-string toggles, left/right handedness, string order (high e or low E on top), naturals-only vs all 12 notes, open strings on/off
- Three modes:
  - **Incremental** (default) — starts with a few unlocked positions, each showing its note name until first clicked (newly unlocked notes are introduced the same way); find the prompted note on any unlocked spot (locked cells are dimmed, mastered ones get an amber pip). When every note in play reaches the configurable unlock streak, a new position joins the board; a miss resets that note's streak. Unlock order is configurable: **Random** picks anywhere (preferring unseen notes), **From nut** walks each string outward from the nut — every unlock is either the next fret on a started string or the first fret of a new one
  - **Guided** — a hands-off journey across the neck's natural notes on a full 12-fret board: starts with F, G, A on the low E string, unlocks more naturals on that string as you master what's there, grows the fret window out to 12, then moves on to the next string (A, D, G, B, high e). Mastery is adaptive per note — a clean note needs a streak of 2, every miss raises that note's requirement (up to 5) until recovered, and only answers under 3 seconds count, rewarding recall over fret-counting. The board paces itself: frets beyond the first 5 unlock only while recent accuracy (last 10 answers) is ≥ 85%, and mastered notes slowly regain question weight the longer they go unasked, so old strings get periodic spot checks. Question direction is adaptive: new notes are always find questions, notes with a building streak increasingly come back in reverse (name the highlighted spot), and spot checks on long-unseen notes always arrive in reverse. Note settings are driven automatically; Guided and Incremental each keep their own progress
  - **Free** — a note plus a target string is prompted; every position within the difficulty settings is fair game
- A Questions control (free and incremental modes) picks the drill direction: **Find** (click where a named note lives), **Name** (a board spot pulses with a ?; answer with the note's name via buttons or the C–B letter keys), or **Mix** (random per question). In incremental mode, name answers count toward unlock streaks, and spots still showing their name hint are always asked as finds first
- In-app help: the ? button next to the scoreboard opens a panel explaining every feature
- Reset button that clears streaks, stats, unlocked notes, and settings
- Streak, best streak, and accuracy counters
- Mistake tracking: missed string/fret positions are weighted to reappear more often until answered correctly, and surface in the Trouble Spots panel
- Correct/wrong feedback on the board and prompt card, plus a Karplus–Strong plucked-string sound of the note you clicked (and the correct one when you miss)
- Settings, mistakes, and best streak persist in localStorage

## Running

```sh
bun install
bun run dev
```

`bun run build` typechecks and produces a production build; `bun run lint` runs oxlint.
