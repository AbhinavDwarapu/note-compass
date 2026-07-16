import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  FLAT_NAMES,
  GUITAR_STRINGS,
  PITCH_NAMES,
  activePool,
  buildCandidates,
  cellKey,
  fretFraction,
  isNaturalPitch,
  midiAt,
  parseCellKey,
  pickUnlockCell,
  pickWeighted,
  pitchClassAt,
  sameCell,
  withSeeds,
} from "./music";
import type { Cell, Settings } from "./music";
import { playPluck } from "./audio";
import "./App.css";

const STORAGE_KEY = "fret-finder-v1";

const DEFAULT_SETTINGS: Settings = {
  mode: "free",
  unlockStreak: 10,
  unlockOrder: "random",
  fretCount: 5,
  enabledStrings: [true, true, true, true, true, true],
  leftHanded: false,
  reverseStrings: false,
  naturalsOnly: true,
  includeOpenStrings: true,
  soundEnabled: true,
};

const PRAISE = [
  "Nailed it.",
  "Clean hit.",
  "That one rings true.",
  "Right on the money.",
];

const INLAY_FRETS = [3, 5, 7, 9];

type Feedback =
  | { kind: "correct"; cell: Cell; unlockedCell?: Cell }
  | { kind: "wrong"; clicked: Cell; reveal: Cell };

type SavedState = {
  settings: Settings;
  mistakes: Record<string, number>;
  bestStreak: number;
  unlocked: string[];
  hitCounts: Record<string, number>;
};

function loadSavedState(): SavedState {
  const fallback: SavedState = {
    settings: DEFAULT_SETTINGS,
    mistakes: {},
    bestStreak: 0,
    unlocked: [],
    hitCounts: {},
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    if (!settings.enabledStrings.some(Boolean))
      settings.enabledStrings = DEFAULT_SETTINGS.enabledStrings;
    if (settings.mode !== "incremental") settings.mode = "free";
    if (settings.unlockOrder !== "nut") settings.unlockOrder = "random";
    return {
      settings,
      mistakes: parsed.mistakes ?? {},
      bestStreak: parsed.bestStreak ?? 0,
      unlocked: parsed.unlocked ?? [],
      hitCounts: parsed.hitCounts ?? {},
    };
  } catch {
    return fallback;
  }
}

const initialState = loadSavedState();
const initialUnlocked = withSeeds(initialState.settings, initialState.unlocked);

