import { useReducer } from "react";
import type { ResolvedDeck } from "../schemas/deck.js";
import type { GameMode, RunState } from "../engine/types.js";
import { defaultConfig } from "../engine/types.js";
import {
  startRun,
  startRunSeeded,
  startRunDrawFive,
  startRunDrawFiveSeeded,
  placeTile,
  discardTile,
  saveTile,
  playSavedTile,
  playFromHand as enginePlayFromHand,
  rerollHand as engineRerollHand,
  getLegalPlacements,
} from "../engine/placementEngine.js";
import { PlacementError } from "../engine/types.js";

export type DragSource =
  | { kind: "pending" }
  | { kind: "saved"; savedTileId: string }
  | { kind: "hand"; handTileId: string };

type Action =
  | { type: "INIT"; deck: ResolvedDeck; mode: GameMode; seed?: number }
  | { type: "PLACE"; connectionPointId: string | null }
  | { type: "DISCARD" }
  | { type: "SAVE" }
  | { type: "PLAY_SAVED"; savedTileId: string; connectionPointId: string | null }
  | { type: "PLAY_FROM_HAND"; handTileId: string; connectionPointId: string | null }
  | { type: "REROLL" }
  | { type: "RESET" };

function reducer(state: RunState | null, action: Action): RunState | null {
  if (action.type === "RESET") return null;
  if (action.type === "INIT") {
    if (action.seed !== undefined) {
      return action.mode === "draw-five"
        ? startRunDrawFiveSeeded(action.deck, defaultConfig, action.seed)
        : startRunSeeded(action.deck, defaultConfig, action.seed);
    }
    return action.mode === "draw-five"
      ? startRunDrawFive(action.deck, defaultConfig)
      : startRun(action.deck, defaultConfig);
  }
  if (!state) return null;

  try {
    switch (action.type) {
      case "PLACE":
        if (!state.pendingTile) return state;
        return placeTile(state, state.pendingTile, action.connectionPointId);
      case "DISCARD":
        if (!state.pendingTile) return state;
        return discardTile(state, state.pendingTile);
      case "SAVE":
        if (!state.pendingTile) return state;
        return saveTile(state, state.pendingTile);
      case "PLAY_SAVED":
        return playSavedTile(state, action.savedTileId, action.connectionPointId);
      case "PLAY_FROM_HAND":
        return enginePlayFromHand(state, action.handTileId, action.connectionPointId);
      case "REROLL":
        return engineRerollHand(state);
    }
  } catch (e) {
    if (e instanceof PlacementError) return state;
    throw e;
  }
}

export function useRunState(deck: ResolvedDeck | null) {
  const [state, dispatch] = useReducer(reducer, null);

  function init(d: ResolvedDeck, mode: GameMode = "save-discard", seed?: number) {
    if (seed !== undefined) {
      dispatch({ type: "INIT", deck: d, mode, seed });
    } else {
      dispatch({ type: "INIT", deck: d, mode });
    }
  }

  function reset() {
    dispatch({ type: "RESET" });
  }

  function place(connectionPointId: string | null) {
    dispatch({ type: "PLACE", connectionPointId });
  }

  function discard() {
    dispatch({ type: "DISCARD" });
  }

  function save() {
    dispatch({ type: "SAVE" });
  }

  function playSaved(savedTileId: string, connectionPointId: string | null) {
    dispatch({ type: "PLAY_SAVED", savedTileId, connectionPointId });
  }

  function playFromHand(handTileId: string, connectionPointId: string | null) {
    dispatch({ type: "PLAY_FROM_HAND", handTileId, connectionPointId });
  }

  function reroll() {
    dispatch({ type: "REROLL" });
  }

  function getLegalPointIds(source: DragSource): Set<string> {
    if (!state) return new Set();
    if (source.kind === "pending") {
      if (!state.pendingTile) return new Set();
      return new Set(getLegalPlacements(state, state.pendingTile).map((p) => p.id));
    }
    if (source.kind === "saved") {
      const saved = state.savedTiles.find((s) => s.id === source.savedTileId);
      if (!saved) return new Set();
      return new Set(getLegalPlacements(state, saved.domino).map((p) => p.id));
    }
    // hand
    const tile = (state.hand ?? []).find((t) => t.id === source.handTileId);
    if (!tile) return new Set();
    return new Set(getLegalPlacements(state, tile).map((p) => p.id));
  }

  return { state, init, reset, place, discard, save, playSaved, playFromHand, reroll, getLegalPointIds };
}
