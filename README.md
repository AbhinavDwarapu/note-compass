# Note Compass: Guitar Note Trainer

A drill app for learning where the notes live on a guitar fretboard. The app shows a note and a target string; click the fret (or open string) where that note lives.

## Features

- Interactive 6-string fretboard with realistic fret spacing, inlays, and string gauges
- Three modes:
  - **Incremental** (default): start with a few unlocked positions and earn more by answering each one correctly a few times in a row. New positions show their note name until first clicked. Unlocks can appear anywhere on the board or walk outward from the nut.
  - **Guided**: learn the whole neck one string at a time, starting on the low E. The app decides what to unlock and when, based on speed and accuracy, mixes in reverse questions, and periodically rechecks notes you haven't seen in a while.
  - **Free**: every position within the difficulty settings is fair game.
- Two question directions: find a named note on the board, or name a highlighted spot (via buttons or the letter keys). A Questions control picks find, name, or a mix.
- Difficulty settings: fret count (3 to 12), per-string toggles, handedness, string order, naturals only or all 12 notes, open strings on or off
- Streak, best streak, and accuracy counters
- Missed positions surface in a Trouble Spots panel and reappear more often until answered correctly
- Feedback on every answer, including a Karplus-Strong plucked-string sound of the note you clicked (and the correct one when you miss)
- In-app help panel, a full reset button, and persistence in localStorage

## Running

```sh
bun install
bun run dev
```

`bun run build` typechecks and produces a production build; `bun run lint` runs oxlint.
