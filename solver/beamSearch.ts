import type { GameConfig, RunState } from "../src/engine/types.js";
import {
  getLegalPlacements,
  playFromHand,
  rerollHand,
} from "../src/engine/placementEngine.js";
import { computeScore } from "../src/engine/scoring.js";
import type { ResolvedDeck } from "../src/schemas/deck.js";
import { seededShuffle } from "./seededShuffle.js";

export interface SolveOptions {
  beamWidth: number;
  allowRerolls: boolean;
}

// Mirrors startRunDrawFive but uses a deterministic seeded shuffle.
export function buildInitialState(
  deck: ResolvedDeck,
  seed: number,
  config: GameConfig,
): RunState {
  const allTiles = deck.tiles.flatMap(({ domino, quantity }) =>
    Array.from({ length: quantity }, () => domino),
  );
  const shuffled = seededShuffle(allTiles, seed);
  const handSize = config.handSize ?? 5;
  return {
    config,
    mode: "draw-five",
    drawPile: shuffled.slice(handSize),
    discardPile: [],
    savedTiles: [],
    hand: shuffled.slice(0, handSize),
    rerollsUsed: 0,
    pendingTile: null,
    placedNodes: {},
    openConnectionPoints: {},
    discardsUsed: 0,
    savesUsed: 0,
    status: "in-progress",
    doubleTriggerLog: [],
  };
}

type Candidate = { state: RunState; score: number };

function expand(
  state: RunState,
  config: GameConfig,
  allowRerolls: boolean,
): RunState[] {
  const successors: RunState[] = [];
  const hand = state.hand ?? [];
  const isRoot = Object.keys(state.placedNodes).length === 0;

  for (const tile of hand) {
    if (isRoot) {
      try {
        successors.push(playFromHand(state, tile.id, null));
      } catch { /* illegal */ }
    } else {
      for (const point of getLegalPlacements(state, tile)) {
        try {
          successors.push(playFromHand(state, tile.id, point.id));
        } catch { /* illegal */ }
      }
    }
  }

  // Only free rerolls — penalty rerolls discard tiles and almost always reduce score.
  if (allowRerolls) {
    const used = state.rerollsUsed ?? 0;
    const free = config.freeRerolls ?? 3;
    if (used < free) {
      try {
        successors.push(rerollHand(state));
      } catch { /* illegal */ }
    }
  }

  return successors;
}

export function beamSearch(
  initialState: RunState,
  config: GameConfig,
  options: SolveOptions,
): RunState {
  const { beamWidth, allowRerolls } = options;
  let beam: RunState[] = [initialState];
  let bestState: RunState = initialState;
  let bestScore = -Infinity;

  while (beam.length > 0) {
    const candidates: Candidate[] = [];

    for (const state of beam) {
      if (state.status !== "in-progress") {
        const score = computeScore(state, config).totalScore;
        if (score > bestScore) {
          bestScore = score;
          bestState = state;
        }
        continue;
      }

      const nexts = expand(state, config, allowRerolls);

      if (nexts.length === 0) {
        // Stuck with no legal moves — record current score as a result.
        const score = computeScore(state, config).totalScore;
        if (score > bestScore) {
          bestScore = score;
          bestState = state;
        }
        continue;
      }

      for (const next of nexts) {
        candidates.push({ state: next, score: computeScore(next, config).totalScore });
      }
    }

    if (candidates.length === 0) break;

    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, beamWidth).map((c) => c.state);
  }

  return bestState;
}
