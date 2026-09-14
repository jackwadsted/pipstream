import type { Domino } from "../schemas/domino.js";
import type { ResolvedDeck } from "../schemas/deck.js";
import { seededShuffle } from "./seededShuffle.js";
import type {
  ConnectionPoint,
  Direction,
  GameConfig,
  PlacedNode,
  RunState,
  RunStatus,
  SavedTile,
} from "./types.js";
import { PlacementError } from "./types.js";

// Tile dimensions in pixels — shared with the layout component.
const TILE_W = 72; // long axis
const TILE_H = 36; // short axis

// ─── internal helpers ────────────────────────────────────────────────────────

function genId(): string {
  return crypto.randomUUID();
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const isDouble = (tile: Domino): boolean => tile.pips[0] === tile.pips[1];

function makePoint(
  owningNodeId: string,
  pipValue: number,
  direction: Direction,
  position: { x: number; y: number },
): ConnectionPoint {
  return { id: genId(), owningNodeId, pipValue, direction, position };
}

function drawNextTile(state: RunState): RunState {
  if (state.drawPile.length === 0) return { ...state, pendingTile: null };
  const [next, ...rest] = state.drawPile;
  return { ...state, pendingTile: next!, drawPile: rest };
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Initialise a new run: expand the deck (respecting quantities), shuffle,
 * embed config, and draw the first pending tile.
 */
export function startRun(deck: ResolvedDeck, config: GameConfig): RunState {
  const allTiles = deck.tiles.flatMap(({ domino, quantity }) =>
    Array.from({ length: quantity }, () => domino),
  );
  const [first, ...rest] = shuffle(allTiles);
  return {
    config,
    mode: "save-discard",
    drawPile: rest,
    discardPile: [],
    savedTiles: [],
    hand: [],
    rerollsUsed: 0,
    pendingTile: first ?? null,
    placedNodes: {},
    openConnectionPoints: {},
    discardsUsed: 0,
    savesUsed: 0,
    status: "in-progress",
    doubleTriggerLog: [],
  };
}

export function startRunDrawFive(deck: ResolvedDeck, config: GameConfig): RunState {
  const allTiles = deck.tiles.flatMap(({ domino, quantity }) =>
    Array.from({ length: quantity }, () => domino),
  );
  const shuffled = shuffle(allTiles);
  const handSize = config.handSize ?? 5;
  const hand = shuffled.slice(0, handSize);
  const rest = shuffled.slice(handSize);
  return {
    config,
    mode: "draw-five",
    drawPile: rest,
    discardPile: [],
    savedTiles: [],
    hand,
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

export function startRunSeeded(deck: ResolvedDeck, config: GameConfig, seed: number): RunState {
  const allTiles = deck.tiles.flatMap(({ domino, quantity }) =>
    Array.from({ length: quantity }, () => domino),
  );
  const [first, ...rest] = seededShuffle(allTiles, seed);
  return {
    config,
    mode: "save-discard",
    drawPile: rest,
    discardPile: [],
    savedTiles: [],
    hand: [],
    rerollsUsed: 0,
    pendingTile: first ?? null,
    placedNodes: {},
    openConnectionPoints: {},
    discardsUsed: 0,
    savesUsed: 0,
    status: "in-progress",
    doubleTriggerLog: [],
  };
}

export function startRunDrawFiveSeeded(deck: ResolvedDeck, config: GameConfig, seed: number): RunState {
  const allTiles = deck.tiles.flatMap(({ domino, quantity }) =>
    Array.from({ length: quantity }, () => domino),
  );
  const shuffled = seededShuffle(allTiles, seed);
  const handSize = config.handSize ?? 5;
  const hand = shuffled.slice(0, handSize);
  const rest = shuffled.slice(handSize);
  return {
    config,
    mode: "draw-five",
    drawPile: rest,
    discardPile: [],
    savedTiles: [],
    hand,
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

/**
 * Returns every open connection point the given tile could legally attach to.
 *
 * An empty result has two meanings:
 *   (a) No tiles placed yet → root placement is valid; call placeTile with
 *       connectionPointId: null.
 *   (b) No pip matches → tile is a dead draw.
 *
 * POWER-UP HOOK: A "wild tile" or "any-match" effect would intercept the
 * pip-match predicate here. Centralise any matching-rule changes in this
 * single function so a power-up remains a single change point rather than
 * touching every caller.
 */
export function getLegalPlacements(
  state: RunState,
  tile: Domino,
): ConnectionPoint[] {
  return Object.values(state.openConnectionPoints).filter(
    (p) => tile.pips[0] === p.pipValue || tile.pips[1] === p.pipValue,
  );
}

/**
 * Determine the current run status.
 *
 * ended-deck-exhausted: draw pile empty and no pending tile.
 * ended-no-moves: pending tile cannot be placed, no saved tile can be placed,
 *   and discards are exhausted. A run does NOT end just because the current tile
 *   is a dead draw while discards remain available.
 * in-progress: anything else, including the root state (first tile always legal).
 */
export function checkRunEnd(state: RunState): RunStatus {
  if (state.mode === "draw-five") {
    const hand = state.hand ?? [];
    if (hand.length === 0 && state.drawPile.length === 0) return "ended-deck-exhausted";
    return "in-progress";
  }

  const { pendingTile, drawPile, placedNodes, savedTiles, discardsUsed, config } =
    state;

  if (pendingTile === null) {
    return drawPile.length === 0 ? "ended-deck-exhausted" : "in-progress";
  }

  // Before any tile is placed, the root placement is always available.
  if (Object.keys(placedNodes).length === 0) return "in-progress";

  const pendingHasMove = getLegalPlacements(state, pendingTile).length > 0;
  const savedHasMove = savedTiles.some(
    (s) => getLegalPlacements(state, s.domino).length > 0,
  );
  const canDiscard = discardsUsed < config.maxDiscards;

  if (pendingHasMove || savedHasMove || canDiscard) return "in-progress";
  return "ended-no-moves";
}

/**
 * Core placement logic shared by placeTile and playSavedTile.
 * Does NOT advance the draw pile — callers decide whether to draw.
 *
 * connectionPointId === null → root placement (only valid before any tile is placed).
 *
 * Design choice: root placement uses connectionPointId: null rather than a
 * separate placeRootTile function, keeping the call-site API uniform and
 * allowing the game loop to branch on a single field rather than two different
 * entry points.
 */
function placeTileCore(
  state: RunState,
  tile: Domino,
  connectionPointId: string | null,
): RunState {
  const isRoot = connectionPointId === null;
  const hasRoot = Object.keys(state.placedNodes).length > 0;

  if (isRoot && hasRoot) {
    throw new PlacementError(
      "root-already-placed",
      "A root tile has already been placed; provide a connection point ID.",
    );
  }
  if (!isRoot && !hasRoot) {
    throw new PlacementError(
      "no-root-placed",
      "No tiles placed yet — use connectionPointId: null to place the root.",
    );
  }

  const nodeId = genId();
  let connectedEnd: "a" | "b" | null = null;
  let parentNodeId: string | null = null;
  let newPoints: ConnectionPoint[] = [];
  let consumedPointId: string | null = null;
  let updatedParentNode: PlacedNode | null = null;
  let nodePosition: { x: number; y: number };
  let nodeOrientation: "horizontal" | "vertical";
  let nodeIncomingDirection: "left" | "right" | "up" | "down" | null;

  if (isRoot) {
    // POWER-UP HOOK: double-root placement is a natural trigger point (e.g. an
    // ability that grants extra starting connection points). Fire after state is
    // updated so power-up code sees a consistent graph.
    nodePosition = { x: 0, y: 0 };
    nodeOrientation = "horizontal";
    nodeIncomingDirection = null;
    if (isDouble(tile)) {
      newPoints = [
        makePoint(nodeId, tile.pips[0], "left",  { x: -TILE_W / 2, y: 0 }),
        makePoint(nodeId, tile.pips[0], "right", { x:  TILE_W / 2, y: 0 }),
      ];
    } else {
      newPoints = [
        makePoint(nodeId, tile.pips[0], "left",  { x: -TILE_W / 2, y: 0 }),
        makePoint(nodeId, tile.pips[1], "right", { x:  TILE_W / 2, y: 0 }),
      ];
    }
  } else {
    const point = state.openConnectionPoints[connectionPointId!];
    if (!point) {
      throw new PlacementError(
        "invalid-connection-point",
        `Connection point "${connectionPointId}" does not exist or is already consumed.`,
      );
    }

    const matchesA = tile.pips[0] === point.pipValue;
    const matchesB = tile.pips[1] === point.pipValue;
    if (!matchesA && !matchesB) {
      throw new PlacementError(
        "pip-mismatch",
        `Tile ${tile.id} (${tile.pips[0]}-${tile.pips[1]}) cannot connect to pip-${point.pipValue}.`,
      );
    }

    consumedPointId = point.id;
    parentNodeId = point.owningNodeId;
    nodeIncomingDirection = point.direction;
    const parentNode = state.placedNodes[parentNodeId]!;
    updatedParentNode = {
      ...parentNode,
      openConnectionPointIds: parentNode.openConnectionPointIds.filter(
        (id) => id !== consumedPointId,
      ),
    };

    const { direction, position: ptPos } = point;

    if (isDouble(tile)) {
      // POWER-UP HOOK: doubles are the primary power-up trigger surface. Fire
      // effects after the graph update (below) so power-up code sees the
      // completed placement.
      connectedEnd = "a"; // both ends equal; 'a' is the canonical choice

      // Double is placed perpendicular to the incoming direction.
      if (direction === "right") {
        nodeOrientation = "vertical";
        nodePosition = { x: ptPos.x + TILE_H / 2, y: ptPos.y };
        newPoints = [
          makePoint(nodeId, tile.pips[0], "up",   { x: nodePosition.x, y: ptPos.y - TILE_W / 2 }),
          makePoint(nodeId, tile.pips[0], "down", { x: nodePosition.x, y: ptPos.y + TILE_W / 2 }),
        ];
      } else if (direction === "left") {
        nodeOrientation = "vertical";
        nodePosition = { x: ptPos.x - TILE_H / 2, y: ptPos.y };
        newPoints = [
          makePoint(nodeId, tile.pips[0], "up",   { x: nodePosition.x, y: ptPos.y - TILE_W / 2 }),
          makePoint(nodeId, tile.pips[0], "down", { x: nodePosition.x, y: ptPos.y + TILE_W / 2 }),
        ];
      } else if (direction === "down") {
        nodeOrientation = "horizontal";
        nodePosition = { x: ptPos.x, y: ptPos.y + TILE_H / 2 };
        newPoints = [
          makePoint(nodeId, tile.pips[0], "left",  { x: ptPos.x - TILE_W / 2, y: nodePosition.y }),
          makePoint(nodeId, tile.pips[0], "right", { x: ptPos.x + TILE_W / 2, y: nodePosition.y }),
        ];
      } else {
        nodeOrientation = "horizontal";
        nodePosition = { x: ptPos.x, y: ptPos.y - TILE_H / 2 };
        newPoints = [
          makePoint(nodeId, tile.pips[0], "left",  { x: ptPos.x - TILE_W / 2, y: nodePosition.y }),
          makePoint(nodeId, tile.pips[0], "right", { x: ptPos.x + TILE_W / 2, y: nodePosition.y }),
        ];
      }
    } else {
      connectedEnd = matchesA ? "a" : "b";
      const openPip = matchesA ? tile.pips[1] : tile.pips[0];

      // Non-double extends in the same direction as the incoming connection point.
      if (direction === "right") {
        nodeOrientation = "horizontal";
        nodePosition = { x: ptPos.x + TILE_W / 2, y: ptPos.y };
        newPoints = [makePoint(nodeId, openPip, "right", { x: ptPos.x + TILE_W, y: ptPos.y })];
      } else if (direction === "left") {
        nodeOrientation = "horizontal";
        nodePosition = { x: ptPos.x - TILE_W / 2, y: ptPos.y };
        newPoints = [makePoint(nodeId, openPip, "left", { x: ptPos.x - TILE_W, y: ptPos.y })];
      } else if (direction === "down") {
        nodeOrientation = "vertical";
        nodePosition = { x: ptPos.x, y: ptPos.y + TILE_W / 2 };
        newPoints = [makePoint(nodeId, openPip, "down", { x: ptPos.x, y: ptPos.y + TILE_W })];
      } else {
        nodeOrientation = "vertical";
        nodePosition = { x: ptPos.x, y: ptPos.y - TILE_W / 2 };
        newPoints = [makePoint(nodeId, openPip, "up", { x: ptPos.x, y: ptPos.y - TILE_W })];
      }
    }
  }

  const newNode: PlacedNode = {
    id: nodeId,
    domino: tile,
    connectedEnd,
    parentNodeId,
    openConnectionPointIds: newPoints.map((p) => p.id),
    position: nodePosition!,
    orientation: nodeOrientation!,
    incomingDirection: nodeIncomingDirection!,
  };

  const updatedPoints = { ...state.openConnectionPoints };
  if (consumedPointId) delete updatedPoints[consumedPointId];
  for (const p of newPoints) updatedPoints[p.id] = p;

  const updatedNodes = { ...state.placedNodes, [nodeId]: newNode };
  if (updatedParentNode) updatedNodes[updatedParentNode.id] = updatedParentNode;

  const updatedDoubleLog = isDouble(tile)
    ? [...state.doubleTriggerLog, { nodeId, domino: tile }]
    : state.doubleTriggerLog;

  return {
    ...state,
    placedNodes: updatedNodes,
    openConnectionPoints: updatedPoints,
    doubleTriggerLog: updatedDoubleLog,
  };
}

/**
 * Place the current pending tile.
 * connectionPointId: null → root placement (only valid before any tile is placed).
 * Advances the draw pile after a successful placement.
 */
export function placeTile(
  state: RunState,
  tile: Domino,
  connectionPointId: string | null,
): RunState {
  let next = placeTileCore(state, tile, connectionPointId);
  next = drawNextTile(next);
  return { ...next, status: checkRunEnd(next) };
}

/**
 * Discard the current pending tile. Enforces the cumulative maxDiscards limit.
 */
export function discardTile(state: RunState, tile: Domino): RunState {
  if (state.discardsUsed >= state.config.maxDiscards) {
    throw new PlacementError(
      "max-discards-exceeded",
      `Maximum discards (${state.config.maxDiscards}) already used.`,
    );
  }
  let next: RunState = {
    ...state,
    discardPile: [...state.discardPile, tile],
    discardsUsed: state.discardsUsed + 1,
  };
  next = drawNextTile(next);
  return { ...next, status: checkRunEnd(next) };
}

/**
 * Save the current pending tile for later play. Enforces cumulative maxSaves.
 * savesUsed is a one-way counter — playing a saved tile does not free a save slot.
 */
export function saveTile(state: RunState, tile: Domino): RunState {
  if (state.savesUsed >= state.config.maxSaves) {
    throw new PlacementError(
      "max-saves-exceeded",
      `Maximum saves (${state.config.maxSaves}) already used.`,
    );
  }
  const saved: SavedTile = { id: genId(), domino: tile };
  let next: RunState = {
    ...state,
    savedTiles: [...state.savedTiles, saved],
    savesUsed: state.savesUsed + 1,
  };
  next = drawNextTile(next);
  return { ...next, status: checkRunEnd(next) };
}

/**
 * Play a previously saved tile onto the board.
 *
 * The current pendingTile (drawn tile) is NOT advanced — this action does not
 * consume a draw. The player still holds their drawn tile and must act on it.
 * This lets saved tiles serve as "bonus" placements at any time, including when
 * the drawn tile is a dead draw and discards must be conserved.
 */
export function playSavedTile(
  state: RunState,
  savedTileId: string,
  connectionPointId: string | null,
): RunState {
  const savedTile = state.savedTiles.find((s) => s.id === savedTileId);
  if (!savedTile) {
    throw new PlacementError(
      "saved-tile-not-found",
      `Saved tile "${savedTileId}" not found in the save pool.`,
    );
  }
  const withoutSaved: RunState = {
    ...state,
    savedTiles: state.savedTiles.filter((s) => s.id !== savedTileId),
  };
  const next = placeTileCore(withoutSaved, savedTile.domino, connectionPointId);
  return { ...next, status: checkRunEnd(next) };
}

/**
 * Draw-five mode: place a tile from the player's hand.
 * Automatically refills the hand from the draw pile when it becomes empty.
 */
export function playFromHand(
  state: RunState,
  handTileId: string,
  connectionPointId: string | null,
): RunState {
  const hand = state.hand ?? [];
  const tile = hand.find((t) => t.id === handTileId);
  if (!tile) {
    throw new PlacementError(
      "saved-tile-not-found",
      `Hand tile "${handTileId}" not found.`,
    );
  }
  const withoutTile: RunState = {
    ...state,
    hand: hand.filter((t) => t.id !== handTileId),
  };
  let next = placeTileCore(withoutTile, tile, connectionPointId);

  // Auto-refill hand when empty
  const currentHand = next.hand ?? [];
  if (currentHand.length === 0 && next.drawPile.length > 0) {
    const handSize = next.config.handSize ?? 5;
    const count = Math.min(handSize, next.drawPile.length);
    next = {
      ...next,
      hand: next.drawPile.slice(0, count),
      drawPile: next.drawPile.slice(count),
    };
  }

  return { ...next, status: checkRunEnd(next) };
}

/**
 * Draw-five mode: discard or return the current hand and deal 5 new tiles.
 * First freeRerolls re-rolls shuffle the hand back into the draw pile.
 * Subsequent re-rolls discard the hand (no tiles returned to deck).
 */
export function rerollHand(state: RunState): RunState {
  const hand = state.hand ?? [];
  const rerollsUsed = state.rerollsUsed ?? 0;
  const freeRerolls = state.config.freeRerolls ?? 3;
  const handSize = state.config.handSize ?? 5;

  const isFree = rerollsUsed < freeRerolls;
  let newDrawPile: Domino[];
  let newDiscardPile: Domino[];

  if (isFree) {
    newDrawPile = [...state.drawPile, ...hand];
    newDiscardPile = state.discardPile;
  } else {
    newDrawPile = state.drawPile;
    newDiscardPile = [...state.discardPile, ...hand];
  }

  const count = Math.min(handSize, newDrawPile.length);
  const next: RunState = {
    ...state,
    hand: newDrawPile.slice(0, count),
    drawPile: newDrawPile.slice(count),
    discardPile: newDiscardPile,
    rerollsUsed: rerollsUsed + 1,
  };
  return { ...next, status: checkRunEnd(next) };
}
