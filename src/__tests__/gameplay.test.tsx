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

/** Minimal harness: renders HUD + RadialTree driven by useRunState. */
function GameHarness({ deck }: { deck: ResolvedDeck }) {
  const { state, init, place, discard, save, playSaved, getLegalPointIds } = useRunState(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);

  return (
    <div>
      <button data-testid="init-btn" onClick={() => init(deck)}>Init</button>
      {state && (
        <>
          <RadialTree
            state={state}
            dragSource={dragSource}
            legalPointIds={dragSource ? getLegalPointIds(dragSource) : new Set()}
          />
          <HUD
            state={state}
            onDiscard={discard}
            onSave={save}
            onReroll={() => {}}
            onDragStart={(src, e) => setDragSource(src)}
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
      <HUD state={state} onDiscard={noop} onSave={noop} onReroll={noop} onDragStart={noop as never} />,
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
      <HUD state={state} onDiscard={noop} onSave={noop} onReroll={noop} onDragStart={noop as never} />,
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
      <HUD state={state} onDiscard={onDiscard} onSave={() => {}} onReroll={() => {}} onDragStart={() => {}} />,
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
      <HUD state={state} onDiscard={noop} onSave={noop} onReroll={noop} onDragStart={noop as never} />,
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
      <HUD state={state} onDiscard={noop} onSave={noop} onReroll={noop} onDragStart={noop as never} />,
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
    const deck = makeDeck(tile(2, 3), tile(1, 2));
    const { result, clickInit, clickPlaceRoot } = (() => {
      let latestState: RunState | null = null;

      function Probe() {
        const hook = useRunState(null);
        latestState = hook.state;

        return (
          <div>
            <button data-testid="init" onClick={() => hook.init(deck)}>init</button>
            <button data-testid="place-root" onClick={() => hook.place(null)}>root</button>
            {hook.state && (
              <RadialTree
                state={hook.state}
                dragSource={null}
                legalPointIds={new Set()}
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
      };
    })();

    clickInit();
    clickPlaceRoot();

    const s = result()!;
    expect(Object.keys(s.placedNodes)).toHaveLength(1);

    const pip2point = Object.values(s.openConnectionPoints).find((p) => p.pipValue === 2);
    expect(pip2point).toBeDefined();

    // Test placement via the engine hook directly
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
    const openVals = Object.values(placed!.openConnectionPoints)
      .map((p) => p.pipValue)
      .sort((a, b) => a - b);
    expect(openVals).toEqual([1, 3]);
  });

  it("placing on an invalid (pip-mismatch) connection point is a no-op", () => {
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
    expect(latestState).toBe(before);
    expect(Object.keys(latestState!.placedNodes)).toHaveLength(1);
  });
});
