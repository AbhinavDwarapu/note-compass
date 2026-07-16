import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  FLAT_NAMES,
  GUITAR_STRINGS,
  PITCH_NAMES,
  activePool,
  buildCandidates,
  cellKey,
  effectiveSettings,
  fretFraction,
  GUIDED_FAST_MS,
  GUIDED_GROWTH_ACCURACY,
  GUIDED_RECENT_WINDOW,
  GUIDED_TOTAL,
  isNaturalPitch,
  makeWeight,
  midiAt,
  parseCellKey,
  pickGuidedCell,
  pickUnlockCell,
  pickWeighted,
  pitchClassAt,
  requiredStreak,
  sameCell,
  SEED_COUNT,
  withSeeds,
} from "./music";
import type { Cell, Settings } from "./music";
import { playPluck } from "./audio";
import "./App.css";

const STORAGE_KEY = "fret-finder-v1";

const DEFAULT_SETTINGS: Settings = {
  mode: "guided",
  unlockStreak: 3,
  unlockOrder: "nut",
  fretCount: 5,
  enabledStrings: [true, true, true, true, true, true],
  leftHanded: false,
  reverseStrings: false,
  naturalsOnly: true,
  includeOpenStrings: false,
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
  | {
      kind: "correct";
      cell: Cell;
      unlockedCell?: Cell;
      slowMs?: number;
      growthBlocked?: boolean;
    }
  | { kind: "wrong"; clicked: Cell; reveal: Cell };

type ProgressStash = {
  mode: "incremental" | "guided";
  unlocked: string[];
  hitCounts: Record<string, number>;
  fresh: string[];
};

type SavedState = {
  settings: Settings;
  mistakes: Record<string, number>;
  bestStreak: number;
  unlocked: string[];
  hitCounts: Record<string, number>;
  fresh: string[];
  progressFor: "incremental" | "guided";
  stash: ProgressStash | null;
};

function loadSavedState(): SavedState {
  const fallback: SavedState = {
    settings: DEFAULT_SETTINGS,
    mistakes: {},
    bestStreak: 0,
    unlocked: [],
    hitCounts: {},
    fresh: [],
    progressFor: "incremental",
    stash: null,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
    if (!settings.enabledStrings.some(Boolean))
      settings.enabledStrings = DEFAULT_SETTINGS.enabledStrings;
    if (settings.mode !== "incremental" && settings.mode !== "guided")
      settings.mode = "free";
    if (settings.unlockOrder !== "nut") settings.unlockOrder = "random";
    return {
      settings,
      mistakes: parsed.mistakes ?? {},
      bestStreak: parsed.bestStreak ?? 0,
      unlocked: parsed.unlocked ?? [],
      hitCounts: parsed.hitCounts ?? {},
      fresh: parsed.fresh ?? [],
      progressFor:
        parsed.progressFor ??
        (settings.mode === "guided" ? "guided" : "incremental"),
      stash: parsed.stash ?? null,
    };
  } catch {
    return fallback;
  }
}

const initialState = loadSavedState();
const initialUnlocked = withSeeds(initialState.settings, initialState.unlocked);
const initialFresh = [
  ...new Set([
    ...initialState.fresh.filter((key) => initialUnlocked.includes(key)),
    ...initialUnlocked.filter((key) => !initialState.unlocked.includes(key)),
  ]),
];

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
  freshKeys: Set<string> | null;
  onCellClick: (cell: Cell) => void;
};

