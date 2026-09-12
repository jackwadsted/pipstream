import { useState, useEffect, useMemo } from "react";
import type { DragSource } from "./hooks/useRunState.js";
import type { GameMode } from "./engine/types.js";
import type { ResolvedDeck } from "./schemas/deck.js";
import { useRunState } from "./hooks/useRunState.js";
import { loadDeckBrowser } from "./dataBundle.js";
import { RadialTree } from "./components/RadialTree.js";
import { HUD } from "./components/HUD.js";
import { ScoreScreen } from "./components/ScoreScreen.js";
import { ScoringAnimation } from "./components/ScoringAnimation.js";
import { computeScore } from "./engine/scoring.js";

export function App() {
  const { state, init, reset, place, discard, save, playSaved, playFromHand, reroll, getLegalPointIds } =
    useRunState(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [deck, setDeck] = useState<ResolvedDeck | null>(null);
  const [animationDone, setAnimationDone] = useState(false);

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

  function handleDragStart(source: DragSource) {
    setDragSource(source);
  }

  function handleDragEnd() {
    setDragSource(null);
  }

  function handleRootDrop() {
    if (!state || !dragSource) return;
    if (dragSource.kind === "pending") {
      place(null);
    } else if (dragSource.kind === "hand") {
      playFromHand(dragSource.handTileId, null);
    }
    setDragSource(null);
  }

  function handleDropOnPoint(pointId: string) {
    if (!state || !dragSource) return;
    if (dragSource.kind === "pending") {
      place(pointId);
    } else if (dragSource.kind === "saved") {
      playSaved(dragSource.savedTileId, pointId);
    } else if (dragSource.kind === "hand") {
      playFromHand(dragSource.handTileId, pointId);
    }
    setDragSource(null);
  }

  const legalPointIds = dragSource
    ? getLegalPointIds(dragSource)
    : new Set<string>();

  // ── Start screen ─────────────────────────────────────────────────────────────
  if (!state) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "system-ui, sans-serif",
          background: "#1a1a2e",
          color: "#fff",
          gap: 16,
        }}
      >
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
                onClick={() => handleStartRun("save-discard")}
                title="Save / Discard"
                description="Draw tiles one by one. Save or discard to manage your hand."
              />
              <ModeButton
                onClick={() => handleStartRun("draw-five")}
                title="Draw Five"
                description="Draw 5 at once. Re-roll your hand up to 3 times for free."
                highlight
              />
            </div>
          </div>
        )}
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
      {/* Score screen overlay — rendered after animation completes */}
      {showScoreScreen && (
        <ScoreScreen
          state={state}
          scoreResult={scoreResult!}
          onPlayAgain={reset}
        />
      )}

      {/* Main area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <RadialTree
          state={state}
          dragSource={dragSource}
          legalPointIds={legalPointIds}
          onDropOnPoint={handleDropOnPoint}
          onRootDrop={handleRootDrop}
          animationOverlay={
            isAnimating
              ? <ScoringAnimation state={state} onDone={() => setAnimationDone(true)} />
              : null
          }
        />
        <HUD
          state={state}
          onDiscard={discard}
          onSave={save}
          onReroll={reroll}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      </div>
    </div>
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
