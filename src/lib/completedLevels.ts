const KEY = "pipstream_level_stars";
const SCORES_KEY = "pipstream_level_scores";

// Star thresholds as fractions of the nearOptimal ceiling.
const STAR_THRESHOLDS = [0.6, 0.8, 1.0] as const;

function loadStars(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export function getLevelStars(levelId: string): number {
  return loadStars()[levelId] ?? 0;
}

export function getAllLevelStars(): Record<string, number> {
  return loadStars();
}

export function saveLevelStars(levelId: string, stars: number): void {
  const existing = loadStars();
  if ((existing[levelId] ?? 0) >= stars) return;
  existing[levelId] = stars;
  try {
    localStorage.setItem(KEY, JSON.stringify(existing));
  } catch {
    // ignore quota errors
  }
}

function loadScores(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export function saveLevelScore(levelId: string, score: number): void {
  const existing = loadScores();
  if ((existing[levelId] ?? -1) >= score) return;
  existing[levelId] = score;
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(existing));
  } catch {
    // ignore quota errors
  }
}

export function getAllLevelScores(): Record<string, number> {
  return loadScores();
}

export function computeStars(score: number, nearOptimal: number): number {
  for (let i = STAR_THRESHOLDS.length - 1; i >= 0; i--) {
    const threshold = STAR_THRESHOLDS[i];
    if (threshold !== undefined && score >= Math.round(nearOptimal * threshold)) return i + 1;
  }
  return 0;
}

export function starThreshold(nearOptimal: number, stars: 1 | 2 | 3): number {
  const t = STAR_THRESHOLDS[stars - 1];
  return Math.round(nearOptimal * (t ?? 1));
}
