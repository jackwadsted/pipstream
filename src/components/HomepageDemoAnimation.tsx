import { useState, useEffect } from "react";
import type { RunState, PlacedNode } from "../engine/types.js";
import { defaultConfig } from "../engine/types.js";
import { DominoTileSVG } from "./DominoTile.js";
import { ScoringAnimation } from "./ScoringAnimation.js";

type Phase = "draw" | "place" | "score" | "done";

// ── Demo layout ────────────────────────────────────────────────────────────────
//
//   [1|5] ─── [5|5] ─── [5|4]  ← animated tile (placed during demo)
//               |
//             [5|6]
//
// [5|5] is a double → triggers ×2 multiplier badge during scoring.
// Draw phase shows n0/n1/n3. Place phase adds n2 from below.

const mk = (id: string, pips: [number, number]) => ({ id, pips, effects: [], tags: [] });

// Scoring chain: dn3 → dn0 → dn1 → dn2 (one tile per scoring moment, in placement order).
// dn3 is the BFS root; incomingDirection="down" is kept so getNodeAngle gives it a
// vertical glow (it reads incomingDirection, not parentNodeId).
const NODES: PlacedNode[] = [
  // [0] vertical tile — scored first; BFS root so it's visited at depth 0
  {
    id: "dn3", domino: mk("dd3", [5, 6]),
    connectedEnd: null, parentNodeId: null,
    openConnectionPointIds: [],
    position: { x: 170, y: 144 },
    orientation: "vertical", incomingDirection: "down",
  },
  // [1] double — scored second; ×2 multiplier fires here, carries to remaining tiles
  {
    id: "dn0", domino: mk("dd0", [5, 5]),
    connectedEnd: "a", parentNodeId: "dn3",
    openConnectionPointIds: [],
    position: { x: 170, y: 90 },
    orientation: "horizontal", incomingDirection: "up",
  },
  // [2] left tile — scored third (×2)
  {
    id: "dn1", domino: mk("dd1", [1, 5]),
    connectedEnd: "b", parentNodeId: "dn0",
    openConnectionPointIds: [],
    position: { x: 98, y: 90 },
    orientation: "horizontal", incomingDirection: "left",
  },
  // [3] animated tile — scored last (×2); placed during Place phase
  {
    id: "dn2", domino: mk("dd2", [5, 4]),
    connectedEnd: "a", parentNodeId: "dn1",
    openConnectionPointIds: [],
    position: { x: 242, y: 90 },
    orientation: "horizontal", incomingDirection: "right",
  },
];

// Rotation angles for DominoTileSVG (radians) matching NODES order above.
const NODE_ANGLES: number[] = [Math.PI / 2, 0, 0, 0];

const SCORE_STATE: RunState = {
  config: defaultConfig,
  drawPile: [],
  discardPile: [],
  savedTiles: [],
  pendingTile: null,
  placedNodes: Object.fromEntries(NODES.map((n) => [n.id, n])),
  openConnectionPoints: {},
  discardsUsed: 0,
  savesUsed: 0,
  status: "ended-deck-exhausted",
  doubleTriggerLog: [],
};

// ── Keyframes ──────────────────────────────────────────────────────────────────

const KEYFRAMES = `
  @keyframes demo-tile-appear {
    from { opacity: 0; transform: scale(0.82); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes demo-place-tile {
    0%   { transform: translateY(68px) scale(0.86); opacity: 0; }
    22%  { opacity: 1; }
    78%  { transform: translateY(-5px) scale(1.04); }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
`;

// ── Phase step indicator ───────────────────────────────────────────────────────

const STEPS = [
  { key: "draw" as Phase, label: "Draw", color: "#4f8ef7" },
  { key: "place" as Phase, label: "Place", color: "#a78bf7" },
  { key: "score" as Phase, label: "Score!", color: "#ffd700" },
];