function Fretboard({
  settings,
  targetString,
  feedback,
  activeKeys,
  masteredKeys,
  freshKeys,
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
    if (feedback) {
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
    }
    const key = cellKey(cell);
    if (freshKeys?.has(key) && activeKeys?.has(key)) {
      return { state: "hint", label: PITCH_NAMES[pitchClassAt(cell)] };
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
        <div className="fret-numbers fret-numbers-top" style={{ gridTemplateColumns }}>
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
  const [freshKeys, setFreshKeys] = useState(initialFresh);
  const [progressFor, setProgressFor] = useState(initialState.progressFor);
  const [stash, setStash] = useState(initialState.stash);
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
        {},
        0,
      ),
    ),
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [recentResults, setRecentResults] = useState<boolean[]>([]);
  const [askedAt, setAskedAt] = useState<Record<string, number>>({});
  const [helpOpen, setHelpOpen] = useState(false);

  const advanceTimer = useRef<number | undefined>(undefined);
  const questionShownAt = useRef(performance.now());
  const settingsRef = useRef(settings);
  const unlockedRef = useRef(unlocked);
  const weightRef = useRef(
    makeWeight(settings, mistakes, hitCounts, askedAt, answeredCount),
  );
  settingsRef.current = settings;
  unlockedRef.current = unlocked;
  weightRef.current = makeWeight(
    settings,
    mistakes,
    hitCounts,
    askedAt,
    answeredCount,
  );

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings,
        mistakes,
        bestStreak,
        unlocked,
        hitCounts,
        fresh: freshKeys,
        progressFor,
        stash,
      }),
    );
  }, [
    settings,
    mistakes,
    bestStreak,
    unlocked,
    hitCounts,
    freshKeys,
    progressFor,
    stash,
  ]);

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
    if (seeded !== unlockedRef.current) {
      const added = seeded.filter((key) => !unlockedRef.current.includes(key));
      setUnlocked(seeded);
      setFreshKeys((current) => [...new Set([...current, ...added])]);
    }
    const pool = activePool(settingsRef.current, seeded);
    setQuestion((previous) =>
      pickWeighted(pool, weightRef.current, cellKey(previous)),
    );
  }, [candidatePoolKey]);

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  useEffect(() => {
    questionShownAt.current = performance.now();
  }, [question]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

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
    const progressive = settings.mode !== "free";
    if (progressive)
      setFreshKeys((current) => current.filter((key) => key !== cellKey(cell)));
    const isCorrect =
      cell.stringIndex === target.stringIndex &&
      pitchClassAt(cell) === pitchClassAt(target);
    const elapsedMs = performance.now() - questionShownAt.current;
    const slow = settings.mode === "guided" && elapsedMs > GUIDED_FAST_MS;
    const results =
      settings.mode === "guided"
        ? [...recentResults, isCorrect].slice(-GUIDED_RECENT_WINDOW)
        : recentResults;
    if (settings.mode === "guided") {
      setRecentResults(results);
      const stamp = answeredCount + 1;
      setAskedAt((current) => ({
        ...current,
        [cellKey(cell)]: stamp,
        [cellKey(target)]: stamp,
      }));
    }
    const recentAccuracy = results.length
      ? results.filter(Boolean).length / results.length
      : 1;
    setAnsweredCount((count) => count + 1);
    if (settings.soundEnabled) playPluck(midiAt(cell));
    if (isCorrect) {
      setCorrectCount((count) => count + 1);
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((best) => Math.max(best, nextStreak));
      setMistakes((current) => {
        const key = cellKey(target);
        if (!current[key]) return current;
        const next = { ...current, [key]: current[key] - 1 };
        if (!next[key]) delete next[key];
        return next;
      });
      let unlockedCell: Cell | undefined;
      let growthBlocked = false;
      if (progressive && !slow) {
        const pool = activePool(settings, unlocked);
        const key = cellKey(target);
        const nextHits = { ...hitCounts, [key]: (hitCounts[key] ?? 0) + 1 };
        setHitCounts(nextHits);
        const allMastered = pool.every(
          (poolCell) =>
            (nextHits[cellKey(poolCell)] ?? 0) >=
            requiredStreak(settings, mistakes, cellKey(poolCell)),
        );
        if (allMastered) {
          const canGrow = recentAccuracy >= GUIDED_GROWTH_ACCURACY;
          const fresh =
            settings.mode === "guided"
              ? pickGuidedCell(unlocked, canGrow)
              : pickUnlockCell(
                  buildCandidates(settings),
                  unlocked,
                  settings.unlockOrder,
                );
          if (fresh) {
            setUnlocked([...unlocked, cellKey(fresh)]);
            setFreshKeys((current) => [...current, cellKey(fresh)]);
            unlockedCell = fresh;
          } else if (
            settings.mode === "guided" &&
            !canGrow &&
            pickGuidedCell(unlocked) !== null
          ) {
            growthBlocked = true;
          }
        }
      }
      setFeedback({
        kind: "correct",
        cell,
        unlockedCell,
        slowMs: slow ? elapsedMs : undefined,
        growthBlocked: growthBlocked || undefined,
      });
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
      if (progressive) {
        const key = cellKey(target);
        setHitCounts((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
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

  function changeMode(mode: Settings["mode"]) {
    if (mode === settings.mode) return;
    updateSettings({ mode });
    if (mode === "free" || mode === progressFor) return;
    setStash({ mode: progressFor, unlocked, hitCounts, fresh: freshKeys });
    const restored =
      stash?.mode === mode ? stash : { unlocked: [], hitCounts: {}, fresh: [] };
    setUnlocked(restored.unlocked);
    setHitCounts(restored.hitCounts);
    setFreshKeys(restored.fresh);
    setRecentResults([]);
    setAskedAt({});
    setProgressFor(mode);
  }

  function changeUnlockOrder(unlockOrder: Settings["unlockOrder"]) {
    const next = { ...settings, unlockOrder };
    setSettings(next);
    if (next.mode !== "incremental") return;
    const pool = activePool(settings, unlocked);
    const seedCount = Math.min(SEED_COUNT, buildCandidates(settings).length);
    const hasProgress =
      pool.length > seedCount ||
      pool.some((cell) => (hitCounts[cellKey(cell)] ?? 0) > 0);
    if (hasProgress) return;
    window.clearTimeout(advanceTimer.current);
    setFeedback(null);
    const seeded = withSeeds(next, []);
    setUnlocked(seeded);
    setFreshKeys(seeded);
    setQuestion(
      pickWeighted(
        activePool(next, seeded),
        makeWeight(next, mistakes, hitCounts, askedAt, answeredCount),
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
    const seeded = withSeeds(DEFAULT_SETTINGS, []);
    setSettings(DEFAULT_SETTINGS);
    setMistakes({});
    setBestStreak(0);
    setUnlocked(seeded);
    setFreshKeys(seeded);
    setHitCounts({});
    setProgressFor("incremental");
    setStash(null);
    setRecentResults([]);
    setAskedAt({});
    setStreak(0);
    setAnsweredCount(0);
    setCorrectCount(0);
    setFeedback(null);
    setQuestion(pickWeighted(activePool(DEFAULT_SETTINGS, seeded), () => 1));
  }

  const progressive = settings.mode !== "free";
  const guided = settings.mode === "guided";
  const universeCount = guided
    ? GUIDED_TOTAL
    : buildCandidates(settings).length;
  const pool = activePool(settings, unlocked);
  const activeKeys = progressive ? new Set(pool.map(cellKey)) : null;
  const masteredCells = progressive
    ? pool.filter(
        (cell) =>
          (hitCounts[cellKey(cell)] ?? 0) >=
          requiredStreak(settings, mistakes, cellKey(cell)),
      )
    : [];
  const masteredKeys = progressive ? new Set(masteredCells.map(cellKey)) : null;

  const questionString = GUITAR_STRINGS[question.stringIndex];
  const questionPitch = pitchClassAt(question);
  const accuracy = answeredCount
    ? `${Math.round((100 * correctCount) / answeredCount)}%`
    : "—";

  const statusMessage = !feedback
    ? `Click where ${noteName(question)} lives on the ${questionString.label} string.`
    : feedback.kind === "correct"
      ? feedback.unlockedCell
        ? guided
          ? "Every note mastered — new note unlocked!"
          : `All notes at streak ${settings.unlockStreak} — new note unlocked!`
        : feedback.growthBlocked
          ? `Every note mastered — recent accuracy ${Math.round(GUIDED_GROWTH_ACCURACY * 100)}%+ grows the board.`
          : feedback.slowMs
            ? `Right — but ${(feedback.slowMs / 1000).toFixed(1)}s. Under ${GUIDED_FAST_MS / 1000}s builds mastery.`
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
        <div className="masthead-right">
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
          <button
            type="button"
            className="help-btn"
            aria-label="Help"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
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
        <div className="prompt-where">
          <span>on the</span>
          <strong>
            {questionString.ordinal} string
            <span className="prompt-string-chip">{questionString.label}</span>
          </strong>
          {progressive && (
            <>
              <span className="prompt-where-count">
                {pool.length}
                <span className="of"> of {universeCount} in play</span>
              </span>
              <div className="unlock-bar">
                <i
                  style={{
                    width: `${pool.length ? (100 * masteredCells.length) / pool.length : 0}%`,
                  }}
                />
              </div>
              <span className="unlock-caption">
                {guided
                  ? `${masteredCells.length}/${pool.length} mastered · recent ${Math.round(
                      (recentResults.length
                        ? recentResults.filter(Boolean).length /
                          recentResults.length
                        : 1) * 100,
                    )}%`
                  : `${masteredCells.length}/${pool.length} at streak ${settings.unlockStreak}`}
              </span>
            </>
          )}
        </div>
        <div className="prompt-status">
          <span className={`led ${feedback?.kind ?? "idle"}`} />
          <p key={answeredCount}>{statusMessage}</p>
        </div>
      </section>

      <section className="board-scroll">
        <Fretboard
          settings={effectiveSettings(settings, unlocked)}
          targetString={progressive ? null : question.stringIndex}
          feedback={feedback}
          activeKeys={activeKeys}
          masteredKeys={masteredKeys}
          freshKeys={progressive ? new Set(freshKeys) : null}
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
                  className={settings.mode === "free" ? "on" : undefined}
                  onClick={() => changeMode("free")}
                >
                  Free
                </button>
                <button
                  type="button"
                  className={settings.mode === "incremental" ? "on" : undefined}
                  onClick={() => changeMode("incremental")}
                >
                  Incremental
                </button>
                <button
                  type="button"
                  className={guided ? "on" : undefined}
                  onClick={() => changeMode("guided")}
                >
                  Guided
                </button>
              </div>
            </div>
            <div
              className={`control ${settings.mode === "incremental" ? "" : "disabled"}`}
            >
              <span className="control-label">
                Unlock streak{" "}
                <b>{guided ? "adaptive" : settings.unlockStreak}</b>
              </span>
              <input
                type="range"
                min={3}
                max={15}
                disabled={settings.mode !== "incremental"}
                value={settings.unlockStreak}
                onChange={(event) =>
                  updateSettings({ unlockStreak: Number(event.target.value) })
                }
              />
            </div>
            <div
              className={`control ${settings.mode === "incremental" ? "" : "disabled"}`}
            >
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
            <div className={`control ${guided ? "disabled" : ""}`}>
              <span className="control-label">
                Frets <b>{settings.fretCount}</b>
              </span>
              <input
                type="range"
                min={3}
                max={12}
                disabled={guided}
                value={settings.fretCount}
                onChange={(event) =>
                  updateSettings({ fretCount: Number(event.target.value) })
                }
              />
            </div>
            <div className={`control ${guided ? "disabled" : ""}`}>
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
            <div className={`control ${guided ? "disabled" : ""}`}>
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
                disabled={guided}
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

      {helpOpen && (
        <div className="help-overlay" onClick={() => setHelpOpen(false)}>
          <section
            className="help-panel"
            role="dialog"
            aria-label="Help"
            onClick={(event) => event.stopPropagation()}
          >
            <Screws />
            <div className="help-head">
              <h2>How it works</h2>
              <button type="button" onClick={() => setHelpOpen(false)}>
                close
              </button>
            </div>

            <h3>The game</h3>
            <p>
              The card at the top names a note <em>and</em> a target string —
              click the fret on that string where the note lives (the zone
              behind the nut is the open string). A correct pick flashes green
              and plucks the note; a miss flashes red, shows what you actually
              clicked, pulses the right spot in amber, and plays both so you
              hear the difference.
            </p>

            <h3>Modes</h3>
            <dl>
              <dt>Incremental (default)</dt>
              <dd>
                You start with just {SEED_COUNT} string/fret spots in play —
                everything else is dimmed. Find the prompted note on the string
                shown. Each unlocked spot shows a small dot that turns amber
                once you have hit that exact spot enough times in a row; when
                <em> every</em> spot in play is amber, a new one joins the
                board. Missing resets that spot's progress. The prompt card
                tracks how many spots are in play and how close the next unlock
                is. Brand-new spots show their name right on the board until
                the first time you click them — that's how you meet each one
                before drilling it from memory.
              </dd>
              <dt>Guided</dt>
              <dd>
                A hands-off journey across the natural notes of the whole neck,
                one string at a time. You start with F, G, and A on the low E
                string. As you master what's unlocked, new naturals join from
                the same string, the fret window grows out to fret 12, and once
                a string is complete the next one begins (A, then D, G, B, high
                e). Mastery here is adaptive and tracked per string/fret spot: a
                spot you've never missed only needs a streak of 2, while each
                recorded miss there raises its requirement (up to 5) until you
                win it back. Speed counts too — only answers under 3 seconds
                build mastery, so you're rewarded for recall rather than
                counting up the frets. The board also paces itself: new frets
                beyond the first 5 only unlock while your recent accuracy (last
                10 answers) is 85% or better, so a rough patch means
                consolidating before expanding. And mastered spots don't rust
                quietly — the longer one goes without being asked, the more
                likely it comes back for a spot check. The board and settings
                adjust themselves as you go — only handedness, string order,
                and sound stay in your hands. Guided and Incremental each
                remember their own progress, so you can switch between them
                freely.
              </dd>
              <dt>Free</dt>
              <dd>
                The whole board (within your difficulty settings) is fair game.
                The prompt names a note <em>and</em> a target string — find the
                note on that string.
              </dd>
            </dl>

            <h3>Difficulty controls</h3>
            <dl>
              <dt>Unlock streak</dt>
              <dd>
                How many consecutive correct finds each note needs before a new
                note is added (incremental mode only).
              </dd>
              <dt>Unlock order</dt>
              <dd>
                Where new notes come from in incremental mode.{" "}
                <strong>Random</strong> picks anywhere, preferring notes you
                haven't seen. <strong>From nut</strong> walks outward from the
                nut: each unlock is the next fret on a string you've started, or
                the first fret of a new string.
              </dd>
              <dt>Frets</dt>
              <dd>How much of the neck is in play, from 3 up to 12 frets.</dd>
              <dt>Strings</dt>
              <dd>
                Toggle individual strings on or off to drill one string at a
                time.
              </dd>
              <dt>Hand</dt>
              <dd>
                Left mirrors the whole board — nut on the right — to match a
                left-handed guitar.
              </dd>
              <dt>Notes</dt>
              <dd>
                Naturals keeps it to C D E F G A B; All 12 adds sharps and
                flats.
              </dd>
              <dt>Open strings</dt>
              <dd>Include or exclude the open (unfretted) strings.</dd>
              <dt>Low E on top</dt>
              <dd>
                Flips the string order. Off matches tabs and chord diagrams
                (high e on top); on matches looking down at your own guitar.
              </dd>
              <dt>Sound</dt>
              <dd>Toggles the plucked-note audio feedback.</dd>
            </dl>

            <h3>Scoreboard &amp; trouble spots</h3>
            <p>
              <strong>Streak</strong> counts consecutive correct answers and
              resets on a miss; <strong>best</strong> is your all-time high and
              is remembered between visits; <strong>accuracy</strong> covers the
              current session. Every miss is logged per string and fret in the
              Trouble Spots panel, and those positions come up more often until
              you answer them correctly again.
            </p>

            <h3>Reset</h3>
            <p>
              The Reset app button at the bottom of the Difficulty panel wipes
              everything — streaks, stats, unlocked notes, trouble spots, and
              settings.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
