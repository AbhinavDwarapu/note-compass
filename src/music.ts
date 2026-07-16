export const PITCH_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
] as const;
export const FLAT_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "G♭",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
] as const;

export type Cell = { stringIndex: number; fret: number };

export type Settings = {
  mode: "free" | "incremental" | "guided";
  unlockStreak: number;
  unlockOrder: "random" | "nut";
  fretCount: number;
  enabledStrings: boolean[];
  leftHanded: boolean;
  reverseStrings: boolean;
  naturalsOnly: boolean;
  includeOpenStrings: boolean;
  soundEnabled: boolean;
};

export type StringSpec = {
  label: string;
  ordinal: string;
  openMidi: number;
  gaugePx: number;
  wound: boolean;
};

export const GUITAR_STRINGS: StringSpec[] = [
  { label: "e", ordinal: "1st", openMidi: 64, gaugePx: 1.2, wound: false },
  { label: "B", ordinal: "2nd", openMidi: 59, gaugePx: 1.5, wound: false },
  { label: "G", ordinal: "3rd", openMidi: 55, gaugePx: 1.9, wound: false },
  { label: "D", ordinal: "4th", openMidi: 50, gaugePx: 2.4, wound: true },
  { label: "A", ordinal: "5th", openMidi: 45, gaugePx: 3, wound: true },
  { label: "E", ordinal: "6th", openMidi: 40, gaugePx: 3.6, wound: true },
];

export const midiAt = (cell: Cell) =>
  GUITAR_STRINGS[cell.stringIndex].openMidi + cell.fret;

export const pitchClassAt = (cell: Cell) => midiAt(cell) % 12;

export const isNaturalPitch = (pitchClass: number) =>
  !PITCH_NAMES[pitchClass].includes("♯");

export const cellKey = (cell: Cell) => `${cell.stringIndex}:${cell.fret}`;

export const parseCellKey = (key: string): Cell => {
  const [stringIndex, fret] = key.split(":").map(Number);
  return { stringIndex, fret };
};

export const sameCell = (a: Cell, b: Cell) =>
  a.stringIndex === b.stringIndex && a.fret === b.fret;

export const fretFraction = (fret: number) =>
  (2 ** (-(fret - 1) / 12) - 2 ** (-fret / 12)) / (1 - 2 ** (-1 / 12));

export function buildCandidates(settings: Settings): Cell[] {
  const cells: Cell[] = [];
  const lowestFret = settings.includeOpenStrings ? 0 : 1;
  GUITAR_STRINGS.forEach((_, stringIndex) => {
    if (!settings.enabledStrings[stringIndex]) return;
    for (let fret = lowestFret; fret <= settings.fretCount; fret++) {
      if (
        settings.naturalsOnly &&
        !isNaturalPitch(pitchClassAt({ stringIndex, fret }))
      )
        continue;
      cells.push({ stringIndex, fret });
    }
  });
  if (cells.length === 0 && settings.naturalsOnly) {
    return buildCandidates({ ...settings, naturalsOnly: false });
  }
  return cells;
}

