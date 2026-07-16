# Note Compass — Guitar Note Trainer

A drill app for learning where the notes live on a guitar fretboard. The app shows a note and a target string; click the fret (or open string) where that note lives.

## Features

- Interactive 6-string fretboard with realistic fret spacing, inlays, and string gauges
- Fine-grained difficulty: fret count (3–12), per-string toggles, left/right handedness, string order (high e or low E on top), naturals-only vs all 12 notes, open strings on/off
- Two modes:
  - **Incremental** (default) — starts with 2 unlocked positions; find the prompted note on any unlocked spot (locked cells are dimmed, mastered ones get an amber pip). When every note in play reaches the configurable unlock streak, a new position joins the board; a miss resets that note's streak. Unlock order is configurable: **Random** picks anywhere (preferring unseen notes), **From nut** walks each string outward from the nut — every unlock is either the next fret on a started string or the first fret of a new one
  - **Free** — a note plus a target string is prompted; every position within the difficulty settings is fair game
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
