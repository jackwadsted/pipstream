import { describe, expect, it } from "vitest";
import type { Domino } from "../schemas/domino.js";
import type { ResolvedDeck } from "../schemas/deck.js";
import {
  checkRunEnd,
  discardTile,
  getLegalPlacements,
  placeTile,
  playSavedTile,
  saveTile,
  startRun,
} from "../engine/placementEngine.js";
import { PlacementError } from "../engine/types.js";
import type { GameConfig, RunState } from "../engine/types.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tile(lo: number, hi: number): Domino {
  return { id: `d${lo}-${hi}`, pips: [lo, hi], effects: [], tags: [] };
}

const cfg: GameConfig = { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 };

function blankState(overrides: Partial<RunState> = {}): RunState {
  return {
    config: cfg,
    drawPile: [],
    discardPile: [],
    savedTiles: [],
    pendingTile: tile(0, 1),
    placedNodes: {},
    openConnectionPoints: {},
    discardsUsed: 0,
    savesUsed: 0,
    status: "in-progress",
    doubleTriggerLog: [],
    ...overrides,
  };
}

function makeDeck(tiles: Domino[]): ResolvedDeck {
  return {
    id: "test",
    name: "Test",
    tiles: tiles.map((d) => ({ domino: d, quantity: 1 })),
  };
}

/** Place root, return resulting state. */
function placeRoot(t: Domino, extra?: Partial<RunState>): RunState {
  return placeTile(blankState({ pendingTile: t, ...extra }), t, null);
}

function openValues(state: RunState): number[] {
  return Object.values(state.openConnectionPoints)
    .map((p) => p.pipValue)
    .sort((a, b) => a - b);
}

// ─── startRun ────────────────────────────────────────────────────────────────

describe("startRun", () => {
  it("initialises with one pending tile, rest in the draw pile", () => {
    const tiles = [tile(0, 1), tile(1, 2), tile(2, 3)];
    const state = startRun(makeDeck(tiles), cfg);
    expect(state.pendingTile).not.toBeNull();
    expect(state.drawPile).toHaveLength(2);
    expect(state.placedNodes).toEqual({});
    expect(state.openConnectionPoints).toEqual({});
    expect(state.status).toBe("in-progress");
  });

  it("all tiles from deck appear exactly once across pending + drawPile", () => {
    const tiles = [tile(0, 1), tile(1, 2), tile(2, 3), tile(3, 4)];
    const state = startRun(makeDeck(tiles), cfg);
    const all = [state.pendingTile!, ...state.drawPile].map((t) => t.id).sort();
    expect(all).toEqual(["d0-1", "d1-2", "d2-3", "d3-4"]);
  });

  it("expands quantity > 1 correctly", () => {
    const deck: ResolvedDeck = {
      id: "dup",
      name: "Dup",
      tiles: [{ domino: tile(1, 1), quantity: 3 }],
    };
    const state = startRun(deck, cfg);
    const all = [state.pendingTile!, ...state.drawPile];
    expect(all).toHaveLength(3);
    expect(all.every((t) => t.id === "d1-1")).toBe(true);
  });
});

// ─── root placement — non-double ─────────────────────────────────────────────

describe("root placement — non-double", () => {
  it("opens exactly two connection points at the tile's pip values", () => {
    const state = placeRoot(tile(2, 3));
    expect(openValues(state)).toEqual([2, 3]);
  });

  it("placed node has connectedEnd null and parentNodeId null", () => {
    const state = placeRoot(tile(2, 3));
    const node = Object.values(state.placedNodes)[0]!;
    expect(node.connectedEnd).toBeNull();
    expect(node.parentNodeId).toBeNull();
  });

  it("both new connection points are owned by the root node", () => {
    const state = placeRoot(tile(2, 3));
    const node = Object.values(state.placedNodes)[0]!;
    expect(node.openConnectionPointIds).toHaveLength(2);
    for (const id of node.openConnectionPointIds) {
      expect(state.openConnectionPoints[id]).toBeDefined();
    }
  });
});

// ─── root placement — double ──────────────────────────────────────────────────

