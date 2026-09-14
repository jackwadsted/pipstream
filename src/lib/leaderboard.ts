import type { GameMode } from "../engine/types.js";

export interface LeaderboardEntry {
  name: string;
  score: number;
  mode: GameMode;
  date: string; // ISO 8601
  levelId?: string;
  levelName?: string;
}

const KEY = "pipstream_leaderboard";
const MAX_ENTRIES = 100;

export function getLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

export function addEntry(entry: LeaderboardEntry): LeaderboardEntry[] {
  const existing = getLeaderboard();
  const updated = [...existing, entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(updated));
  } catch {
    // Storage quota exceeded — still return the in-memory sorted list
  }
  return updated;
}

export function clearLeaderboard(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
