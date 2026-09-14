import React, { useState, useEffect, useRef, useMemo } from "react";
import type { DragSource } from "./hooks/useRunState.js";
import type { GameMode, RunState } from "./engine/types.js";
import type { ResolvedDeck } from "./schemas/deck.js";
import { useRunState } from "./hooks/useRunState.js";
import { loadDeckBrowser, loadLevelsBrowser, type LevelData } from "./dataBundle.js";
import { DominoBoard } from "./components/DominoBoard.js";
import type { DominoBoardHandle } from "./components/DominoBoard.js";
import { HUD } from "./components/HUD.js";
import { ScoreScreen } from "./components/ScoreScreen.js";
import { ScoringAnimation } from "./components/ScoringAnimation.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { getLeaderboard, addEntry } from "./lib/leaderboard.js";
import { getAllLevelStars, saveLevelStars, computeStars, starThreshold } from "./lib/completedLevels.js";
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
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [levels, setLevels] = useState<LevelData[]>([]);
  const [levelStars, setLevelStars] = useState<Record<string, number>>({});
  const [currentLevelId, setCurrentLevelId] = useState<string | null>(null);
  const [currentNearOptimal, setCurrentNearOptimal] = useState<number | null>(null);
  const [seedInput, setSeedInput] = useState("");

  // Ghost tile — just visibility flags; position/rotation live in physRef and are DOM-applied by RAF
  const [ghostVisible, setGhostVisible] = useState(false);
  const [ghostDomino, setGhostDomino] = useState<RunState["pendingTile"]>(null);

  // Snap
  const [snapPointId, setSnapPointId] = useState<string | null>(null);

  // Refs
  const dominoBoardRef = useRef<DominoBoardHandle>(null);
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
    setLevels(loadLevelsBrowser());
    setLevelStars(getAllLevelStars());
  }, []);

  function handleStartRun(mode: GameMode) {
    if (!deck) return;
    setCurrentLevelId(null);
    setCurrentNearOptimal(null);
    init(deck, mode);
  }

  function handleStartLevel(level: LevelData) {
    if (!deck) return;
    setCurrentLevelId(level.id);
    setCurrentNearOptimal(level.targets.nearOptimal);
    init(deck, "draw-five", level.seed);
  }

  function handleStartCustomSeed() {
    const seed = parseInt(seedInput.trim(), 10);
    if (!deck || isNaN(seed) || seed < 1) return;
    setCurrentLevelId(null);
    setCurrentNearOptimal(null);
    init(deck, "draw-five", seed);
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

  useEffect(() => {
    if (runEnded && currentLevelId && scoreResult && currentNearOptimal !== null) {
      const stars = computeStars(scoreResult.totalScore, currentNearOptimal);
      if (stars > 0) {
        saveLevelStars(currentLevelId, stars);
        setLevelStars(getAllLevelStars());
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runEnded]);

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
      if (!src || !st || !dominoBoardRef.current) {
        physRef.current.isSnapping = false;
        setSnapPointId(null);
        return;
      }
      const legal = legalPointIdsRef.current;
      let bestId: string | null = null;
      let bestDist = SNAP_RADIUS;
      let bestSP: { x: number; y: number } | null = null;

      if (Object.keys(st.placedNodes).length === 0 && (src.kind === "pending" || src.kind === "hand")) {
        const sp = dominoBoardRef.current.getScreenPos(0, 0);
        if (sp) {
          const d = Math.hypot(cx - sp.x, cy - sp.y);
          if (d < bestDist) { bestDist = d; bestId = "root"; bestSP = sp; }
        }
      }
      for (const pt of Object.values(st.openConnectionPoints)) {
        if (!legal.has(pt.id)) continue;
        const sp = dominoBoardRef.current.getScreenPos(pt.position.x, pt.position.y);
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

    const seedIsValid = /^\d+$/.test(seedInput.trim()) && parseInt(seedInput.trim(), 10) >= 1;

    return (
      <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          minHeight: "100vh",
          overflowY: "auto",
          paddingBlock: 40,
          fontFamily: "system-ui, sans-serif",
          background: "#1a1a2e",
          color: "#fff",
          gap: 32,
        }}
      >
        {fullscreenSupported && (
          <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} dark />
        )}

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
            Pipstream
          </h1>
          <p style={{ color: "#aaa", margin: 0, fontSize: 15 }}>
            Build the chain. Branch the doubles. Score big.
          </p>
        </div>

        {!deck ? (
          <p style={{ color: "#666", fontSize: 14 }}>Loading…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, width: "100%", maxWidth: 560, padding: "0 16px" }}>

            {/* Levels section */}
            <div style={{ width: "100%" }}>
              <SectionLabel>Levels</SectionLabel>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
              }}>
                {levels.map((level) => {
                  const stars = levelStars[level.id] ?? 0;
                  return (
                    <button
                      key={level.id}
                      onClick={() => handleStartLevel(level)}
                      style={{
                        background: stars > 0 ? "#1e2e1e" : "#2a2a3e",
                        border: stars > 0 ? "1px solid #3a6b3a" : "1px solid #3a3a5c",
                        borderRadius: 10,
                        padding: "12px 8px",
                        color: "#fff",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 6,
                        position: "relative",
                      }}
                    >
                      <span style={{ fontSize: 11, lineHeight: 1, letterSpacing: 1 }}>
                        {[1, 2, 3].map((n) => (
                          <span key={n} style={{ color: n <= stars ? "#f5c542" : "#444" }}>★</span>
                        ))}
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: stars > 0 ? "#5cb85c" : "#fff" }}>
                        {level.name}
                      </span>
                      <span style={{ fontSize: 10, color: "#888", lineHeight: 1.4, textAlign: "center" }}>
                        {starThreshold(level.targets.nearOptimal, 3).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Free play section */}
            <div style={{ width: "100%" }}>
              <SectionLabel>Free Play</SectionLabel>
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

            {/* Custom seed section */}
            <div style={{ width: "100%" }}>
              <SectionLabel>Custom Seed</SectionLabel>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min={1}
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && seedIsValid && handleStartCustomSeed()}
                  placeholder="Enter a seed number"
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    background: "#2a2a3e",
                    border: "1px solid #3a3a5c",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 14,
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleStartCustomSeed}
                  disabled={!seedIsValid}
                  style={{
                    padding: "10px 20px",
                    background: seedIsValid ? "#4f8ef7" : "#2a2a3e",
                    color: seedIsValid ? "#fff" : "#555",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: seedIsValid ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  Play
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#555" }}>
                Plays in Draw Five mode
              </p>
            </div>

            {/* High scores */}
            <button
              onClick={() => setShowLeaderboard(true)}
              style={{
                padding: "8px 24px",
                background: "transparent",
                color: "#aaa",
                border: "1px solid #444",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              High Scores
            </button>
          </div>
        )}

        {/* How to play */}
        <div style={{ maxWidth: 520, width: "100%", padding: "0 16px" }}>
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

      {/* Leaderboard overlay */}
      {showLeaderboard && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "32px 40px",
              maxWidth: 560,
              width: "90%",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
            }}
          >
            <Leaderboard
              entries={getLeaderboard()}
              onClose={() => setShowLeaderboard(false)}
            />
          </div>
        </div>
      )}
      </>
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
          onMainMenu={reset}
          onSaveScore={(name) =>
            addEntry({
              name,
              score: scoreResult!.totalScore,
              mode: state.mode ?? "save-discard",
              date: new Date().toISOString(),
            })
          }
        />
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <DominoBoard
          ref={dominoBoardRef}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "#888", margin: "0 0 10px", fontSize: 13, letterSpacing: "0.03em", textTransform: "uppercase" }}>
      {children}
    </p>
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