describe("root placement — double", () => {
  it("opens two connection points both at the double's value", () => {
    const state = placeRoot(tile(3, 3));
    const pts = Object.values(state.openConnectionPoints);
    expect(pts).toHaveLength(2);
    expect(pts.every((p) => p.pipValue === 3)).toBe(true);
  });

  it("double-zero root opens two points both at 0", () => {
    const state = placeRoot(tile(0, 0));
    expect(openValues(state)).toEqual([0, 0]);
  });
});

// ─── non-double mid-chain placement ──────────────────────────────────────────

describe("non-double mid-chain placement", () => {
  it("consumes one connection point and opens exactly one new one", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    // Attach d1-2 at pip-2 → consumes pip-2, opens pip-1
    state = placeTile({ ...state, pendingTile: tile(1, 2) }, tile(1, 2), pt2.id);
    expect(openValues(state)).toEqual([1, 3]);
  });

  it("sets connectedEnd 'a' when pips[0] matches the connection point", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    // d3-5: pips[0]=3 matches pip-3 → connectedEnd = 'a'
    state = placeTile({ ...state, pendingTile: tile(3, 5) }, tile(3, 5), pt3.id);
    const node = Object.values(state.placedNodes).find(
      (n) => n.domino.id === "d3-5",
    )!;
    expect(node.connectedEnd).toBe("a");
    // open point opened at pips[1] = 5
    expect(
      Object.values(state.openConnectionPoints).some((p) => p.pipValue === 5),
    ).toBe(true);
  });

  it("sets connectedEnd 'b' when pips[1] matches the connection point", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    // d1-3: pips[1]=3 matches pip-3 → connectedEnd = 'b'
    state = placeTile({ ...state, pendingTile: tile(1, 3) }, tile(1, 3), pt3.id);
    const node = Object.values(state.placedNodes).find(
      (n) => n.domino.id === "d1-3",
    )!;
    expect(node.connectedEnd).toBe("b");
    // open point opened at pips[0] = 1
    expect(
      Object.values(state.openConnectionPoints).some((p) => p.pipValue === 1),
    ).toBe(true);
  });

  it("consumed point is removed from the parent node's openConnectionPointIds", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const rootNode = Object.values(state.placedNodes)[0]!;
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    state = placeTile({ ...state, pendingTile: tile(1, 2) }, tile(1, 2), pt2.id);
    const rootNodeAfter = state.placedNodes[rootNode.id]!;
    expect(rootNodeAfter.openConnectionPointIds).not.toContain(pt2.id);
    expect(rootNodeAfter.openConnectionPointIds).toHaveLength(1);
  });
});

// ─── double mid-chain placement ───────────────────────────────────────────────

describe("double mid-chain placement", () => {
  it("consumes one connection point and opens two new ones at the double's value", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    // Place d3-3 at pip-3 → consumes pip-3, opens two pip-3s
    state = placeTile({ ...state, pendingTile: tile(3, 3) }, tile(3, 3), pt3.id);
    // open: original pip-2 + two new pip-3s = [2, 3, 3]
    expect(openValues(state)).toEqual([2, 3, 3]);
  });

  it("both new points belong to the double's node and carry its pip value", () => {
    let state = placeRoot(tile(2, 3));
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    state = placeTile({ ...state, pendingTile: tile(3, 3) }, tile(3, 3), pt3.id);
    const dNode = Object.values(state.placedNodes).find(
      (n) => n.domino.id === "d3-3",
    )!;
    expect(dNode.openConnectionPointIds).toHaveLength(2);
    for (const id of dNode.openConnectionPointIds) {
      expect(state.openConnectionPoints[id]?.pipValue).toBe(3);
    }
  });

  it("double sets connectedEnd 'a' by convention", () => {
    let state = placeRoot(tile(2, 3));
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    state = placeTile({ ...state, pendingTile: tile(3, 3) }, tile(3, 3), pt3.id);
    const dNode = Object.values(state.placedNodes).find(
      (n) => n.domino.id === "d3-3",
    )!;
    expect(dNode.connectedEnd).toBe("a");
  });
});

// ─── illegal placement ────────────────────────────────────────────────────────

