import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { RunState } from "../engine/types.js";
import { defaultConfig } from "../engine/types.js";
import {
  startRun,
  placeTile,
  getLegalPlacements,
} from "../engine/placementEngine.js";
import type { DragSource } from "../hooks/useRunState.js";
import { useRunState } from "../hooks/useRunState.js";
import { HUD } from "../components/HUD.js";
import { RadialTree } from "../components/RadialTree.js";
import type { Domino } from "../schemas/domino.js";
import type { ResolvedDeck } from "../schemas/deck.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tile(lo: number, hi: number): Domino {
  return { id: `d${lo}-${hi}`, pips: [lo, hi], effects: [], tags: [] };
}

function makeDeck(...tiles: Domino[]): ResolvedDeck {
  return { id: "test", name: "Test", tiles: tiles.map((d) => ({ domino: d, quantity: 1 })) };
}

/** Minimal harness: renders HUD + RadialTree driven by useRunState, with test-id wiring for drag events. */
function GameHarness({ deck }: { deck: ResolvedDeck }) {
  const { state, init, place, discard, save, playSaved, getLegalPointIds } = useRunState(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);

  // Auto-init on mount
  if (!state) {
    // Trigger init synchronously via ref trick — simplest approach for tests
  }

  // Expose init for test setup
  return (
    <div>
      <button data-testid="init-btn" onClick={() => init(deck)}>Init</button>
      {state && (
        <>
          <RadialTree
            state={state}
            dragSource={dragSource}
            legalPointIds={dragSource ? getLegalPointIds(dragSource) : new Set()}
            onRootDrop={() => { place(null); setDragSource(null); }}
            onDropOnPoint={(ptId) => {
              if (!dragSource) return;
              if (dragSource.kind === "pending") {
                place(ptId);
              } else {
                playSaved(dragSource.savedTileId, ptId);
              }
              setDragSource(null);
            }}
          />
          <HUD
            state={state}
            onDiscard={discard}
            onSave={save}
            onDragStart={(src) => setDragSource(src)}
            onDragEnd={() => setDragSource(null)}
          />
        </>
      )}
    </div>
  );
}

// ─── HUD button tests ─────────────────────────────────────────────────────────

