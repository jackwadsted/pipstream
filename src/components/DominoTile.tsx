import type { Domino } from "../schemas/domino.js";

// pip dot positions in a 3x3 grid (row-major, indices 0..8)
const PIP_POSITIONS: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface PipGridSVGProps {
  value: number;
  cx: number;
  cy: number;
  halfSize: number;
}

function PipGridSVG({ value, cx, cy, halfSize }: PipGridSVGProps) {
  const positions = PIP_POSITIONS[value] ?? [];
  const pad = halfSize * 0.15;
  const inner = halfSize * 2 - pad * 2;
  const cellSize = inner / 3;
  const dotR = cellSize * 0.28;

  return (
    <>
      {positions.map((idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const dotX = cx - halfSize + pad + cellSize * col + cellSize / 2;
        const dotY = cy - halfSize + pad + cellSize * row + cellSize / 2;
        return <circle key={idx} cx={dotX} cy={dotY} r={dotR} fill="#1a1a2e" />;
      })}
    </>
  );
}

interface DominoTileSVGProps {
  domino: Domino;
  x: number;
  y: number;
  halfSize?: number;
  /** Rotation angle in radians — applied around (x, y) */
  angle?: number;
}

/** SVG domino for use inside the radial tree. Centered at (x, y). */
export function DominoTileSVG({
  domino,
  x,
  y,
  halfSize = 18,
  angle = 0,
}: DominoTileSVGProps) {
  const w = halfSize * 4;
  const h = halfSize * 2;
  const deg = (angle * 180) / Math.PI;

  return (
    <g transform={`rotate(${deg}, ${x}, ${y})`}>
      {/* outer border */}
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={halfSize * 0.2}
        fill="#f8f8ff"
        stroke="#333"
        strokeWidth={1.5}
      />
      {/* divider */}
      <line
        x1={x}
        y1={y - h / 2 + 2}
        x2={x}
        y2={y + h / 2 - 2}
        stroke="#333"
        strokeWidth={1}
      />
      <PipGridSVG value={domino.pips[0]} cx={x - halfSize} cy={y} halfSize={halfSize} />
      <PipGridSVG value={domino.pips[1]} cx={x + halfSize} cy={y} halfSize={halfSize} />
    </g>
  );
}

// ─── HTML variant (HUD / pending tile display) ────────────────────────────────

interface PipGridHTMLProps {
  value: number;
  size: number;
}

function PipGridHTML({ value, size }: PipGridHTMLProps) {
  const positions = PIP_POSITIONS[value] ?? [];
  const pad = size * 0.1;
  const inner = size - pad * 2;
  const cellSize = inner / 3;
  const dotR = cellSize * 0.28;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {positions.map((idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const cx = pad + cellSize * col + cellSize / 2;
        const cy = pad + cellSize * row + cellSize / 2;
        return <circle key={idx} cx={cx} cy={cy} r={dotR} fill="#1a1a2e" />;
      })}
    </svg>
  );
}

interface DominoTileHTMLProps {
  domino: Domino;
  size?: number;
  /** If true, add draggable props */
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragEnd?: React.DragEventHandler<HTMLDivElement>;
  style?: React.CSSProperties;
}

export function DominoTileHTML({
  domino,
  size = 52,
  draggable,
  onDragStart,
  onDragEnd,
  style,
}: DominoTileHTMLProps) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid={`domino-${domino.id}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "#f8f8ff",
        border: "2px solid #333",
        borderRadius: 6,
        cursor: draggable ? "grab" : "default",
        userSelect: "none",
        ...style,
      }}
    >
      <PipGridHTML value={domino.pips[0]} size={size} />
      <div style={{ width: 2, alignSelf: "stretch", background: "#333" }} />
      <PipGridHTML value={domino.pips[1]} size={size} />
    </div>
  );
}