describe("illegal placement", () => {
  it("throws PlacementError(pip-mismatch) when pips do not match the connection point", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    state = { ...state, pendingTile: tile(4, 5) };
    let err: PlacementError | undefined;
    try {
      placeTile(state, tile(4, 5), pt2.id);
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err).toBeInstanceOf(PlacementError);
    expect(err?.code).toBe("pip-mismatch");
  });

  it("throws PlacementError(invalid-connection-point) for an unknown point ID", () => {
    const state = { ...placeRoot(tile(2, 3)), pendingTile: tile(2, 3) };
    let err: PlacementError | undefined;
    try {
      placeTile(state, tile(2, 3), "no-such-id");
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("invalid-connection-point");
  });

  it("throws PlacementError(root-already-placed) when placing null after root exists", () => {
    const state = { ...placeRoot(tile(2, 3)), pendingTile: tile(0, 1) };
    let err: PlacementError | undefined;
    try {
      placeTile(state, tile(0, 1), null);
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("root-already-placed");
  });

  it("throws PlacementError(no-root-placed) when using a point ID before any tile is placed", () => {
    const state = blankState({ pendingTile: tile(2, 3) });
    let err: PlacementError | undefined;
    try {
      placeTile(state, tile(2, 3), "any-id");
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("no-root-placed");
  });
});

// ─── discard ──────────────────────────────────────────────────────────────────

describe("discardTile", () => {
  it("adds tile to discard pile and increments discardsUsed", () => {
    const state = blankState({ pendingTile: tile(0, 1) });
    const next = discardTile(state, tile(0, 1));
    expect(next.discardPile).toHaveLength(1);
    expect(next.discardPile[0]!.id).toBe("d0-1");
    expect(next.discardsUsed).toBe(1);
  });

  it("draws the next tile after discarding", () => {
    const state = blankState({
      pendingTile: tile(0, 1),
      drawPile: [tile(1, 2)],
    });
    const next = discardTile(state, tile(0, 1));
    expect(next.pendingTile?.id).toBe("d1-2");
  });

  it("throws PlacementError(max-discards-exceeded) once the limit is hit", () => {
    let state = blankState({
      pendingTile: tile(0, 1),
      drawPile: [tile(1, 2), tile(2, 3)],
    });
    state = discardTile(state, tile(0, 1)); // 1st discard
    state = discardTile(state, tile(1, 2)); // 2nd discard (hits cfg.maxDiscards = 2)
    let err: PlacementError | undefined;
    try {
      discardTile(state, tile(2, 3));
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("max-discards-exceeded");
  });
});

// ─── save ─────────────────────────────────────────────────────────────────────

describe("saveTile", () => {
  it("moves tile to savedTiles and increments savesUsed", () => {
    const t = tile(2, 4);
    const state = blankState({ pendingTile: t });
    const next = saveTile(state, t);
    expect(next.savedTiles).toHaveLength(1);
    expect(next.savedTiles[0]!.domino).toEqual(t);
    expect(next.savesUsed).toBe(1);
  });

  it("draws the next tile after saving", () => {
    const state = blankState({
      pendingTile: tile(0, 1),
      drawPile: [tile(1, 2)],
    });
    const next = saveTile(state, tile(0, 1));
    expect(next.pendingTile?.id).toBe("d1-2");
  });

  it("throws PlacementError(max-saves-exceeded) once the cumulative limit is hit", () => {
    let state = blankState({
      pendingTile: tile(0, 1),
      drawPile: [tile(1, 2), tile(2, 3)],
    });
    state = saveTile(state, tile(0, 1)); // 1st save
    state = saveTile(state, tile(1, 2)); // 2nd save (hits cfg.maxSaves = 2)
    let err: PlacementError | undefined;
    try {
      saveTile(state, tile(2, 3));
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("max-saves-exceeded");
  });

  it("savesUsed is cumulative — playing a saved tile does not free a slot", () => {
    // Place root d2-3 first so we have open points [2, 3] to play saved tiles on.
    let state = blankState({
      pendingTile: tile(2, 3),
      drawPile: [tile(0, 2), tile(1, 3)],
    });
    state = placeTile(state, tile(2, 3), null); // root; draws d0-2
    state = saveTile(state, tile(0, 2));         // savesUsed = 1; draws d1-3
    state = saveTile(state, tile(1, 3));         // savesUsed = 2 (at max); draws null
    expect(state.savedTiles).toHaveLength(2);
    expect(state.savesUsed).toBe(2);

    // Play d0-2 (pips [0,2]) on pip-2 → savedTiles shrinks to 1
    const savedId = state.savedTiles.find((s) => s.domino.id === "d0-2")!.id;
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    state = playSavedTile(state, savedId, pt2.id);
    expect(state.savedTiles).toHaveLength(1);
    expect(state.savesUsed).toBe(2); // still 2, not decremented

    // Attempting to save again still throws
    let err: PlacementError | undefined;
    try {
      saveTile({ ...state, pendingTile: tile(4, 5) }, tile(4, 5));
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("max-saves-exceeded");
  });
});

// ─── playSavedTile ────────────────────────────────────────────────────────────

describe("playSavedTile", () => {
  it("places the saved tile, removes it from savedTiles, and updates the graph", () => {
    // Root: d2-3 → open [2, 3]. Save d1-2, then play it on pip-2.
    let state = placeRoot(tile(2, 3), { drawPile: [tile(1, 2)] });
    // After root, pendingTile = d1-2 (drawn from drawPile)
    state = saveTile(state, tile(1, 2));
    // savedTiles = [d1-2], pendingTile = null (drawPile empty)
    const savedId = state.savedTiles[0]!.id;
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    const after = playSavedTile(state, savedId, pt2.id);
    expect(after.savedTiles).toHaveLength(0);
    expect(Object.keys(after.placedNodes)).toHaveLength(2);
    expect(openValues(after)).toEqual([1, 3]); // pip-2 consumed, pip-1 opened
  });

  it("does NOT advance the draw pile — pendingTile is unchanged", () => {
    let state = placeRoot(tile(2, 3), { drawPile: [tile(4, 5)] });
    // After root, pendingTile = d4-5
    const savedId = genSavedTileId(state, tile(3, 3));
    state = injectSavedTile(state, { id: savedId, domino: tile(3, 3) });
    const pt3 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 3,
    )!;
    const after = playSavedTile(state, savedId, pt3.id);
    expect(after.pendingTile?.id).toBe("d4-5");
    expect(after.drawPile).toHaveLength(0);
  });

  it("reuses placeTile validation — rejects pip mismatches", () => {
    let state = placeRoot(tile(2, 3), { drawPile: [tile(4, 5)] });
    const savedId = genSavedTileId(state, tile(4, 5));
    state = injectSavedTile(state, { id: savedId, domino: tile(4, 5) });
    const pt2 = Object.values(state.openConnectionPoints).find(
      (p) => p.pipValue === 2,
    )!;
    let err: PlacementError | undefined;
    try {
      playSavedTile(state, savedId, pt2.id);
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("pip-mismatch");
  });

  it("throws PlacementError(saved-tile-not-found) for unknown saved tile ID", () => {
    const state = blankState();
    let err: PlacementError | undefined;
    try {
      playSavedTile(state, "nonexistent", null);
    } catch (e) {
      err = e as PlacementError;
    }
    expect(err?.code).toBe("saved-tile-not-found");
  });
});

// ─── checkRunEnd ──────────────────────────────────────────────────────────────

describe("checkRunEnd", () => {
  it("returns in-progress at start (root state always has a legal placement)", () => {
    const state = blankState({ pendingTile: tile(0, 1) });
    expect(checkRunEnd(state)).toBe("in-progress");
  });

  it("returns ended-deck-exhausted when draw pile and pending are both empty", () => {
    const state = blankState({ pendingTile: null, drawPile: [] });
    expect(checkRunEnd(state)).toBe("ended-deck-exhausted");
  });

  it("returns in-progress while the pending tile has a legal placement", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    state = { ...state, pendingTile: tile(1, 2), discardsUsed: cfg.maxDiscards };
    // d1-2 can attach at pip-2 → in-progress even with discards exhausted
    expect(checkRunEnd(state)).toBe("in-progress");
  });

  it("returns in-progress while discards are available (even if pending is a dead draw)", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    // d5-6 can't attach to [2, 3], but discards remain
    state = { ...state, pendingTile: tile(5, 6), discardsUsed: 0 };
    expect(checkRunEnd(state)).toBe("in-progress");
  });

  it("returns ended-no-moves when pending is dead, discards exhausted, no saved moves", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    state = {
      ...state,
      pendingTile: tile(5, 6),
      drawPile: [],
      discardsUsed: cfg.maxDiscards,
      savedTiles: [],
    };
    expect(checkRunEnd(state)).toBe("ended-no-moves");
  });

  it("returns in-progress when a saved tile has a legal placement (even with dead draw + no discards)", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    state = {
      ...state,
      pendingTile: tile(5, 6),
      drawPile: [],
      discardsUsed: cfg.maxDiscards,
      savedTiles: [injectSavedTileObj(tile(2, 4))], // d2-4 matches pip-2
      savesUsed: 1,
    };
    expect(checkRunEnd(state)).toBe("in-progress");
  });

  it("returns ended-no-moves when saved tiles exist but none can be placed", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    state = {
      ...state,
      pendingTile: tile(5, 6),
      drawPile: [],
      discardsUsed: cfg.maxDiscards,
      savedTiles: [injectSavedTileObj(tile(4, 5))], // d4-5 cannot attach to [2,3]
      savesUsed: 1,
    };
    expect(checkRunEnd(state)).toBe("ended-no-moves");
  });
});