function makeWeight(
  settings: Settings,
  mistakes: Record<string, number>,
  hitCounts: Record<string, number>,
) {
  return (cell: Cell) => {
    const key = cellKey(cell);
    const base = 1 + 6 * (mistakes[key] ?? 0);
    if (settings.mode !== "incremental") return base;
    return base + Math.max(0, settings.unlockStreak - (hitCounts[key] ?? 0));
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

function noteName(cell: Cell) {
  const pitchClass = pitchClassAt(cell);
  return isNaturalPitch(pitchClass)
    ? PITCH_NAMES[pitchClass]
    : `${PITCH_NAMES[pitchClass]}/${FLAT_NAMES[pitchClass]}`;
}

const Screws = () => (
  <>
    <i className="screw tl" />
    <i className="screw tr" />
    <i className="screw bl" />
    <i className="screw br" />
  </>
);

type FretboardProps = {
  settings: Settings;
  targetString: number | null;
  feedback: Feedback | null;
  activeKeys: Set<string> | null;
  masteredKeys: Set<string> | null;
  onCellClick: (cell: Cell) => void;
};

function Fretboard({
  settings,
  targetString,
  feedback,
  activeKeys,
  masteredKeys,
  onCellClick,
}: FretboardProps) {
  const frets = Array.from({ length: settings.fretCount }, (_, i) => i + 1);
  const columnFrets = settings.leftHanded
    ? [...frets].reverse().concat(0)
    : [0, ...frets];
  const rowStrings = GUITAR_STRINGS.map((_, stringIndex) => stringIndex);
  if (settings.reverseStrings) rowStrings.reverse();
  const gridTemplateColumns = columnFrets
    .map((fret) => (fret === 0 ? "64px" : `${fretFraction(fret).toFixed(4)}fr`))
    .join(" ");

  const markerFor = (cell: Cell) => {
    if (!feedback) return null;
    if (feedback.kind === "correct" && sameCell(cell, feedback.cell)) {
      return { state: "correct", label: PITCH_NAMES[pitchClassAt(cell)] };
    }
    if (
      feedback.kind === "correct" &&
      feedback.unlockedCell &&
      sameCell(cell, feedback.unlockedCell)
    ) {
      return { state: "reveal", label: PITCH_NAMES[pitchClassAt(cell)] };
    }
    if (feedback.kind === "wrong" && sameCell(cell, feedback.clicked)) {
      return { state: "wrong", label: PITCH_NAMES[pitchClassAt(cell)] };
    }
    if (feedback.kind === "wrong" && sameCell(cell, feedback.reveal)) {
      return { state: "reveal", label: PITCH_NAMES[pitchClassAt(cell)] };
    }
    return null;
  };

  return (
    <div className="board" data-lefty={settings.leftHanded || undefined}>
      <div className="string-labels">
        {rowStrings.map((stringIndex) => (
          <span
            key={stringIndex}
            className={stringIndex === targetString ? "active" : undefined}
          >
            {GUITAR_STRINGS[stringIndex].label}
          </span>
        ))}
      </div>
      <div className="neck">
        <div className="wood" style={{ gridTemplateColumns }}>
          {rowStrings.map((stringIndex) =>
            columnFrets.map((fret) => {
              const string = GUITAR_STRINGS[stringIndex];
              const cell = { stringIndex, fret };
              const key = cellKey(cell);
              const stringOff = !settings.enabledStrings[stringIndex];
              const openOff = fret === 0 && !settings.includeOpenStrings;
              const locked = activeKeys !== null && !activeKeys.has(key);
              const marker = markerFor(cell);
              const classes = [
                "cell",
                fret === 0 ? "open" : "fretted",
                stringIndex === targetString ? "on-target" : "",
                stringOff || openOff || locked ? "off" : "",
                marker?.state ?? "",
              ];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={stringOff || openOff || locked || feedback !== null}
                  onClick={() => onCellClick(cell)}
                  aria-label={`${string.ordinal} string, ${fret === 0 ? "open" : `fret ${fret}`}`}
                  className={classes.filter(Boolean).join(" ")}
                  style={{ "--gauge": `${string.gaugePx}px` } as CSSProperties}
                  data-wound={string.wound || undefined}
                >
                  <span className="marker">{marker?.label}</span>
                  {activeKeys !== null && !locked && !stringOff && !openOff && (
                    <i
                      className={
                        masteredKeys?.has(key) ? "pip mastered" : "pip"
                      }
                    />
                  )}
                </button>
              );
            }),
          )}
          <div className="inlays" style={{ gridTemplateColumns }}>
            {columnFrets.map((fret) => (
              <span key={fret} className="inlay-slot">
                {INLAY_FRETS.includes(fret) && <i className="dot" />}
                {fret === 12 && (
                  <>
                    <i className="dot" />
                    <i className="dot" />
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="fret-numbers" style={{ gridTemplateColumns }}>
          {columnFrets.map((fret) => (
            <span
              key={fret}
              className={
                [...INLAY_FRETS, 12].includes(fret) ? "marked" : undefined
              }
            >
              {fret === 0 ? "open" : fret}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState(initialState.settings);
  const [mistakes, setMistakes] = useState(initialState.mistakes);
  const [bestStreak, setBestStreak] = useState(initialState.bestStreak);
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [hitCounts, setHitCounts] = useState(initialState.hitCounts);
  const [streak, setStreak] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [question, setQuestion] = useState<Cell>(() =>
    pickWeighted(
      activePool(initialState.settings, initialUnlocked),
      makeWeight(
        initialState.settings,
        initialState.mistakes,
        initialState.hitCounts,
      ),
    ),
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const advanceTimer = useRef<number | undefined>(undefined);
  const settingsRef = useRef(settings);
  const unlockedRef = useRef(unlocked);
  const weightRef = useRef(makeWeight(settings, mistakes, hitCounts));
  settingsRef.current = settings;
  unlockedRef.current = unlocked;
  weightRef.current = makeWeight(settings, mistakes, hitCounts);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ settings, mistakes, bestStreak, unlocked, hitCounts }),
    );
  }, [settings, mistakes, bestStreak, unlocked, hitCounts]);

  const candidatePoolKey = JSON.stringify([
    settings.mode,
    settings.fretCount,
    settings.enabledStrings,
    settings.naturalsOnly,
    settings.includeOpenStrings,
  ]);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.clearTimeout(advanceTimer.current);
    setFeedback(null);
    const seeded = withSeeds(settingsRef.current, unlockedRef.current);
    if (seeded !== unlockedRef.current) setUnlocked(seeded);
    const pool = activePool(settingsRef.current, seeded);
    setQuestion((previous) =>
      pickWeighted(pool, weightRef.current, cellKey(previous)),
    );
  }, [candidatePoolKey]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  function nextQuestion() {
    setFeedback(null);
    const pool = activePool(settingsRef.current, unlockedRef.current);
    setQuestion((previous) =>
      pickWeighted(pool, weightRef.current, cellKey(previous)),
    );
  }

  function handleCellClick(cell: Cell) {
    if (feedback) return;
    const target = question;
    const incremental = settings.mode === "incremental";
    const isCorrect = incremental
      ? pitchClassAt(cell) === pitchClassAt(target)
      : cell.stringIndex === target.stringIndex &&
        pitchClassAt(cell) === pitchClassAt(target);
    setAnsweredCount((count) => count + 1);
    if (settings.soundEnabled) playPluck(midiAt(cell));
    if (isCorrect) {
      setCorrectCount((count) => count + 1);
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((best) => Math.max(best, nextStreak));
      setMistakes((current) => {
        const key = cellKey(incremental ? cell : target);
        if (!current[key]) return current;
        const next = { ...current, [key]: current[key] - 1 };
        if (!next[key]) delete next[key];
        return next;
      });
      let unlockedCell: Cell | undefined;
      if (incremental) {
        const pitch = pitchClassAt(cell);
        const pool = activePool(settings, unlocked);
        const nextHits = { ...hitCounts };
        pool
          .filter((poolCell) => pitchClassAt(poolCell) === pitch)
          .forEach((poolCell) => {
            const key = cellKey(poolCell);
            nextHits[key] = (nextHits[key] ?? 0) + 1;
          });
        setHitCounts(nextHits);
        const allMastered = pool.every(
          (poolCell) =>
            (nextHits[cellKey(poolCell)] ?? 0) >= settings.unlockStreak,
        );
        if (allMastered) {
          const fresh = pickUnlockCell(
            buildCandidates(settings),
            unlocked,
            settings.unlockOrder,
          );
          if (fresh) {
            setUnlocked([...unlocked, cellKey(fresh)]);
            unlockedCell = fresh;
          }
        }
      }
      setFeedback({ kind: "correct", cell, unlockedCell });
      advanceTimer.current = window.setTimeout(
        nextQuestion,
        unlockedCell ? 1700 : 1000,
      );
    } else {
      if (settings.soundEnabled) playPluck(midiAt(target), 0.6);
      setStreak(0);
      setMistakes((current) => {
        const key = cellKey(target);
        return { ...current, [key]: Math.min(9, (current[key] ?? 0) + 1) };
      });
      if (incremental) {
        const pitch = pitchClassAt(target);
        const matching = activePool(settings, unlocked).filter(
          (poolCell) => pitchClassAt(poolCell) === pitch,
        );
        setHitCounts((current) => {
          const next = { ...current };
          matching.forEach((poolCell) => delete next[cellKey(poolCell)]);
          return next;
        });
      }
      setFeedback({ kind: "wrong", clicked: cell, reveal: target });
      advanceTimer.current = window.setTimeout(nextQuestion, 2000);
    }
  }

  function updateSettings(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function toggleString(stringIndex: number) {
    const enabledStrings = [...settings.enabledStrings];
    enabledStrings[stringIndex] = !enabledStrings[stringIndex];
    if (enabledStrings.some(Boolean)) updateSettings({ enabledStrings });
  }

  function changeUnlockOrder(unlockOrder: Settings["unlockOrder"]) {
    const next = { ...settings, unlockOrder };
    setSettings(next);
    if (next.mode !== "incremental") return;
    const pool = activePool(settings, unlocked);
    const seedCount = Math.min(3, buildCandidates(settings).length);
    const hasProgress =
      pool.length > seedCount ||
      pool.some((cell) => (hitCounts[cellKey(cell)] ?? 0) > 0);
    if (hasProgress) return;
    window.clearTimeout(advanceTimer.current);
    setFeedback(null);
    const seeded = withSeeds(next, []);
    setUnlocked(seeded);
    setQuestion(
      pickWeighted(
        activePool(next, seeded),
        makeWeight(next, mistakes, hitCounts),
      ),
    );
  }

  function resetApp() {
    if (
      !window.confirm(
        "Reset everything? Streaks, stats, unlocked notes, and settings all go back to defaults.",
      )
    )
      return;
    window.clearTimeout(advanceTimer.current);
    localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULT_SETTINGS);
    setMistakes({});
    setBestStreak(0);
    setUnlocked([]);
    setHitCounts({});
    setStreak(0);
    setAnsweredCount(0);
    setCorrectCount(0);
    setFeedback(null);
    setQuestion(pickWeighted(buildCandidates(DEFAULT_SETTINGS), () => 1));
  }

  const incremental = settings.mode === "incremental";
  const universe = buildCandidates(settings);
  const pool = activePool(settings, unlocked);
  const activeKeys = incremental ? new Set(pool.map(cellKey)) : null;
  const masteredCells = incremental
    ? pool.filter(
        (cell) => (hitCounts[cellKey(cell)] ?? 0) >= settings.unlockStreak,
      )
    : [];
  const masteredKeys = incremental ? new Set(masteredCells.map(cellKey)) : null;

  const questionString = GUITAR_STRINGS[question.stringIndex];
  const questionPitch = pitchClassAt(question);
  const accuracy = answeredCount
    ? `${Math.round((100 * correctCount) / answeredCount)}%`
    : "—";

  const statusMessage = !feedback
    ? incremental
      ? `Find ${noteName(question)} on any unlocked spot.`
      : `Click where ${noteName(question)} lives on the ${questionString.label} string.`
    : feedback.kind === "correct"
      ? feedback.unlockedCell
        ? `All notes at streak ${settings.unlockStreak} — new note unlocked!`
        : PRAISE[correctCount % PRAISE.length]
      : `That was ${noteName(feedback.clicked)} — ${noteName(question)} glows amber.`;

  const troubleSpots = Object.entries(mistakes)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <span className="brand-title">
            Note<em>Compass</em>
          </span>
          <span className="brand-sub">guitar fretboard trainer</span>
        </div>
        <div className="scoreboard">
          <div className="stat">
            <span className="stat-label">streak</span>
            <span key={`s${streak}`} className="stat-value streak-value">
              {pad(streak)}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">best</span>
            <span className="stat-value">{pad(bestStreak)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">accuracy</span>
            <span className="stat-value">{accuracy}</span>
          </div>
        </div>
      </header>

      <section className={`prompt-card ${feedback?.kind ?? ""}`}>
        <Screws />
        <div className="prompt-find">
          <span className="prompt-eyebrow">find</span>
          <span className="prompt-note">
            {PITCH_NAMES[questionPitch]}
            {!isNaturalPitch(questionPitch) && (
              <span className="prompt-flat">{FLAT_NAMES[questionPitch]}</span>
            )}
          </span>
        </div>
        {incremental ? (
          <div className="prompt-where">
            <span>notes in play</span>
            <strong>
              {pool.length}
              <span className="of"> of {universe.length}</span>
            </strong>
            <div className="unlock-bar">
              <i
                style={{
                  width: `${pool.length ? (100 * masteredCells.length) / pool.length : 0}%`,
                }}
              />
            </div>
            <span className="unlock-caption">
              {masteredCells.length}/{pool.length} at streak{" "}
              {settings.unlockStreak}
            </span>
          </div>
        ) : (
          <div className="prompt-where">
            <span>on the</span>
            <strong>
              {questionString.ordinal} string
              <span className="prompt-string-chip">{questionString.label}</span>
            </strong>
          </div>
        )}
        <div className="prompt-status">
          <span className={`led ${feedback?.kind ?? "idle"}`} />
          <p key={answeredCount}>{statusMessage}</p>
        </div>
      </section>

      <section className="board-scroll">
        <Fretboard
          settings={settings}
          targetString={incremental ? null : question.stringIndex}
          feedback={feedback}
          activeKeys={activeKeys}
          masteredKeys={masteredKeys}
          onCellClick={handleCellClick}
        />
      </section>

      <div className="lower">
        <section className="controls">
          <Screws />
          <h2>Difficulty</h2>
          <div className="control-grid">
            <div className="control">
              <span className="control-label">Mode</span>
              <div className="segmented">
                <button
                  type="button"
                  className={!incremental ? "on" : undefined}
                  onClick={() => updateSettings({ mode: "free" })}
                >
                  Free
                </button>
                <button
                  type="button"
                  className={incremental ? "on" : undefined}
                  onClick={() => updateSettings({ mode: "incremental" })}
                >
                  Incremental
                </button>
              </div>
            </div>
            <div className={`control ${incremental ? "" : "disabled"}`}>
              <span className="control-label">
                Unlock streak <b>{settings.unlockStreak}</b>
              </span>
              <input
                type="range"
                min={3}
                max={15}
                disabled={!incremental}
                value={settings.unlockStreak}
                onChange={(event) =>
                  updateSettings({ unlockStreak: Number(event.target.value) })
                }
              />
            </div>
            <div className={`control ${incremental ? "" : "disabled"}`}>
              <span className="control-label">Unlock order</span>
              <div className="segmented">
                <button
                  type="button"
                  className={
                    settings.unlockOrder === "random" ? "on" : undefined
                  }
                  onClick={() => changeUnlockOrder("random")}
                >
                  Random
                </button>
                <button
                  type="button"
                  className={settings.unlockOrder === "nut" ? "on" : undefined}
                  onClick={() => changeUnlockOrder("nut")}
                >
                  From nut
                </button>
              </div>
            </div>
            <div className="control">
              <span className="control-label">
                Frets <b>{settings.fretCount}</b>
              </span>
              <input
                type="range"
                min={3}
                max={12}
                value={settings.fretCount}
                onChange={(event) =>
                  updateSettings({ fretCount: Number(event.target.value) })
                }
              />
            </div>
            <div className="control">
              <span className="control-label">Strings</span>
              <div className="string-toggles">
                {[5, 4, 3, 2, 1, 0].map((stringIndex) => (
                  <button
                    key={stringIndex}
                    type="button"
                    className={
                      settings.enabledStrings[stringIndex] ? "on" : undefined
                    }
                    onClick={() => toggleString(stringIndex)}
                    aria-pressed={settings.enabledStrings[stringIndex]}
                  >
                    {GUITAR_STRINGS[stringIndex].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="control">
              <span className="control-label">Hand</span>
              <div className="segmented">
                <button
                  type="button"
                  className={!settings.leftHanded ? "on" : undefined}
                  onClick={() => updateSettings({ leftHanded: false })}
                >
                  Right
                </button>
                <button
                  type="button"
                  className={settings.leftHanded ? "on" : undefined}
                  onClick={() => updateSettings({ leftHanded: true })}
                >
                  Left
                </button>
              </div>
            </div>
            <div className="control">
              <span className="control-label">Notes</span>
              <div className="segmented">
                <button
                  type="button"
                  className={settings.naturalsOnly ? "on" : undefined}
                  onClick={() => updateSettings({ naturalsOnly: true })}
                >
                  Naturals
                </button>
                <button
                  type="button"
                  className={!settings.naturalsOnly ? "on" : undefined}
                  onClick={() => updateSettings({ naturalsOnly: false })}
                >
                  All 12
                </button>
              </div>
            </div>
            <div className="control switches">
              <button
                type="button"
                role="switch"
                aria-checked={settings.includeOpenStrings}
                className={`switch-row ${settings.includeOpenStrings ? "on" : ""}`}
                onClick={() =>
                  updateSettings({
                    includeOpenStrings: !settings.includeOpenStrings,
                  })
                }
              >
                <span>Open strings</span>
                <i className="switch" />
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={settings.reverseStrings}
                className={`switch-row ${settings.reverseStrings ? "on" : ""}`}
                onClick={() =>
                  updateSettings({ reverseStrings: !settings.reverseStrings })
                }
              >
                <span>Low E on top</span>
                <i className="switch" />
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={settings.soundEnabled}
                className={`switch-row ${settings.soundEnabled ? "on" : ""}`}
                onClick={() =>
                  updateSettings({ soundEnabled: !settings.soundEnabled })
                }
              >
                <span>Sound</span>
                <i className="switch" />
              </button>
            </div>
          </div>
          <div className="controls-footer">
            <button type="button" className="reset-app" onClick={resetApp}>
              Reset app
            </button>
            <span>Clears streaks, stats, unlocked notes & settings</span>
          </div>
        </section>

        <section className="trouble">
          <div className="trouble-head">
            <h2>Trouble spots</h2>
            {troubleSpots.length > 0 && (
              <button type="button" onClick={() => setMistakes({})}>
                clear
              </button>
            )}
          </div>
          <p className="trouble-hint">
            Missed notes come back more often until you win them back.
          </p>
          {troubleSpots.length === 0 ? (
            <p className="trouble-empty">
              Nothing yet — misses land here for extra reps.
            </p>
          ) : (
            <ul>
              {troubleSpots.map(([key, count]) => {
                const cell = parseCellKey(key);
                const string = GUITAR_STRINGS[cell.stringIndex];
                return (
                  <li key={key}>
                    <span className="trouble-note">{noteName(cell)}</span>
                    <span className="trouble-pos">
                      {string.ordinal} string ({string.label}) ·{" "}
                      {cell.fret === 0 ? "open" : `fret ${cell.fret}`}
                    </span>
                    <span className="trouble-count">×{count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
