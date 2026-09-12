import type { Domino } from "../schemas/domino.js";

export type RunStatus =
  | "in-progress"
  | "ended-no-moves"
  | "ended-deck-exhausted";

export type GameMode = "save-discard" | "draw-five";

export type Direction = "left" | "right" | "up" | "down";

export interface ConnectionPoint {
  id: string;
  owningNodeId: string;
  pipValue: number;
  /** Cardinal direction the next tile extends when placed on this point. */
  direction: Direction;
  /** Pixel position of the open end (the tile edge where the next tile touches). */
  position: { x: number; y: number };
}

/**
 * One placed domino in the graph.
 *
 * - `connectedEnd`: which end of this domino matched the parent connection point.
 *   'a' = pips[0], 'b' = pips[1]. null for the root tile (no parent).
 *   For doubles, both ends are equal; 'a' is used by convention.
 * - `openConnectionPointIds`: IDs of ConnectionPoints this node currently owns.
 *   Shrinks as children are attached; empty once all points are consumed.
 * - `position`: pixel center of this tile on the board.
 * - `orientation`: whether the tile's long axis is horizontal or vertical.
 * - `incomingDirection`: direction the tile extends from its parent's connection point.
 *   null for the root tile.
 */
export interface PlacedNode {
  id: string;
  domino: Domino;
  connectedEnd: "a" | "b" | null;
  parentNodeId: string | null;
  openConnectionPointIds: string[];
  position: { x: number; y: number };
  orientation: "horizontal" | "vertical";
  incomingDirection: Direction | null;
}

export interface SavedTile {
  id: string;
  domino: Domino;
}

export interface GameConfig {
  // PLACEHOLDER defaults — tune after playtesting
  maxDiscards: number;
  maxSaves: number;
  /**
   * PLACEHOLDER: multiplier applied per branch point (double) along a scoring path.
   * Default 2. This is a first-pass stand-in for what will eventually come from
   * power-ups and tile effects — do not treat it as a final game-balance number.
   * Flag this value if real scores escalate too fast/slow to feel "dramatic."
   */
  branchMultiplier: number;
  /** Draw-five mode: number of tiles dealt per hand. Default 5. */
  handSize?: number;
  /** Draw-five mode: free re-rolls before tiles are discarded instead of returned. Default 3. */
  freeRerolls?: number;
}

export const defaultConfig: GameConfig = {
  maxDiscards: 5,
  maxSaves: 3,
  branchMultiplier: 2, // PLACEHOLDER — see GameConfig.branchMultiplier
  handSize: 5,
  freeRerolls: 3,
};

export interface RunState {
  config: GameConfig;
  drawPile: Domino[];
  discardPile: Domino[];
  /** Tiles banked for later play. Length never exceeds maxSaves at time of saving. */
  savedTiles: SavedTile[];
  /** Current tile the player must act on (place / discard / save). Null when deck is exhausted. */
  pendingTile: Domino | null;
  placedNodes: Record<string, PlacedNode>;
  openConnectionPoints: Record<string, ConnectionPoint>;
  /** Cumulative discards used this run. */
  discardsUsed: number;
  /** Cumulative saves used this run. Playing a saved tile does NOT decrement this. */
  savesUsed: number;
  status: RunStatus;
  /**
   * Every double placed during this run in order. No side effects — just a record
   * for the UI to display and for a future power-up system to hook into.
   */
  doubleTriggerLog: Array<{ nodeId: string; domino: Domino }>;
  mode?: GameMode;
  /** Draw-five mode: the player's current hand of tiles. */
  hand?: Domino[];
  /** Draw-five mode: cumulative re-rolls used this run. */
  rerollsUsed?: number;
}

export type PlacementErrorCode =
  | "root-already-placed"
  | "no-root-placed"
  | "invalid-connection-point"
  | "pip-mismatch"
  | "max-discards-exceeded"
  | "max-saves-exceeded"
  | "saved-tile-not-found";

export class PlacementError extends Error {
  constructor(
    public readonly code: PlacementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlacementError";
  }
}
