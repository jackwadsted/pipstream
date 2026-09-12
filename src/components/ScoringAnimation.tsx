import { useMemo, useState, useEffect, useRef } from "react";
import type { RunState, PlacedNode } from "../engine/types.js";
import { getTileTransform } from "../engine/tileTransform.js";

const TILE_W = 72;
const TILE_H = 36;

const KEYFRAMES_CSS = `
  @keyframes ps-glow-pulse {
    0%, 100% { opacity: 0.65; }
    50%       { opacity: 1; }
  }
  @keyframes ps-pip-float {
    0%   { transform: translateY(0px);   opacity: 1; }
    70%  { transform: translateY(-28px); opacity: 0.9; }
    100% { transform: translateY(-44px); opacity: 0; }
  }
  @keyframes ps-multiplier-pop {
    0%   { transform: scale(0);    opacity: 0; }
    55%  { transform: scale(1.3);  opacity: 1; }
    75%  { transform: scale(0.9);  opacity: 1; }
    100% { transform: scale(1);    opacity: 1; }
  }
  @keyframes ps-visited-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipAddition {
  nodeId: string;
  pips: number;
  x: number;
  y: number;
}

interface MultiplierBadgeData {
  nodeId: string;
  x: number;
  y: number;
  multiplier: number;
}

interface AnimationMoment {
  kind: "visit" | "multiplier" | "done";
  activeNodeIds: string[];
  visitedNodeIds: string[];
  runningTotal: number;
  pipAdditions: PipAddition[];
  multiplierBadge?: MultiplierBadgeData;
  currentMultiplier: number;
  durationMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildChildrenMap(nodes: Record<string, PlacedNode>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    if (!map.has(node.id)) map.set(node.id, []);
    if (node.parentNodeId) {
      if (!map.has(node.parentNodeId)) map.set(node.parentNodeId, []);
      map.get(node.parentNodeId)!.push(node.id);
    }
  }
  return map;
}

function getVisitDuration(depth: number): number {
  return Math.round(Math.max(220, 700 * Math.exp(-0.10 * depth)));
}

function buildMoments(state: RunState): AnimationMoment[] {
  const { placedNodes, config } = state;
  const root = Object.values(placedNodes).find((n) => n.parentNodeId === null);
  if (!root) {
    return [{ kind: "done", activeNodeIds: [], visitedNodeIds: [], runningTotal: 0, pipAdditions: [], currentMultiplier: 1, durationMs: 0 }];
  }

  const childrenMap = buildChildrenMap(placedNodes);
  const moments: AnimationMoment[] = [];
  const visitedSoFar: string[] = [];
  let runningTotal = 0;
  let cumulativeMultiplier = 1;
  let frontier = [root.id];
  let depth = 0;

  while (frontier.length > 0) {
    const duration = getVisitDuration(depth);

    const pipAdditions: PipAddition[] = frontier.map((id) => {
      const n = placedNodes[id]!;
      return { nodeId: id, pips: n.domino.pips[0] + n.domino.pips[1], x: n.position.x, y: n.position.y };
    });
    runningTotal += pipAdditions.reduce((s, p) => s + p.pips, 0) * cumulativeMultiplier;
    visitedSoFar.push(...frontier);

    moments.push({
      kind: "visit",
      activeNodeIds: [...frontier],
      visitedNodeIds: [...visitedSoFar],
      runningTotal,
      pipAdditions,
      currentMultiplier: cumulativeMultiplier,
      durationMs: duration,
    });

    for (const id of frontier) {
      const n = placedNodes[id]!;
      const children = childrenMap.get(id) ?? [];
      if (n.domino.pips[0] === n.domino.pips[1] && children.length > 0) {
        cumulativeMultiplier *= config.branchMultiplier;
        moments.push({
          kind: "multiplier",
          activeNodeIds: [id],
          visitedNodeIds: [...visitedSoFar],
          runningTotal,
          pipAdditions: [],
          multiplierBadge: { nodeId: id, x: n.position.x, y: n.position.y, multiplier: cumulativeMultiplier },
          currentMultiplier: cumulativeMultiplier,
          durationMs: 520,
        });
      }
    }

    frontier = frontier.flatMap((id) => childrenMap.get(id) ?? []);
    depth++;
  }

  moments.push({
    kind: "done",
    activeNodeIds: [],
    visitedNodeIds: [...visitedSoFar],
    runningTotal,
    pipAdditions: [],
    currentMultiplier: cumulativeMultiplier,
    durationMs: 700,
  });

  return moments;
}

function getNodeAngle(node: PlacedNode): number {
  const isDbl = node.domino.pips[0] === node.domino.pips[1];
  if (node.incomingDirection === null) return 0;
  if (isDbl) {
    return node.incomingDirection === "left" || node.incomingDirection === "right"
      ? Math.PI / 2
      : 0;
  }
  const layoutAngle: Record<string, number> = { right: 0, left: Math.PI, down: Math.PI / 2, up: -Math.PI / 2 };
  return getTileTransform(node, layoutAngle[node.incomingDirection]!).rotation;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VisitedOverlay({ node }: { node: PlacedNode }) {
  const deg = (getNodeAngle(node) * 180) / Math.PI;
  const hw = node.orientation === "horizontal" ? TILE_W / 2 : TILE_H / 2;
  const hh = node.orientation === "horizontal" ? TILE_H / 2 : TILE_W / 2;
  return (
    <g pointerEvents="none" transform={`rotate(${deg}, ${node.position.x}, ${node.position.y})`}>
      <rect
        x={node.position.x - hw}
        y={node.position.y - hh}
        width={hw * 2}
        height={hh * 2}
        rx={3.6}
        fill="rgba(0,0,0,0.52)"
        style={{
          animation: "ps-visited-fade 0.2s ease-out forwards",
          transformBox: "fill-box" as React.CSSProperties["transformBox"],
          transformOrigin: "center",
        }}
      />
    </g>
  );
}

function ActiveGlow({ node }: { node: PlacedNode }) {
  const deg = (getNodeAngle(node) * 180) / Math.PI;
  const hw = node.orientation === "horizontal" ? TILE_W / 2 : TILE_H / 2;
  const hh = node.orientation === "horizontal" ? TILE_H / 2 : TILE_W / 2;
  const pad = 6;
  return (
    <g pointerEvents="none" transform={`rotate(${deg}, ${node.position.x}, ${node.position.y})`}>
      <rect
        x={node.position.x - hw - pad}
        y={node.position.y - hh - pad}
        width={(hw + pad) * 2}
        height={(hh + pad) * 2}
        rx={8}
        fill="rgba(255,215,0,0.15)"
        stroke="#ffd700"
        strokeWidth={2.5}
        filter="url(#ps-glow)"
        style={{
          animation: "ps-glow-pulse 0.5s ease-in-out infinite",
          transformBox: "fill-box" as React.CSSProperties["transformBox"],
          transformOrigin: "center",
        }}
      />
    </g>
  );
}

function PipFloat({ pips, x, y, multiplier }: { pips: number; x: number; y: number; multiplier: number }) {
  const label = multiplier > 1 ? `+${pips} ×${multiplier}` : `+${pips}`;
  return (
    <text
      x={x}
      y={y - 24}
      textAnchor="middle"
      fontSize={15}
      fontWeight="800"
      fill="#ffd700"
      stroke="#1a1a2e"
      strokeWidth={0.8}
      paintOrder="stroke"
      pointerEvents="none"
      style={{
        animation: "ps-pip-float 0.6s ease-out forwards",
        transformBox: "fill-box" as React.CSSProperties["transformBox"],
        transformOrigin: "bottom center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {label}
    </text>
  );
}

function MultiplierBadge({ x, y, multiplier }: { x: number; y: number; multiplier: number }) {
  const bw = 50, bh = 26, oy = -56;
  return (
    <g
      style={{
        animation: "ps-multiplier-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        transformBox: "fill-box" as React.CSSProperties["transformBox"],
        transformOrigin: "center",
      }}
    >
      <rect
        x={x - bw / 2}
        y={y + oy - bh / 2}
        width={bw}
        height={bh}
        rx={bh / 2}
        fill="#ff6b35"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={1}
      />
      <text
        x={x}
        y={y + oy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={13}
        fontWeight="800"
        fill="#fff"
        pointerEvents="none"
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        ×{multiplier}
      </text>
    </g>
  );
}

function RunningTotal({
  total,
  multiplier,
  activeNodeIds,
  placedNodes,
}: {
  total: number;
  multiplier: number;
  activeNodeIds: string[];
  placedNodes: Record<string, PlacedNode>;
}) {
  const [displayed, setDisplayed] = useState(total);
  const animRef = useRef<number | null>(null);
  const prevTotalRef = useRef(total);

  useEffect(() => {
    const start = prevTotalRef.current;
    const end = total;
    prevTotalRef.current = end;
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    if (start === end) return;
    const duration = 280;
    const startTime = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const eased = t * (2 - t);
      setDisplayed(Math.round(start + (end - start) * eased));
      if (t < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        animRef.current = null;
      }
    };
    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [total]);

  const cx = activeNodeIds.reduce((s, id) => s + placedNodes[id]!.position.x, 0) / activeNodeIds.length;
  const cy = activeNodeIds.reduce((s, id) => s + placedNodes[id]!.position.y, 0) / activeNodeIds.length;
  const label = multiplier > 1 ? `${displayed} ×${multiplier}` : `${displayed}`;
  const lw = Math.max(56, label.length * 11 + 24);
  const lh = 28;
  const ly = cy + 38;
  return (
    <g pointerEvents="none">
      <rect
        x={cx - lw / 2}
        y={ly - lh / 2}
        width={lw}
        height={lh}
        rx={lh / 2}
        fill="rgba(20,20,38,0.9)"
        stroke={multiplier > 1 ? "rgba(255,107,53,0.6)" : "rgba(255,255,255,0.18)"}
        strokeWidth={multiplier > 1 ? 1.5 : 1}
      />
      <text
        x={cx}
        y={ly + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={14}
        fontWeight="700"
        fill="#fff"
        style={{ fontFamily: "system-ui, sans-serif", fontVariantNumeric: "tabular-nums" }}
      >
        {label}
      </text>
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScoringAnimation({ state, onDone }: { state: RunState; onDone: () => void }) {
  const moments = useMemo(() => buildMoments(state), [state]);
  const [idx, setIdx] = useState(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const m = moments[idx] ?? moments[moments.length - 1]!;

  useEffect(() => {
    const cb = m.kind === "done" ? () => onDoneRef.current() : () => setIdx((i) => i + 1);
    const t = setTimeout(cb, m.durationMs);
    return () => clearTimeout(t);
  }, [idx, moments]);

  if (!m || m.kind === "done") return null;

  const activeSet = new Set(m.activeNodeIds);

  return (
    <>
      <defs>
        <style>{KEYFRAMES_CSS}</style>
        <filter id="ps-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {m.visitedNodeIds
        .filter((id) => !activeSet.has(id))
        .map((id) => (
          <VisitedOverlay key={id} node={state.placedNodes[id]!} />
        ))}

      {m.activeNodeIds.map((id) => (
        <ActiveGlow key={`${id}-${idx}`} node={state.placedNodes[id]!} />
      ))}

      {m.pipAdditions.map(({ nodeId, pips, x, y }) => (
        <PipFloat key={`${nodeId}-${idx}`} pips={pips} x={x} y={y} multiplier={m.currentMultiplier} />
      ))}

      {m.multiplierBadge && (
        <MultiplierBadge
          key={`${m.multiplierBadge.nodeId}-${idx}`}
          {...m.multiplierBadge}
        />
      )}

      {m.activeNodeIds.length > 0 && (
        <RunningTotal
          total={m.runningTotal}
          multiplier={m.currentMultiplier}
          activeNodeIds={m.activeNodeIds}
          placedNodes={state.placedNodes}
        />
      )}
    </>
  );
}