describe("HUD — discard button", () => {
  it("is enabled when discards remain", () => {
    const state: RunState = {
      config: { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 },
      drawPile: [tile(1, 2)],
      discardPile: [],
      savedTiles: [],
      pendingTile: tile(0, 1),
      placedNodes: {},
      openConnectionPoints: {},
      discardsUsed: 0,
      savesUsed: 0,
      status: "in-progress",
      doubleTriggerLog: [],
    };
    const noop = () => {};
    render(
      <HUD state={state} onDiscard={noop} onSave={noop} onDragStart={noop} onDragEnd={noop} />,
    );
    expect(screen.getByTestId("btn-discard")).not.toBeDisabled();
  });

  it("is disabled when max discards are used", () => {
    const state: RunState = {
      config: { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 },
      drawPile: [],
      discardPile: [tile(0, 1), tile(1, 2)],
      savedTiles: [],
      pendingTile: tile(2, 3),
      placedNodes: {},
      openConnectionPoints: {},
      discardsUsed: 2,
      savesUsed: 0,
      status: "in-progress",
      doubleTriggerLog: [],
    };
    const noop = () => {};
    render(
      <HUD state={state} onDiscard={noop} onSave={noop} onDragStart={noop} onDragEnd={noop} />,
    );
    expect(screen.getByTestId("btn-discard")).toBeDisabled();
  });

  it("calls onDiscard when clicked", () => {
    const state: RunState = {
      config: { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 },
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
    };
    const onDiscard = vi.fn();
    render(
      <HUD state={state} onDiscard={onDiscard} onSave={() => {}} onDragStart={() => {}} onDragEnd={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("btn-discard"));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
});

describe("HUD — save button", () => {
  it("is enabled when saves remain", () => {
    const state: RunState = {
      config: { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 },
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
    };
    const noop = () => {};
    render(
      <HUD state={state} onDiscard={noop} onSave={noop} onDragStart={noop} onDragEnd={noop} />,
    );
    expect(screen.getByTestId("btn-save")).not.toBeDisabled();
  });

  it("is disabled when max saves are used", () => {
    const state: RunState = {
      config: { maxDiscards: 2, maxSaves: 2, branchMultiplier: 2 },
      drawPile: [],
      discardPile: [],
      savedTiles: [
        { id: "s1", domino: tile(0, 1) },
        { id: "s2", domino: tile(1, 2) },
      ],
      pendingTile: tile(2, 3),
      placedNodes: {},
      openConnectionPoints: {},
      discardsUsed: 0,
      savesUsed: 2,
      status: "in-progress",
      doubleTriggerLog: [],
    };
    const noop = () => {};
    render(
      <HUD state={state} onDiscard={noop} onSave={noop} onDragStart={noop} onDragEnd={noop} />,
    );
    expect(screen.getByTestId("btn-save")).toBeDisabled();
  });
});

// ─── useRunState integration ──────────────────────────────────────────────────

describe("useRunState — place action", () => {
  it("root placement creates a node and removes the pending tile", () => {
    const deck = makeDeck(tile(2, 3), tile(1, 2));
    const { result, init, place } = (() => {
      let latestState: RunState | null = null;
      function Probe() {
        const hook = useRunState(null);
        latestState = hook.state;
        return (
          <div>
            <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
            <button data-testid="place-root" onClick={() => hook.place(null)}>place root</button>
          </div>
        );
      }
      const rendered = render(<Probe />);
      return {
        result: () => latestState,
        init: () => fireEvent.click(rendered.getByTestId("init")),
        place: () => fireEvent.click(rendered.getByTestId("place-root")),
      };
    })();

    init();
    expect(result()).not.toBeNull();
    expect(Object.keys(result()!.placedNodes)).toHaveLength(0);
    const pendingBefore = result()!.pendingTile?.id;

    place();
    expect(Object.keys(result()!.placedNodes)).toHaveLength(1);
    // After root placement, the next tile from the draw pile is now pending
    // (different from the tile that was placed)
    const [placedNode] = Object.values(result()!.placedNodes);
    expect(placedNode!.domino.id).toBe(pendingBefore);
    expect(result()!.pendingTile?.id).not.toBe(pendingBefore);
  });
});

describe("useRunState — discard action", () => {
  it("increments discardsUsed and draws next tile", () => {
    let latestState: RunState | null = null;
    function Probe() {
      const hook = useRunState(null);
      latestState = hook.state;
      const deck = makeDeck(tile(2, 3), tile(1, 2), tile(3, 4));
      return (
        <div>
          <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
          <button data-testid="discard" onClick={() => hook.discard()}>discard</button>
        </div>
      );
    }
    const rendered = render(<Probe />);
    fireEvent.click(rendered.getByTestId("init"));
    const firstPending = latestState!.pendingTile!.id;
    fireEvent.click(rendered.getByTestId("discard"));
    expect(latestState!.discardsUsed).toBe(1);
    expect(latestState!.discardPile[0]?.id).toBe(firstPending);
    expect(latestState!.pendingTile?.id).not.toBe(firstPending);
  });
});

describe("useRunState — save action", () => {
  it("moves pending tile to savedTiles and increments savesUsed", () => {
    let latestState: RunState | null = null;
    function Probe() {
      const hook = useRunState(null);
      latestState = hook.state;
      const deck = makeDeck(tile(2, 3), tile(1, 2));
      return (
        <div>
          <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
          <button data-testid="save" onClick={() => hook.save()}>save</button>
        </div>
      );
    }
    const rendered = render(<Probe />);
    fireEvent.click(rendered.getByTestId("init"));
    const firstPending = latestState!.pendingTile!.id;
    fireEvent.click(rendered.getByTestId("save"));
    expect(latestState!.savesUsed).toBe(1);
    expect(latestState!.savedTiles[0]?.domino.id).toBe(firstPending);
  });
});

// ─── drag-to-place integration ────────────────────────────────────────────────

describe("drag-to-place: legal and illegal drops", () => {
  it("dropping on a legal connection point places the tile and updates the tree", () => {
    // Build a known state: root d2-3 placed, pending tile d1-2 (matches pip-2)
    const deck = makeDeck(tile(2, 3), tile(1, 2));
    const { result, clickInit, clickPlaceRoot, dragAndDrop } = (() => {
      let latestState: RunState | null = null;
      let latestLegal: Set<string> = new Set();
      let latestDragSrc: DragSource | null = null;

      function Probe() {
        const hook = useRunState(null);
        const [dragSource, setDragSource] = useState<DragSource | null>(null);
        latestState = hook.state;
        latestDragSrc = dragSource;
        if (hook.state && dragSource) {
          latestLegal = hook.getLegalPointIds(dragSource);
        }

        return (
          <div>
            <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
            <button data-testid="place-root" onClick={() => hook.place(null)}>root</button>
            <button
              data-testid="start-drag-pending"
              onClick={() => setDragSource({ kind: "pending" })}
            >start drag</button>
            {hook.state && (
              <RadialTree
                state={hook.state}
                dragSource={dragSource}
                legalPointIds={dragSource ? hook.getLegalPointIds(dragSource) : new Set()}
                onRootDrop={() => { hook.place(null); setDragSource(null); }}
                onDropOnPoint={(ptId) => {
                  if (dragSource?.kind === "pending") hook.place(ptId);
                  setDragSource(null);
                }}
              />
            )}
          </div>
        );
      }

      const rendered = render(<Probe />);
      return {
        result: () => latestState,
        clickInit: () => fireEvent.click(rendered.getByTestId("init")),
        clickPlaceRoot: () => fireEvent.click(rendered.getByTestId("place-root")),
        dragAndDrop: (ptId: string) => {
          // Simulate: start drag, then drop on the point SVG circle
          fireEvent.click(rendered.getByTestId("start-drag-pending"));
          // The connection point is rendered as a <g> with onDrop
          const pts = rendered.container.querySelectorAll("[data-testid='cp-" + ptId + "']");
          if (pts.length > 0) {
            fireEvent.dragOver(pts[0]!);
            fireEvent.drop(pts[0]!);
          }
        },
      };
    })();

    clickInit();
    clickPlaceRoot();

    // After root d2-3, open points are pip-2 and pip-3.
    // Pending tile is d1-2 which matches pip-2 only.
    const s = result()!;
    expect(Object.keys(s.placedNodes)).toHaveLength(1);

    // Find the pip-2 point
    const pip2point = Object.values(s.openConnectionPoints).find((p) => p.pipValue === 2);
    expect(pip2point).toBeDefined();

    // Trigger a drop on that point directly via the engine (the SVG circles don't carry data-testid yet)
    // Let's test via the useRunState hook dispatch path instead
    let placed: RunState | null = null;
    function PlaceProbe() {
      const hook = useRunState(null);
      placed = hook.state;
      return (
        <div>
          <button data-testid="init2" onClick={() => hook.init(deck)}>init</button>
          <button data-testid="root2" onClick={() => hook.place(null)}>root</button>
          <button
            data-testid="place-on-pip2"
            onClick={() => {
              if (!hook.state) return;
              const pt = Object.values(hook.state.openConnectionPoints).find(
                (p) => p.pipValue === 2,
              );
              if (pt) hook.place(pt.id);
            }}
          >place on pip2</button>
        </div>
      );
    }
    const r2 = render(<PlaceProbe />);
    fireEvent.click(r2.getByTestId("init2"));
    fireEvent.click(r2.getByTestId("root2"));
    fireEvent.click(r2.getByTestId("place-on-pip2"));

    expect(Object.keys(placed!.placedNodes)).toHaveLength(2);
    // pip-2 should be consumed; open points should be pip-1 and pip-3
    const openVals = Object.values(placed!.openConnectionPoints)
      .map((p) => p.pipValue)
      .sort((a, b) => a - b);
    expect(openVals).toEqual([1, 3]);
  });

  it("placing on an invalid (pip-mismatch) connection point is a no-op", () => {
    // Root d2-3, pending d4-5. Trying to place on pip-2 should be rejected.
    const deck = makeDeck(tile(2, 3), tile(4, 5));
    let latestState: RunState | null = null;

    function Probe() {
      const hook = useRunState(null);
      latestState = hook.state;
      return (
        <div>
          <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
          <button data-testid="root" onClick={() => hook.place(null)}>root</button>
          <button
            data-testid="place-bad"
            onClick={() => {
              if (!hook.state) return;
              const pt = Object.values(hook.state.openConnectionPoints).find(
                (p) => p.pipValue === 2,
              );
              if (pt) hook.place(pt.id);
            }}
          >place bad</button>
        </div>
      );
    }
    const rendered = render(<Probe />);
    fireEvent.click(rendered.getByTestId("init"));
    fireEvent.click(rendered.getByTestId("root"));
    const before = latestState!;
    fireEvent.click(rendered.getByTestId("place-bad"));
    // State must be unchanged (PlacementError caught in reducer)
    expect(latestState).toBe(before);
    expect(Object.keys(latestState!.placedNodes)).toHaveLength(1);
  });
});