export function pickWeighted(
  cells: Cell[],
  weightOf: (cell: Cell) => number,
  avoidKey?: string,
): Cell {
  const pool =
    cells.length > 1
      ? cells.filter((cell) => cellKey(cell) !== avoidKey)
      : cells;
  const weights = pool.map(weightOf);
  let roll =
    Math.random() * weights.reduce((total, weight) => total + weight, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export const GUIDED_STRING_ORDER = [5, 4, 3, 2, 1, 0];
export const GUIDED_START_FRETS = 5;
export const GUIDED_MAX_FRETS = 12;
export const GUIDED_BASE_STREAK = 2;
export const GUIDED_MAX_STREAK = 5;
export const GUIDED_FAST_MS = 3000;
export const GUIDED_GROWTH_ACCURACY = 0.85;
export const GUIDED_RECENT_WINDOW = 10;

export const GUIDED_TOTAL = GUITAR_STRINGS.reduce((total, _, stringIndex) => {
  let count = 0;
  for (let fret = 1; fret <= GUIDED_MAX_FRETS; fret++) {
    if (isNaturalPitch(pitchClassAt({ stringIndex, fret }))) count++;
  }
  return total + count;
}, 0);

export function pickGuidedCell(
  unlockedKeys: string[],
  canGrow = true,
): Cell | null {
  const unlockedSet = new Set(unlockedKeys);
  for (const stringIndex of GUIDED_STRING_ORDER) {
    const locked: Cell[] = [];
    for (let fret = 1; fret <= GUIDED_MAX_FRETS; fret++) {
      const cell = { stringIndex, fret };
      if (!isNaturalPitch(pitchClassAt(cell))) continue;
      if (!unlockedSet.has(cellKey(cell))) locked.push(cell);
    }
    if (locked.length === 0) continue;
    const inWindow = locked.filter((cell) => cell.fret <= GUIDED_START_FRETS);
    if (inWindow.length > 0)
      return inWindow[Math.floor(Math.random() * inWindow.length)];
    return canGrow ? locked[0] : null;
  }
  return null;
}

export function requiredStreak(
  settings: Settings,
  mistakes: Record<string, number>,
  key: string,
): number {
  if (settings.mode !== "guided") return settings.unlockStreak;
  return Math.min(GUIDED_MAX_STREAK, GUIDED_BASE_STREAK + (mistakes[key] ?? 0));
}

export function effectiveSettings(
  settings: Settings,
  unlockedKeys: string[],
): Settings {
  if (settings.mode !== "guided") return settings;
  const cells = unlockedKeys.map(parseCellKey);
  const enabledStrings = GUITAR_STRINGS.map((_, stringIndex) =>
    cells.some((cell) => cell.stringIndex === stringIndex),
  );
  if (!enabledStrings.some(Boolean))
    enabledStrings[GUIDED_STRING_ORDER[0]] = true;
  return {
    ...settings,
    fretCount: GUIDED_MAX_FRETS,
    enabledStrings,
    naturalsOnly: true,
    includeOpenStrings: false,
  };
}

export function activePool(settings: Settings, unlockedKeys: string[]): Cell[] {
  const universe = buildCandidates(effectiveSettings(settings, unlockedKeys));
  if (settings.mode === "free") return universe;
  const unlockedSet = new Set(unlockedKeys);
  return universe.filter((cell) => unlockedSet.has(cellKey(cell)));
}

export function pickUnlockCell(
  universe: Cell[],
  unlockedKeys: string[],
  order: Settings["unlockOrder"],
): Cell | null {
  const unlockedSet = new Set(unlockedKeys);
  const locked = universe.filter((cell) => !unlockedSet.has(cellKey(cell)));
  if (locked.length === 0) return null;
  if (order === "nut") {
    const frontierByString = new Map<number, Cell>();
    locked.forEach((cell) => {
      const current = frontierByString.get(cell.stringIndex);
      if (!current || cell.fret < current.fret)
        frontierByString.set(cell.stringIndex, cell);
    });
    const frontier = [...frontierByString.values()];
    return frontier[Math.floor(Math.random() * frontier.length)];
  }
  const unlockedPitches = new Set(
    universe.filter((cell) => unlockedSet.has(cellKey(cell))).map(pitchClassAt),
  );
  const freshPitches = locked.filter(
    (cell) => !unlockedPitches.has(pitchClassAt(cell)),
  );
  const pool = freshPitches.length > 0 ? freshPitches : locked;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const SEED_COUNT = 3;

export function withSeeds(
  settings: Settings,
  unlockedKeys: string[],
): string[] {
  if (settings.mode === "free") return unlockedKeys;
  const universe = buildCandidates(effectiveSettings(settings, unlockedKeys));
  const targetCount = Math.min(SEED_COUNT, universe.length);
  let seeded = unlockedKeys;
  while (activePool(settings, seeded).length < targetCount) {
    const fresh =
      settings.mode === "guided"
        ? pickGuidedCell(seeded)
        : pickUnlockCell(
            buildCandidates(settings),
            seeded,
            settings.unlockOrder,
          );
    if (!fresh) break;
    seeded = [...seeded, cellKey(fresh)];
  }
  return seeded;
}
