import { useState } from "react";
import type { RunState } from "../engine/types.js";
import type { ScoreResult } from "../engine/scoring.js";
import type { LeaderboardEntry } from "../lib/leaderboard.js";
import { Leaderboard } from "./Leaderboard.js";
import { computeStars } from "../lib/completedLevels.js";

interface ScoreScreenProps {
  state: RunState;
  scoreResult: ScoreResult;
  onPlayAgain: () => void;
  onMainMenu: () => void;
  onSaveScore: (name: string) => LeaderboardEntry[];
  nearOptimal?: number;
}

export function ScoreScreen({ state, scoreResult, onPlayAgain, onMainMenu, onSaveScore, nearOptimal }: ScoreScreenProps) {
  const [phase, setPhase] = useState<"entry" | "board">("entry");
  const [playerName, setPlayerName] = useState("");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  const title = state.status === "ended-deck-exhausted" ? "Run Complete!" : "Run Over";
  const subtitle =
    state.status === "ended-deck-exhausted"
      ? "Deck exhausted — full chain scored."
      : "No moves remaining.";

  const levelStars = nearOptimal !== undefined ? computeStars(scoreResult.totalScore, nearOptimal) : null;

  function handleSave() {
    const name = playerName.trim() || "Anonymous";
    const updated = onSaveScore(name);
    setEntries(updated);
    setPhase("board");
  }

  return (
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
        {phase === "entry" ? (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 26, color: "#1a1a2e" }}>{title}</h2>
            <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>{subtitle}</p>

            {/* Level result — score vs target + stars */}
            {nearOptimal !== undefined && levelStars !== null && (
              <div
                style={{
                  background: "#fafafa",
                  border: "1.5px solid #e8e8e8",
                  borderRadius: 10,
                  padding: "16px 20px",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#aaa", marginBottom: 4 }}>
                    Level Score
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 32, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>
                      {scoreResult.totalScore}
                    </span>
                    <span style={{ fontSize: 16, color: "#aaa", fontWeight: 400 }}>
                      / {nearOptimal}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#aaa" }}>
                    Stars
                  </div>
                  <div style={{ fontSize: 28, letterSpacing: 2, lineHeight: 1 }}>
                    {[1, 2, 3].map((n) => (
                      <span key={n} style={{ color: n <= levelStars ? "#f5a623" : "#ddd" }}>★</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Total score */}
            <div
              style={{
                background: "#f0f4ff",
                borderRadius: 8,
                padding: "16px 20px",
                marginBottom: 20,
                display: "flex",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 13, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Total Score
              </span>
              <span style={{ fontSize: 48, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>
                {scoreResult.totalScore}
              </span>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 13, color: "#555" }}>
              <Stat label="Paths" value={scoreResult.paths.length} />
              <Stat label="Doubles played" value={state.doubleTriggerLog.length} />
              <Stat label="Tiles placed" value={Object.keys(state.placedNodes).length} />
            </div>

            {/* Per-path breakdown */}
            {scoreResult.paths.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "#888",
                    marginBottom: 8,
                  }}
                >
                  Path Breakdown
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#888", fontSize: 11 }}>
                      <th style={thStyle}>Leaf tile</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Pips</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>×</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreResult.paths.map((path, i) => {
                      const leafDomino = state.placedNodes[path.leafNodeId]?.domino;
                      const label = leafDomino ? `${leafDomino.pips[0]}–${leafDomino.pips[1]}` : "?";
                      return (
                        <tr
                          key={path.leafNodeId}
                          style={{
                            background: i % 2 === 0 ? "#fafafa" : "#fff",
                            borderTop: "1px solid #f0f0f0",
                          }}
                        >
                          <td style={tdStyle}>{label}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#444" }}>{path.pipTotal}</td>
                          <td style={{ ...tdStyle, textAlign: "right", color: "#888" }}>×{path.multiplier}</td>
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: "#1a1a2e" }}>
                            {path.contribution}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Name entry */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Enter your name
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="Your name"
                maxLength={32}
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1.5px solid #ddd",
                  borderRadius: 8,
                  fontSize: 15,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <button onClick={handleSave} style={primaryBtnStyle}>
              Save Score
            </button>

            <button
              onClick={onPlayAgain}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 0",
                background: "transparent",
                color: "#888",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Skip — Play Again
            </button>
          </>
        ) : (
          <Leaderboard
            entries={entries}
            highlightScore={scoreResult.totalScore}
            onPlayAgain={onPlayAgain}
            onClose={onMainMenu}
          />
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "4px 8px",
  textAlign: "left",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 0",
  background: "#1a1a2e",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: "0.03em",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#aaa" }}>
        {label}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700, color: "#333" }}>{value}</span>
    </div>
  );
}
