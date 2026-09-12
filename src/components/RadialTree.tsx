import { useMemo, useRef, useState, useEffect } from "react";
import type { ReactNode } from "react";
import type { RunState, Direction } from "../engine/types.js";
import type { DragSource } from "../hooks/useRunState.js";
import { getTileTransform } from "../engine/tileTransform.js";
import { DominoTileSVG } from "./DominoTile.js";

const HALF_SIZE = 18; // halfSize passed to DominoTileSVG
const TILE_W = HALF_SIZE * 4; // 72 — long axis
const TILE_H = HALF_SIZE * 2; // 36 — short axis
const PADDING = 80;

// Maps incomingDirection to the layoutAngle convention used by getTileTransform
// (angle FROM center TO node; parent is at layoutAngle + π from the node).
function dirToLayoutAngle(dir: Direction): number {
  switch (dir) {
    case "right": return 0;
    case "left": return Math.PI;
    case "down": return Math.PI / 2;
    case "up": return -Math.PI / 2;
  }
}

interface RadialTreeProps {
  state: RunState;
  dragSource: DragSource | null;
  legalPointIds: Set<string>;
  onDropOnPoint: (pointId: string) => void;
  onRootDrop: () => void;
  animationOverlay?: ReactNode;
}

export function RadialTree({
  state,
  dragSource,
  legalPointIds,
  onDropOnPoint,
  onRootDrop,
  animationOverlay,
}: RadialTreeProps) {
  const nodes = Object.values(state.placedNodes);
  const points = Object.values(state.openConnectionPoints);
  const hasRoot = nodes.length > 0;
  const isDragging = dragSource !== null;

  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState({ scale: 1, panX: 0, panY: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panState = useRef({ active: false, startPx: { x: 0, y: 0 }, startPan: { x: 0, y: 0 } });
  const targetZoomRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Compute viewBox bounding box from placed tiles and open points.
  const { vbX, vbY, vbW, vbH } = useMemo(() => {
    let minX = -TILE_W / 2 - PADDING;
    let minY = -TILE_H / 2 - PADDING;
    let maxX = TILE_W / 2 + PADDING;
    let maxY = TILE_H / 2 + PADDING;

    for (const node of nodes) {
      const hw = node.orientation === "horizontal" ? TILE_W / 2 : TILE_H / 2;
      const hh = node.orientation === "horizontal" ? TILE_H / 2 : TILE_W / 2;
      minX = Math.min(minX, node.position.x - hw - PADDING);
      minY = Math.min(minY, node.position.y - hh - PADDING);
      maxX = Math.max(maxX, node.position.x + hw + PADDING);
      maxY = Math.max(maxY, node.position.y + hh + PADDING);
    }
    for (const pt of points) {
      minX = Math.min(minX, pt.position.x - 24 - PADDING / 2);
      minY = Math.min(minY, pt.position.y - 24 - PADDING / 2);
      maxX = Math.max(maxX, pt.position.x + 24 + PADDING / 2);
      maxY = Math.max(maxY, pt.position.y + 24 + PADDING / 2);
    }

    return { vbX: minX, vbY: minY, vbW: maxX - minX, vbH: maxY - minY };
  }, [state]);

  // Mirror natural bounds into ref so stable window handlers can read fresh values.
  const vbRef = useRef({ vbX, vbY, vbW, vbH });
  vbRef.current = { vbX, vbY, vbW, vbH };

  // Apply zoom/pan on top of the natural viewBox.
  const zoomedW = vbW / zoom.scale;
  const zoomedH = vbH / zoom.scale;
  const cx = vbX + vbW / 2 + zoom.panX;
  const cy = vbY + vbH / 2 + zoom.panY;
  const finalVb = `${cx - zoomedW / 2} ${cy - zoomedH / 2} ${zoomedW} ${zoomedH}`;

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!panState.current.active || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const { vbW: bw, vbH: bh } = vbRef.current;
      const { scale } = zoomRef.current;
      const dx = ((e.clientX - panState.current.startPx.x) * (bw / scale)) / rect.width;
      const dy = ((e.clientY - panState.current.startPx.y) * (bh / scale)) / rect.height;
      setZoom({ scale, panX: panState.current.startPan.x - dx, panY: panState.current.startPan.y - dy });
    }
    function onMouseUp() {
      panState.current.active = false;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  function animateToTarget() {
    const cur = zoomRef.current;
    const tgt = targetZoomRef.current;
    const t = 0.14;
    const newScale = cur.scale + (tgt.scale - cur.scale) * t;
    const newPanX = cur.panX + (tgt.panX - cur.panX) * t;
    const newPanY = cur.panY + (tgt.panY - cur.panY) * t;
    const done =
      Math.abs(newScale - tgt.scale) < 0.0005 &&
      Math.abs(newPanX - tgt.panX) < 0.05 &&
      Math.abs(newPanY - tgt.panY) < 0.05;
    setZoom(done ? tgt : { scale: newScale, panX: newPanX, panY: newPanY });
    animFrameRef.current = done ? null : requestAnimationFrame(animateToTarget);
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const { vbX: bx, vbY: by, vbW: bw, vbH: bh } = vbRef.current;
    const { scale, panX, panY } = zoomRef.current;
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const curW = bw / scale;
    const curH = bh / scale;
    const curCx = bx + bw / 2 + panX;
    const curCy = by + bh / 2 + panY;
    const svgPx = curCx - curW / 2 + nx * curW;
    const svgPy = curCy - curH / 2 + ny * curH;
    const newScale = Math.min(10, Math.max(0.2, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const newW = bw / newScale;
    const newH = bh / newScale;
    const newCx = svgPx - nx * newW + newW / 2;
    const newCy = svgPy - ny * newH + newH / 2;
    targetZoomRef.current = { scale: newScale, panX: newCx - (bx + bw / 2), panY: newCy - (by + bh / 2) };
    if (!animFrameRef.current) animFrameRef.current = requestAnimationFrame(animateToTarget);
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0 || dragSource !== null) return;
    panState.current = {
      active: true,
      startPx: { x: e.clientX, y: e.clientY },
      startPan: { x: zoom.panX, y: zoom.panY },
    };
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100%"
      viewBox={finalVb}
      preserveAspectRatio="xMidYMid meet"
      style={{ flex: 1, minWidth: 0, background: "#1e2a3a", borderRadius: 8, cursor: isDragging ? "default" : "grab" }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => {
        targetZoomRef.current = { scale: 1, panX: 0, panY: 0 };
        if (!animFrameRef.current) animFrameRef.current = requestAnimationFrame(animateToTarget);
      }}
    >
      <defs>
        <filter id="start-glow" x="-50%" y="-80%" width="200%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      {/* Starting tile glow */}
      {nodes
        .filter((n) => n.incomingDirection === null)
        .map((n) => (
          <ellipse
            key={`glow-${n.id}`}
            cx={n.position.x}
            cy={n.position.y}
            rx={TILE_W / 2 + 8}
            ry={TILE_H / 2 + 8}
            fill="rgba(255, 183, 77, 0.28)"
            filter="url(#start-glow)"
          />
        ))}

      {/* Root placeholder / drop zone */}
      {!hasRoot && (
        <g
          style={{ cursor: isDragging && (dragSource?.kind === "pending" || dragSource?.kind === "hand") ? "copy" : "default" }}
          onDragOver={(e) => {
            if (dragSource?.kind === "pending" || dragSource?.kind === "hand") e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragSource?.kind === "pending" || dragSource?.kind === "hand") onRootDrop();
          }}
        >
          <rect
            x={-TILE_W / 2 - 6}
            y={-TILE_H / 2 - 6}
            width={TILE_W + 12}
            height={TILE_H + 12}
            rx={8}
            fill={isDragging && (dragSource?.kind === "pending" || dragSource?.kind === "hand") ? "rgba(76,175,80,0.12)" : "none"}
            stroke={isDragging && (dragSource?.kind === "pending" || dragSource?.kind === "hand") ? "#4caf50" : "#3a5070"}
            strokeWidth={2}
            strokeDasharray="6 3"
          />
          {!isDragging && (
            <text x={0} y={5} textAnchor="middle" fontSize={10} fill="#3a5070">
              drag tile here
            </text>
          )}
          {isDragging && (dragSource?.kind === "pending" || dragSource?.kind === "hand") && (
            <text x={0} y={5} textAnchor="middle" fontSize={10} fill="#4caf50">
              drop to start
            </text>
          )}
        </g>
      )}

      {/* Placed tiles */}
      {nodes.map((node) => {
        const isDbl = node.domino.pips[0] === node.domino.pips[1];
        let angle: number;

        if (node.incomingDirection === null) {
          angle = 0;
        } else if (isDbl) {
          // Doubles are rendered perpendicular to the chain direction.
          angle =
            node.incomingDirection === "left" || node.incomingDirection === "right"
              ? Math.PI / 2
              : 0;
        } else {
          const { rotation } = getTileTransform(
            node,
            dirToLayoutAngle(node.incomingDirection),
          );
          angle = rotation;
        }

        return (
          <DominoTileSVG
            key={node.id}
            domino={node.domino}
            x={node.position.x}
            y={node.position.y}
            halfSize={HALF_SIZE}
            angle={angle}
          />
        );
      })}

      {/* Animation overlay — same SVG coordinate space */}
      {animationOverlay}

      {/* Open connection point drop targets — only visible when dragging from hand */}
      {dragSource?.kind === "hand" && points.map((pt) => {
        const isLegal = legalPointIds.has(pt.id);
        const fill = !isDragging
          ? "#1a2e42"
          : isLegal
            ? "rgba(76,175,80,0.2)"
            : "rgba(239,83,80,0.1)";
        const stroke = !isDragging
          ? "#3a5070"
          : isLegal
            ? "#4caf50"
            : "#ef5350";
        const opacity = isDragging && !isLegal ? 0.35 : 1;

        return (
          <g
            key={pt.id}
            style={{ cursor: isDragging && isLegal ? "copy" : "default" }}
            onDragOver={(e) => {
              if (isLegal) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (isLegal) onDropOnPoint(pt.id);
            }}
          >
            <circle
              cx={pt.position.x}
              cy={pt.position.y}
              r={16}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
              opacity={opacity}
            />
            <text
              x={pt.position.x}
              y={pt.position.y + 5}
              textAnchor="middle"
              fontSize={13}
              fontWeight="600"
              fill={isDragging && isLegal ? "#4caf50" : "#5a7898"}
              pointerEvents="none"
            >
              {pt.pipValue}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