// ─── getLegalPlacements ───────────────────────────────────────────────────────

describe("getLegalPlacements", () => {
  it("returns empty array before any tile is placed (root state)", () => {
    const state = blankState();
    expect(getLegalPlacements(state, tile(2, 3))).toHaveLength(0);
  });

  it("returns matching open points and excludes non-matching ones", () => {
    let state = placeRoot(tile(2, 3)); // open: [2, 3]
    const legal = getLegalPlacements(state, tile(1, 2)); // matches pip-2
    expect(legal).toHaveLength(1);
    expect(legal[0]!.pipValue).toBe(2);
  });

  it("returns multiple points when multiple open pips match", () => {
    // Place double root d3-3 → open: [3, 3]
    let state = placeRoot(tile(3, 3));
    // d3-4 matches both pip-3 points
    const legal = getLegalPlacements(state, tile(3, 4));
    expect(legal).toHaveLength(2);
  });
});

// ─── doubleTriggerLog ─────────────────────────────────────────────────────────

describe("doubleTriggerLog", () => {
  it("placing a non-double root does not append to the log", () => {
    const state = placeRoot(tile(2, 3));
    expect(state.doubleTriggerLog).toHaveLength(0);
  });

  it("placing a double root appends one entry to the log", () => {
    const state = placeRoot(tile(3, 3));
    expect(state.doubleTriggerLog).toHaveLength(1);
    expect(state.doubleTriggerLog[0]!.domino.id).toBe("d3-3");
  });

  it("placing a non-double mid-chain tile does not append", () => {
    let state = placeRoot(tile(2, 3)); // open [2,3]
    const pt3 = Object.values(state.openConnectionPoints).find((p) => p.pipValue === 3)!;
    state = placeTile({ ...state, pendingTile: tile(1, 3) }, tile(1, 3), pt3.id);
    expect(state.doubleTriggerLog).toHaveLength(0);
  });

  it("placing a double mid-chain appends one entry", () => {
    let state = placeRoot(tile(2, 3)); // open [2,3]
    const pt3 = Object.values(state.openConnectionPoints).find((p) => p.pipValue === 3)!;
    state = placeTile({ ...state, pendingTile: tile(3, 3) }, tile(3, 3), pt3.id);
    expect(state.doubleTriggerLog).toHaveLength(1);
    expect(state.doubleTriggerLog[0]!.domino.id).toBe("d3-3");
  });

  it("multiple doubles accumulate in order", () => {
    let state = placeRoot(tile(3, 3)); // double root → 1 entry
    const [pt] = Object.values(state.openConnectionPoints);
    state = placeTile({ ...state, pendingTile: tile(3, 3) }, tile(3, 3), pt!.id);
    expect(state.doubleTriggerLog).toHaveLength(2);
    expect(state.doubleTriggerLog.every((e) => e.domino.id === "d3-3")).toBe(true);
  });
});

// ─── local test utilities (not exported) ─────────────────────────────────────

function genSavedTileId(_state: RunState, _tile: Domino): string {
  return `test-saved-${_tile.id}`;
}

function injectSavedTile(
  state: RunState,
  saved: { id: string; domino: Domino },
): RunState {
  return { ...state, savedTiles: [...state.savedTiles, saved] };
}

function injectSavedTileObj(t: Domino): { id: string; domino: Domino } {
  return { id: `test-saved-${t.id}`, domino: t };
}
