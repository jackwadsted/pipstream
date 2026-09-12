import { describe, expect, it } from "vitest";
import type { Domino } from "../schemas/domino.js";
import type { GameConfig, PlacedNode, RunState } from "../engine/types.js";
import { computeScore } from "../engine/scoring.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tile(lo: number, hi: number): Domino {
  return { id: `d${lo}-${hi}`, pips: [lo, hi], effects: [], tags: [] };
}

const cfg: GameConfig = { maxDiscards: 5, maxSaves: 3, branchMultiplier: 2 };

function node(
  id: string,
  domino: Domino,
  parentNodeId: string | null,
  connectedEnd: "a" | "b" | null = null,
): PlacedNode {
  return {
    id,
    domino,
    connectedEnd,
    parentNodeId,
    openConnectionPointIds: [],
    position: { x: 0, y: 0 },
    orientation: "horizontal",
    incomingDirection: parentNodeId === null ? null : "right",
  };
}

function stateFrom(...nodes: PlacedNode[]): RunState {
  return {
    config: cfg,
    drawPile: [],
    discardPile: [],
    savedTiles: [],
    pendingTile: null,
    placedNodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    openConnectionPoints: {},
    discardsUsed: 0,
    savesUsed: 0,
    status: "ended-deck-exhausted",
    doubleTriggerLog: [],
  };
}

// ─── empty / no-root edge cases ───────────────────────────────────────────────

describe("computeScore — empty tree", () => {
  it("returns zero score when no tiles placed", () => {
    const result = computeScore(stateFrom(), cfg);
    expect(result.totalScore).toBe(0);
    expect(result.paths).toHaveLength(0);
  });

  it("returns single-path score for a lone root tile", () => {
    const root = node("r", tile(2, 3), null, null);
    const result = computeScore(stateFrom(root), cfg);
    expect(result.totalScore).toBe(5); // 2+3
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]!.multiplier).toBe(1);
    expect(result.paths[0]!.contribution).toBe(5);
  });
});

// ─── straight chain (no doubles) ─────────────────────────────────────────────

describe("computeScore — straight chain, no doubles", () => {
  it("one path, multiplier=1, score = sum of all pips", () => {
    // root(2-3) → A(1-2) → B(0-1)
    // pip sums: 5 + 3 + 1 = 9
    const root = node("r", tile(2, 3), null, null);
    const A = node("A", tile(1, 2), "r", "b"); // pips[1]=2 matched parent
    const B = node("B", tile(0, 1), "A", "b"); // pips[1]=1 matched parent
    const result = computeScore(stateFrom(root, A, B), cfg);

    expect(result.paths).toHaveLength(1);
    const p = result.paths[0]!;
    expect(p.pipTotal).toBe(9);
    expect(p.multiplier).toBe(1);
    expect(p.contribution).toBe(9);
    expect(result.totalScore).toBe(9);
  });

  it("two non-double branches both score multiplier=1", () => {
    // root(2-3) has children A(at pip-2) and B(at pip-3)
    const root = node("r", tile(2, 3), null, null);
    const A = node("A", tile(0, 2), "r", "b");
    const B = node("B", tile(1, 3), "r", "b");
    const result = computeScore(stateFrom(root, A, B), cfg);

    expect(result.paths).toHaveLength(2);
    for (const p of result.paths) {
      expect(p.multiplier).toBe(1);
    }
    // root(5) + A(2) = 7; root(5) + B(4) = 9; total = 16
    expect(result.totalScore).toBe(16);
  });
});

// ─── single double ────────────────────────────────────────────────────────────

describe("computeScore — single double", () => {
  it("double root with two children: both paths get branchMultiplier once", () => {
    // root(3-3)[double] → C(3-5), D(3-4)
    // branchMultiplier = 2
    const root = node("r", tile(3, 3), null, null);
    const C = node("C", tile(3, 5), "r", "a");
    const D = node("D", tile(3, 4), "r", "a");
    const result = computeScore(stateFrom(root, C, D), cfg);

    expect(result.paths).toHaveLength(2);
    for (const p of result.paths) {
      expect(p.multiplier).toBe(2);
    }
    // root(6)+C(8)=14 ×2=28; root(6)+D(7)=13 ×2=26; total=54
    expect(result.totalScore).toBe(54);
  });

  it("double mid-chain: two leaf paths each carry branchMultiplier", () => {
    // root(2-3) → double(3-3) → C(3-5), D(3-4)
    const root = node("r", tile(2, 3), null, null);
    const dbl = node("dbl", tile(3, 3), "r", "a");
    const C = node("C", tile(3, 5), "dbl", "a");
    const D = node("D", tile(3, 4), "dbl", "a");
    const result = computeScore(stateFrom(root, dbl, C, D), cfg);

    expect(result.paths).toHaveLength(2);
    for (const p of result.paths) {
      expect(p.multiplier).toBe(2);
    }
    // root(5)+dbl(6)+C(8)=19 ×2=38; root(5)+dbl(6)+D(7)=18 ×2=36; total=74
    expect(result.totalScore).toBe(74);
  });

  it("leaf double (no children): multiplier stays 1 — no branches to multiply", () => {
    // root(2-3) → double(3-3)[leaf — no children placed]
    const root = node("r", tile(2, 3), null, null);
    const dbl = node("dbl", tile(3, 3), "r", "a");
    const result = computeScore(stateFrom(root, dbl), cfg);

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]!.multiplier).toBe(1);
    expect(result.paths[0]!.pipTotal).toBe(11); // 5 + 6
    expect(result.paths[0]!.contribution).toBe(11);
  });
});