function PhaseLabel({ phase }: { phase: Phase }) {
  const activeIdx = phase === "done" ? 2 : STEPS.findIndex((s) => s.key === phase);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "'IBM Plex Sans', 'Quantico', system-ui, sans-serif",
        letterSpacing: "0.04em",
        opacity: phase === "done" ? 0 : 1,
        transition: "opacity 0.4s",
      }}
    >
      {STEPS.map((s, i) => (
        <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && (
            <span style={{ color: "#3a3a5c", fontSize: 12, lineHeight: 1 }}>→</span>
          )}
          <span
            style={{
              fontSize: i === activeIdx ? 17 : 13,
              fontWeight: i === activeIdx ? 800 : 500,
              color: i === activeIdx ? s.color : "#444",
              transition: "font-size 0.3s, color 0.3s, font-weight 0.3s",
            }}
          >
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function HomepageDemoAnimation() {
  const [phase, setPhase] = useState<Phase>("draw");
  const [tileCount, setTileCount] = useState(0); // board tiles visible (0–3) during draw
  const [loopKey, setLoopKey] = useState(0);      // bumped each loop to remount animations

  // DRAW: stagger tiles in, then advance to place
  useEffect(() => {
    if (phase !== "draw") return;
    if (tileCount < 3) {
      const t = setTimeout(() => setTileCount((c) => c + 1), 360);
      return () => clearTimeout(t);
    }
    // All 3 board tiles visible — hold briefly then place
    const t = setTimeout(() => setPhase("place"), 850);
    return () => clearTimeout(t);
  }, [phase, tileCount]);

  // PLACE: tile animation runs for ~1s, then advance to score
  useEffect(() => {
    if (phase !== "place") return;
    const t = setTimeout(() => setPhase("score"), 1100);
    return () => clearTimeout(t);
  }, [phase]);

  // DONE: brief pause with fade-out, then restart loop
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => {
      setTileCount(0);
      setLoopKey((k) => k + 1);
      setPhase("draw");
    }, 850);
    return () => clearTimeout(t);
  }, [phase]);

  // Which tiles are shown on the board
  const showBoardTile = (i: number) => {
    if (phase === "draw") return i < tileCount;
    return true; // place / score / done
  };

  const showPlacedTile = phase === "place" || phase === "score" || phase === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>
      <style>{KEYFRAMES}</style>

      {/* Board SVG */}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          opacity: phase === "done" ? 0 : 1,
          transition: phase === "done" ? "opacity 0.45s ease-out" : "none",
        }}
      >
        <svg
          viewBox="0 0 340 195"
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          {/* Board tiles: root + left + right */}
          {NODES.slice(0, 3).map((n, i) =>
            showBoardTile(i) ? (
              <g
                key={`${n.id}-${loopKey}`}
                style={{
                  animation: "demo-tile-appear 0.38s ease-out both",
                  transformBox: "fill-box" as React.CSSProperties["transformBox"],
                  transformOrigin: "center",
                }}
              >
                <DominoTileSVG domino={n.domino} x={n.position.x} y={n.position.y} halfSize={18} angle={NODE_ANGLES[i] ?? 0} />
              </g>
            ) : null
          )}

          {/* Placed tile (n3): flies in from below during place phase */}
          {showPlacedTile && (
            <g
              key={`dn3-${loopKey}`}
              style={
                phase === "place"
                  ? {
                    animation: "demo-place-tile 0.92s cubic-bezier(0.2, 0.82, 0.38, 1) both",
                    transformBox: "fill-box" as React.CSSProperties["transformBox"],
                    transformOrigin: "center",
                  }
                  : {}
              }
            >
              <DominoTileSVG
                domino={NODES[3]!.domino}
                x={NODES[3]!.position.x}
                y={NODES[3]!.position.y}
                halfSize={18}
                angle={NODE_ANGLES[3] ?? 0}
              />
            </g>
          )}

          {/* Scoring overlay — only during score phase */}
          {phase === "score" && (
            <ScoringAnimation
              key={`score-${loopKey}`}
              state={SCORE_STATE}
              onDone={() => setPhase("done")}
            />
          )}
        </svg>
      </div>

      <PhaseLabel phase={phase} />
    </div>
  );
}
