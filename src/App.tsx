import { useState, useEffect, useRef, useMemo } from "react";
import type { DragSource } from "./hooks/useRunState.js";
import type { GameMode, RunState } from "./engine/types.js";
import type { ResolvedDeck } from "./schemas/deck.js";
import { useRunState } from "./hooks/useRunState.js";
import { loadDeckBrowser } from "./dataBundle.js";
import { RadialTree } from "./components/RadialTree.js";
import type { RadialTreeHandle } from "./components/RadialTree.js";
import { HUD } from "./components/HUD.js";
import { ScoreScreen } from "./components/ScoreScreen.js";
import { ScoringAnimation } from "./components/ScoringAnimation.js";
import { DominoTileHTML } from "./components/DominoTile.js";
import { computeScore } from "./engine/scoring.js";
import { useFullscreen } from "./hooks/useFullscreen.js";

const SNAP_RADIUS = 56;
// DominoTileHTML at size=44: two 44px pip grids + 2px divider
const GHOST_TILE_W = 90;
const GHOST_TILE_H = 44;

// Spring constants (positions and velocities in px/frame at ~60fps)
// Underdamped: spring stiffness=0.18, velocity retention=0.72 → ζ ≈ 0.75, slight overshoot on stops
const SPRING_K = 0.18;
const SPRING_DAMP = 0.72;
// Rotation: tilt based on horizontal pointer velocity; springs back to upright
const ROT_K = 0.12;
const ROT_DAMP = 0.75;
// Coast friction per frame (0.88^60 ≈ 0.05 → ~1s to near-stop)
const COAST_FRICTION = 0.88;

interface PhysState {
  mode: "idle" | "drag" | "coast";
  x: number; y: number;          // ghost top-left position (px)
  vx: number; vy: number;        // spring / coast velocity (px/frame)
  rot: number; rotVel: number;   // rotation (deg) and its velocity
  targetX: number; targetY: number;  // where the spring pulls toward
  ptrVx: number;                 // smoothed pointer horiz velocity (px/frame) — drives tilt
  isSnapping: boolean;
  coastStartT: number;           // performance.now() when coast began
}