// ─── nested doubles (multiplicative stacking) ─────────────────────────────────

describe("computeScore — nested doubles", () => {
  it("path through two doubles gets branchMultiplier^2, not branchMultiplier*2", () => {
    // root(2-3) → double1(3-3) → double2(3-3) → leaf(3-5)
    // branchMultiplier=2 → expected multiplier = 2^2 = 4, not 2+2 = 4 (coincidence)
    // Use branchMultiplier=3 to distinguish: 3^2=9 vs 3+3=6
    const customCfg: GameConfig = { ...cfg, branchMultiplier: 3 };
    const root = node("r", tile(2, 3), null, null);
    const d1 = node("d1", tile(3, 3), "r", "a");
    const d2 = node("d2", tile(3, 3), "d1", "a");
    const leaf = node("leaf", tile(3, 5), "d2", "a");
    const state = stateFrom(root, d1, d2, leaf);
    const result = computeScore(state, customCfg);

    expect(result.paths).toHaveLength(1);
    const p = result.paths[0]!;
    expect(p.multiplier).toBe(9); // 3^2
    // pip totals: (2+3)+(3+3)+(3+3)+(3+5) = 5+6+6+8 = 25
    expect(p.pipTotal).toBe(25);
    expect(p.contribution).toBe(225); // 25 * 9
    expect(result.totalScore).toBe(225);
  });

  it("sibling branch through only one double keeps multiplier branchMultiplier^1", () => {
    // root(2-3) → double1(3-3) → double2(3-3) → leafA
    //                          → leafB  (sibling branch, only one double)
    const root = node("r", tile(2, 3), null, null);
    const d1 = node("d1", tile(3, 3), "r", "a");
    const d2 = node("d2", tile(3, 3), "d1", "a");
    const leafA = node("lA", tile(3, 5), "d2", "a");
    const leafB = node("lB", tile(3, 4), "d1", "a");
    const state = stateFrom(root, d1, d2, leafA, leafB);
    const result = computeScore(state, cfg); // branchMultiplier=2

    // leafA path: through d1 (×2) and d2 (×2) → multiplier=4
    const pathA = result.paths.find((p) => p.leafNodeId === "lA")!;
    expect(pathA.multiplier).toBe(4);

    // leafB path: through d1 (×2) only → multiplier=2
    const pathB = result.paths.find((p) => p.leafNodeId === "lB")!;
    expect(pathB.multiplier).toBe(2);
  });
});

// ─── ScoreResult shape ────────────────────────────────────────────────────────

describe("ScoreResult shape", () => {
  it("each path includes leafNodeId, pipTotal, multiplier, contribution", () => {
    const root = node("r", tile(1, 2), null, null);
    const result = computeScore(stateFrom(root), cfg);
    const p = result.paths[0]!;
    expect(typeof p.leafNodeId).toBe("string");
    expect(typeof p.pipTotal).toBe("number");
    expect(typeof p.multiplier).toBe("number");
    expect(typeof p.contribution).toBe("number");
  });

  it("contribution equals pipTotal * multiplier", () => {
    const root = node("r", tile(2, 3), null, null);
    const dbl = node("d", tile(3, 3), "r", "a");
    const leaf = node("l", tile(3, 4), "d", "a");
    const result = computeScore(stateFrom(root, dbl, leaf), cfg);
    for (const p of result.paths) {
      expect(p.contribution).toBe(p.pipTotal * p.multiplier);
    }
  });

  it("totalScore equals sum of all contributions", () => {
    const root = node("r", tile(2, 3), null, null);
    const A = node("A", tile(1, 2), "r", "b");
    const B = node("B", tile(1, 3), "r", "b");
    const result = computeScore(stateFrom(root, A, B), cfg);
    const summedTotal = result.paths.reduce((s, p) => s + p.contribution, 0);
    expect(result.totalScore).toBe(summedTotal);
  });
});
