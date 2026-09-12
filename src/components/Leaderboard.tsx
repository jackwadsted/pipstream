import type { LeaderboardEntry } from "../lib/leaderboard.js";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightScore?: number;
  onPlayAgain?: () => void;
  onClose?: () => void;
}

const modeLabel: Record<string, string> = {
  "draw-five": "Draw Five",
  "save-discard": "Save / Discard",
};

export function Leaderboard({ entries, highlightScore, onPlayAgain, onClose }: LeaderboardProps) {
  return (
    <div style={{ width: "100%" }}>
      <h2 style={{ margin: "0 0 20px", fontSize: 22, color: "#1a1a2e", fontWeight: 800 }}>
        High Scores
      </h2>
      {entries.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14, textAlign: "center", padding: "24px 0" }}>
          No scores yet. Play a game to get on the board!
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#888", fontSize: 11 }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Score</th>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => {
                const isHighlight = highlightScore !== undefined && entry.score === highlightScore;
                return (
                  <tr
                    key={i}
                    style={{
                      background: isHighlight ? "#e8f0ff" : i % 2 === 0 ? "#fafafa" : "#fff",
                      borderTop: "1px solid #f0f0f0",
                      fontWeight: isHighlight ? 700 : 400,
                    }}
                  >
                    <td style={{ ...tdStyle, color: "#aaa", width: 28 }}>{i + 1}</td>
                    <td style={tdStyle}>{entry.name}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: "#1a1a2e" }}>
                      {entry.score}
                    </td>
                    <td style={{ ...tdStyle, color: "#666" }}>{modeLabel[entry.mode] ?? entry.mode}</td>
                    <td style={{ ...tdStyle, color: "#aaa" }}>
                      {new Date(entry.date).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        {onPlayAgain && (
          <button onClick={onPlayAgain} style={primaryBtnStyle}>
            Play Again
          </button>
        )}
        {onClose && (
          <button onClick={onClose} style={onPlayAgain ? secondaryBtnStyle : primaryBtnStyle}>
            {onPlayAgain ? "Main Menu" : "Close"}
          </button>
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
  flex: 1,
  padding: "12px 0",
  background: "#1a1a2e",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 0",
  background: "transparent",
  color: "#1a1a2e",
  border: "1.5px solid #ccc",
  borderRadius: 8,
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