export function App() {
  const { state, init, reset, place, discard, save, playSaved, playFromHand, reroll, getLegalPointIds } =
    useRunState(null);
  const { isFullscreen, toggle: toggleFullscreen, isSupported: fullscreenSupported } = useFullscreen();
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [deck, setDeck] = useState<ResolvedDeck | null>(null);
  const [animationDone, setAnimationDone] = useState(false);

  // Ghost tile — just visibility flags; position/rotation live in physRef and are DOM-applied by RAF
  const [ghostVisible, setGhostVisible] = useState(false);
  const [ghostDomino, setGhostDomino] = useState<RunState["pendingTile"]>(null);

  // Snap
  const [snapPointId, setSnapPointId] = useState<string | null>(null);

  // Refs
  const radialTreeRef = useRef<RadialTreeHandle>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const pickupOffsetRef = useRef({ x: 0, y: 0 });
  const physRef = useRef<PhysState>({
    mode: "idle", x: 0, y: 0, vx: 0, vy: 0, rot: 0, rotVel: 0,
    targetX: 0, targetY: 0, ptrVx: 0, isSnapping: false, coastStartT: 0,
  });
  const ptrLastRef = useRef({ x: 0, y: 0, t: 0 });

  // Stable closure mirrors
  const stateRef = useRef(state); stateRef.current = state;
  const dragSourceRef = useRef(dragSource); dragSourceRef.current = dragSource;
  const snapPointIdRef = useRef<string | null>(null); snapPointIdRef.current = snapPointId;
  const legalPointIds = dragSource ? getLegalPointIds(dragSource) : new Set<string>();
  const legalPointIdsRef = useRef(legalPointIds); legalPointIdsRef.current = legalPointIds;
  const actionsRef = useRef({ place, playSaved, playFromHand });
  actionsRef.current = { place, playSaved, playFromHand };

  useEffect(() => {
    setDeck(loadDeckBrowser("standard-double-six"));
  }, []);

  function handleStartRun(mode: GameMode) {
    if (deck) init(deck, mode);
  }

  const scoreResult = useMemo(() => {
    if (!state || state.status === "in-progress") return null;
    return computeScore(state, state.config);
  }, [state]);

  useEffect(() => {
    if (!scoreResult) setAnimationDone(false);
  }, [scoreResult]);

  const runEnded = !!scoreResult && !!state && state.status !== "in-progress";
  const isAnimating = runEnded && !animationDone;
  const showScoreScreen = runEnded && animationDone;

  // ── Physics RAF loop ──────────────────────────────────────────────────────────

  function startRaf() {
    if (rafRef.current !== null) return;

    function frame() {
      const ghost = ghostRef.current;
      const p = physRef.current;

      if (p.mode === "idle" || !ghost) {
        rafRef.current = null;
        return;
      }

      if (p.mode === "drag") {
        // Underdamped spring toward target
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        p.vx = p.vx * SPRING_DAMP + dx * SPRING_K;
        p.vy = p.vy * SPRING_DAMP + dy * SPRING_K;
        p.x += p.vx;
        p.y += p.vy;

        // Tilt: straighten on snap, lean into horizontal motion otherwise
        const targetRot = p.isSnapping ? 0 : Math.max(-14, Math.min(14, p.ptrVx * 4.5));
        p.rotVel = p.rotVel * ROT_DAMP + (targetRot - p.rot) * ROT_K;
        p.rot += p.rotVel;
      } else {
        // Coast: pure friction
        p.vx *= COAST_FRICTION;
        p.vy *= COAST_FRICTION;
        p.x += p.vx;
        p.y += p.vy;
        p.rot *= 0.88;
        p.rotVel *= 0.8;

        const elapsed = performance.now() - p.coastStartT;
        const FADE_START_MS = 120;
        const FADE_DUR_MS = 280;
        const fadeT = Math.max(0, (elapsed - FADE_START_MS) / FADE_DUR_MS);
        const opacity = Math.max(0, 1 - fadeT);
        ghost.style.opacity = `${opacity}`;

        if (opacity <= 0 || Math.hypot(p.vx, p.vy) < 0.3) {
          p.mode = "idle";
          setGhostVisible(false);
          setGhostDomino(null);
          rafRef.current = null;
          return;
        }
      }

      ghost.style.left = `${p.x}px`;
      ghost.style.top = `${p.y}px`;
      ghost.style.transform = `scale(1.05) rotate(${p.rot}deg)`;

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
  }

  function stopRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  // ── Drag start ────────────────────────────────────────────────────────────────

  function handleDragStart(
    source: DragSource,
    e: React.PointerEvent,
    offset: { x: number; y: number },
  ) {
    stopRaf();

    let domino: RunState["pendingTile"] = null;
    if (state) {
      if (source.kind === "pending") domino = state.pendingTile ?? null;
      else if (source.kind === "saved") domino = state.savedTiles.find((s) => s.id === source.savedTileId)?.domino ?? null;
      else domino = (state.hand ?? []).find((t) => t.id === source.handTileId) ?? null;
    }

    const initX = e.clientX - offset.x;
    const initY = e.clientY - offset.y;

    physRef.current = {
      mode: "drag",
      x: initX, y: initY,
      vx: 0, vy: 0,
      rot: 0, rotVel: 0,
      targetX: initX, targetY: initY,
      ptrVx: 0,
      isSnapping: false,
      coastStartT: 0,
    };
    ptrLastRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };

    dragPointerIdRef.current = e.pointerId;
    pickupOffsetRef.current = offset;
    setDragSource(source);
    setGhostDomino(domino);
    setGhostVisible(true);
    setSnapPointId(null);
    startRaf();
  }

  // ── Pointer event effect ──────────────────────────────────────────────────────

  useEffect(() => {
    function clearDragState() {
      stopRaf();
      physRef.current.mode = "idle";
      dragPointerIdRef.current = null;
      setDragSource(null);
      setGhostVisible(false);
      setGhostDomino(null);
      setSnapPointId(null);
    }

    function updateSnap(cx: number, cy: number) {
      const src = dragSourceRef.current;
      const st = stateRef.current;
      if (!src || !st || !radialTreeRef.current) {
        physRef.current.isSnapping = false;
        setSnapPointId(null);
        return;
      }
      const legal = legalPointIdsRef.current;
      let bestId: string | null = null;
      let bestDist = SNAP_RADIUS;
      let bestSP: { x: number; y: number } | null = null;

      if (Object.keys(st.placedNodes).length === 0 && (src.kind === "pending" || src.kind === "hand")) {
        const sp = radialTreeRef.current.getScreenPos(0, 0);
        if (sp) {
          const d = Math.hypot(cx - sp.x, cy - sp.y);
          if (d < bestDist) { bestDist = d; bestId = "root"; bestSP = sp; }
        }
      }
      for (const pt of Object.values(st.openConnectionPoints)) {
        if (!legal.has(pt.id)) continue;
        const sp = radialTreeRef.current.getScreenPos(pt.position.x, pt.position.y);
        if (!sp) continue;
        const d = Math.hypot(cx - sp.x, cy - sp.y);
        if (d < bestDist) { bestDist = d; bestId = pt.id; bestSP = sp; }
      }

      setSnapPointId(bestId);
      physRef.current.isSnapping = bestId !== null;
      if (bestSP) {
        physRef.current.targetX = bestSP.x - GHOST_TILE_W / 2;
        physRef.current.targetY = bestSP.y - GHOST_TILE_H / 2;
      } else {
        const { x: ox, y: oy } = pickupOffsetRef.current;
        physRef.current.targetX = cx - ox;
        physRef.current.targetY = cy - oy;
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (e.pointerId !== dragPointerIdRef.current || physRef.current.mode !== "drag") return;

      // Update smoothed pointer velocity (px/frame, EMA) for rotation
      const now = performance.now();
      const dt = now - ptrLastRef.current.t;
      if (dt > 0 && dt < 150) {
        const pxPerFrame = (e.clientX - ptrLastRef.current.x) / dt * 16.67;
        physRef.current.ptrVx = physRef.current.ptrVx * 0.65 + pxPerFrame * 0.35;
      }
      ptrLastRef.current = { x: e.clientX, y: e.clientY, t: now };

      updateSnap(e.clientX, e.clientY);
    }

    function onPointerUp(e: PointerEvent) {
      if (e.pointerId !== dragPointerIdRef.current) return;

      const snapped = snapPointIdRef.current;
      const src = dragSourceRef.current;
      const acts = actionsRef.current;

      if (snapped && src) {
        // Dispatch placement, ghost disappears immediately
        if (snapped === "root") {
          if (src.kind === "pending") acts.place(null);
          else if (src.kind === "hand") acts.playFromHand(src.handTileId, null);
        } else {
          if (src.kind === "pending") acts.place(snapped);
          else if (src.kind === "saved") acts.playSaved(src.savedTileId, snapped);
          else if (src.kind === "hand") acts.playFromHand(src.handTileId, snapped);
        }
        clearDragState();
        return;
      }

      // No snap — hand off to coast (RAF keeps running)
      dragPointerIdRef.current = null;
      setDragSource(null);
      setSnapPointId(null);

      const p = physRef.current;
      // Clamp coast initial velocity so fast throws still look clean
      const MAX_COAST = 38; // px/frame
      const spd = Math.hypot(p.vx, p.vy);
      if (spd < 0.5) {
        clearDragState();
        return;
      }
      const scale = Math.min(1, MAX_COAST / spd);
      p.vx *= scale;
      p.vy *= scale;
      p.mode = "coast";
      p.coastStartT = performance.now();
      p.isSnapping = false;
      if (ghostRef.current) ghostRef.current.style.opacity = "1";
      // RAF is already running — it'll pick up coast mode on the next frame
    }

    function onPointerCancel(e: PointerEvent) {
      if (e.pointerId !== dragPointerIdRef.current) return;
      clearDragState();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  // ── Start screen ─────────────────────────────────────────────────────────────
  if (!state) {
    const howToSteps = [
      "Draw a hand of 5 tiles from the deck.",
      "Play any tiles you want by placing them, matching pips and extending your structure from the starting point.",
      "Redraw if you want — unused tiles go to the back of the deck and you get a fresh hand (up to 3 redraws).",
      "After your 3rd redraw, any unused tiles in your hand are discarded.",
      "Watch for doubles! They open two new branch points.",
      "Keep going until you run out of legal moves or the deck runs out.",
      "Score — at run's end, pips are tallied along every path from the starting point; branches split and multiply your totals for a final score.",
    ];

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          overflowY: "auto",
          paddingBlock: 40,
          fontFamily: "system-ui, sans-serif",
          background: "#1a1a2e",
          color: "#fff",
          gap: 16,
        }}
      >
        {fullscreenSupported && (
          <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} dark />
        )}
        <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
          Pipstream
        </h1>
        <p style={{ color: "#aaa", margin: 0, fontSize: 15 }}>
          Build the chain. Branch the doubles. Score big.
        </p>
        {!deck ? (
          <button
            disabled
            style={{
              marginTop: 16,
              padding: "12px 40px",
              background: "#333",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor: "not-allowed",
            }}
          >
            Loading…
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 16 }}>
            <p style={{ color: "#888", margin: 0, fontSize: 13, letterSpacing: "0.03em", textTransform: "uppercase" }}>
              Choose a mode
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <ModeButton
                onClick={() => handleStartRun("draw-five")}
                title="Draw Five"
                description="Draw 5 at once. Re-roll your hand up to 3 times for free."
                highlight
              />
              <ModeButton
                onClick={() => handleStartRun("save-discard")}
                title="Save / Discard"
                description="Draw tiles one by one. Save or discard to manage your hand."
              />
            </div>
          </div>
        )}
        <div style={{ maxWidth: 520, width: "100%", padding: "0 16px", marginTop: 8 }}>
          <p style={{ color: "#888", margin: "0 0 12px", fontSize: 13, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            How to Play
          </p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {howToSteps.map((text, i) => (
              <li key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#4f8ef7",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 14, color: "#ccc", lineHeight: 1.5 }}>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {fullscreenSupported && (
        <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
      )}
      {showScoreScreen && (
        <ScoreScreen
          state={state}
          scoreResult={scoreResult!}
          onPlayAgain={reset}
        />
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <RadialTree
          ref={radialTreeRef}
          state={state}
          dragSource={dragSource}
          legalPointIds={legalPointIds}
          snapPointId={snapPointId}
          animationOverlay={
            isAnimating
              ? <ScoringAnimation state={state} onDone={() => setAnimationDone(true)} />
              : null
          }
        />
        <HUD
          state={state}
          dragSource={dragSource}
          onDiscard={discard}
          onSave={save}
          onReroll={reroll}
          onDragStart={handleDragStart}
        />
      </div>

      {/* Ghost tile — positioned and animated entirely by the RAF physics loop */}
      {ghostVisible && ghostDomino && (
        <div
          ref={ghostRef}
          style={{
            position: "fixed",
            left: physRef.current.x,
            top: physRef.current.y,
            transform: `scale(1.05) rotate(${physRef.current.rot}deg)`,
            transformOrigin: `${pickupOffsetRef.current.x}px ${pickupOffsetRef.current.y}px`,
            pointerEvents: "none",
            zIndex: 1000,
            filter: snapPointId
              ? "drop-shadow(0 0 10px #4caf50) drop-shadow(0 3px 8px rgba(0,0,0,0.3))"
              : "drop-shadow(0 6px 16px rgba(0,0,0,0.5))",
          }}
        >
          <DominoTileHTML domino={ghostDomino} size={44} />
        </div>
      )}
    </div>
  );
}

function FullscreenBtn({
  isFullscreen,
  onToggle,
  dark,
}: {
  isFullscreen: boolean;
  onToggle: () => void;
  dark?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 2000,
        width: 36,
        height: 36,
        padding: 0,
        background: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
        border: dark ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(0,0,0,0.15)",
        borderRadius: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: dark ? "#fff" : "#444",
      }}
    >
      {isFullscreen ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
      )}
    </button>
  );
}

function ModeButton({
  onClick,
  title,
  description,
  highlight,
}: {
  onClick: () => void;
  title: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 180,
        padding: "16px 12px",
        background: highlight ? "#4f8ef7" : "#2a2a3e",
        color: "#fff",
        border: highlight ? "none" : "1px solid #444",
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 700,
        cursor: "pointer",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        letterSpacing: "0.01em",
      }}
    >
      <span>{title}</span>
      <span style={{ fontWeight: 400, fontSize: 12, color: highlight ? "rgba(255,255,255,0.8)" : "#999", lineHeight: 1.4 }}>
        {description}
      </span>
    </button>
  );
}
