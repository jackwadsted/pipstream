import { describe, expect, it } from "vitest";
import type { PlacedNode } from "../engine/types.js";
import type { Domino } from "../schemas/domino.js";
import { getTileTransform } from "../engine/tileTransform.js";

function tile(lo: number, hi: number): Domino {
  return { id: `d${lo}-${hi}`, pips: [lo, hi], effects: [], tags: [] };
}

function node(connectedEnd: "a" | "b" | null): PlacedNode {
  return {
    id: "test",
    domino: tile(2, 3),
    connectedEnd,
    parentNodeId: connectedEnd === null ? null : "parent",
    openConnectionPointIds: [],
    position: { x: 0, y: 0 },
    orientation: "horizontal",
    incomingDirection: connectedEnd === null ? null : "right",
  };
}

describe("getTileTransform", () => {
  it("connectedEnd 'a': rotation = layoutAngle, not flipped", () => {
    const t = getTileTransform(node("a"), 1.2);
    expect(t.rotation).toBeCloseTo(1.2);
    expect(t.flipped).toBe(false);
  });

  it("connectedEnd 'b': rotation = layoutAngle + π, flipped=true", () => {
    const t = getTileTransform(node("b"), 1.2);
    expect(t.rotation).toBeCloseTo(1.2 + Math.PI);
    expect(t.flipped).toBe(true);
  });

  it("connectedEnd null (root): rotation = layoutAngle, not flipped", () => {
    const t = getTileTransform(node(null), 0);
    expect(t.rotation).toBeCloseTo(0);
    expect(t.flipped).toBe(false);
  });

  it("'b' end tile is flipped relative to 'a' end tile at the same layout angle", () => {
    const angle = 0.7;
    const ta = getTileTransform(node("a"), angle);
    const tb = getTileTransform(node("b"), angle);
    // The two rotations differ by exactly π
    expect(tb.rotation - ta.rotation).toBeCloseTo(Math.PI);
    expect(ta.flipped).toBe(false);
    expect(tb.flipped).toBe(true);
  });

  it("rotation angle is the layout angle passed through — not altered beyond the ±π flip", () => {
    // Verify at a variety of angles that the only difference between 'a' and 'b' is +π
    const angles = [0, 0.5, Math.PI / 4, Math.PI, -Math.PI / 3, 2.9];
    for (const angle of angles) {
      const ta = getTileTransform(node("a"), angle);
      const tb = getTileTransform(node("b"), angle);
      expect(ta.rotation).toBeCloseTo(angle);
      expect(tb.rotation).toBeCloseTo(angle + Math.PI);
    }
  });
});
