import type { RunState } from "../engine/types.js";
import type { DragSource } from "../hooks/useRunState.js";
import { DominoTileHTML } from "./DominoTile.js";

interface HUDProps {
  state: RunState;
  dragSource?: DragSource | null | undefined;
  onDiscard: () => void;
  onSave: () => void;
  onReroll: () => void;
  onDragStart: (source: DragSource, e: React.PointerEvent<HTMLDivElement>, offset: { x: number; y: number }) => void;
}

export function HUD({ state, dragSource, onDiscard, onSave, onReroll, onDragStart }: HUDProps) {
  const { config, pendingTile, savedTiles, drawPile, discardsUsed, savesUsed, status, doubleTriggerLog } = state;

  const isDrawFive = state.mode === "draw-five";

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "16px 12px",
        background: "#fff",
        borderLeft: "1px solid #ddd",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* Deck remaining */}
      <div>
        <Label>Deck</Label>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {drawPile.length} remaining
        </span>
      </div>

      {/* Doubles played counter */}
      <div>
        <Label>Doubles played</Label>
        <span
          data-testid="doubles-count"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {doubleTriggerLog.length}
        </span>
      </div>

      {isDrawFive ? (
        <DrawFivePanel
          state={state}
          dragSource={dragSource}
          onReroll={onReroll}
          onDragStart={onDragStart}
        />
      ) : (
        <SaveDiscardPanel
          state={state}
          config={config}
          pendingTile={pendingTile}
          savedTiles={savedTiles}
          discardsUsed={discardsUsed}
          savesUsed={savesUsed}
          status={status}
          onDiscard={onDiscard}
          onSave={onSave}
          onDragStart={onDragStart}
        />
      )}
    </div>
  );
}

function DrawFivePanel({
  state,
  dragSource,
  onReroll,
  onDragStart,
}: {
  state: RunState;
  dragSource?: DragSource | null | undefined;
  onReroll: () => void;
  onDragStart: (source: DragSource, e: React.PointerEvent<HTMLDivElement>, offset: { x: number; y: number }) => void;
}) {
  const hand = state.hand ?? [];
  const rerollsUsed = state.rerollsUsed ?? 0;
  const freeRerolls = state.config.freeRerolls ?? 3;
  const freeRemaining = Math.max(0, freeRerolls - rerollsUsed);
  const canReroll = hand.length > 0 || state.drawPile.length > 0;
  const isPenalty = rerollsUsed >= freeRerolls;
  const noRoot = Object.keys(state.placedNodes).length === 0;

  return (
    <>
      {/* Re-roll button */}
      <div>
        <Label>Re-roll</Label>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
          {freeRemaining > 0
            ? `${freeRemaining} free re-roll${freeRemaining !== 1 ? "s" : ""} left`
            : "Penalty: tiles will be discarded"}
        </div>
        <button
          onClick={onReroll}
          disabled={!canReroll || state.status !== "in-progress"}
          title={isPenalty ? "Re-roll (tiles will be discarded — no free re-rolls left)" : "Re-roll hand (tiles returned to deck)"}
          style={{
            width: "100%",
            padding: "7px 4px",
            border: isPenalty ? "1px solid #f44336" : "1px solid #ccc",
            borderRadius: 4,
            background: !canReroll || state.status !== "in-progress"
              ? "#eee"
              : isPenalty
              ? "#fff0f0"
              : "#f0f7ff",
            cursor: !canReroll || state.status !== "in-progress" ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: !canReroll || state.status !== "in-progress"
              ? "#aaa"
              : isPenalty
              ? "#d32f2f"
              : "#1565c0",
          }}
        >
          {isPenalty ? `Re-roll (discard)` : `Re-roll (${rerollsUsed}/${freeRerolls})`}
        </button>
      </div>

      {/* Hand tiles */}
      <div>
        <Label>Hand ({hand.length})</Label>
        {hand.length === 0 ? (
          <EmptyText>—</EmptyText>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {hand.map((t) => {
              const isDragging = dragSource?.kind === "hand" && dragSource.handTileId === t.id;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isDragging ? (
                    <div style={{
                      width: 90,
                      height: 44,
                      border: "2px dashed #bbb",
                      borderRadius: 6,
                      background: "transparent",
                    }} />
                  ) : (
                    <DominoTileHTML
                      domino={t}
                      size={44}
                      {...(state.status === "in-progress" ? {
                        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
                          e.preventDefault();
                          const r = e.currentTarget.getBoundingClientRect();
                          onDragStart({ kind: "hand", handTileId: t.id }, e, { x: e.clientX - r.left, y: e.clientY - r.top });
                        },
                      } : {})}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {noRoot && hand.length > 0 && state.status === "in-progress" && (
          <Note>Drag any tile to center to place as root</Note>
        )}
      </div>
    </>
  );
}

function SaveDiscardPanel({
  state,
  config,
  pendingTile,
  savedTiles,
  discardsUsed,
  savesUsed,
  status,
  onDiscard,
  onSave,
  onDragStart,
}: {
  state: RunState;
  config: RunState["config"];
  pendingTile: RunState["pendingTile"];
  savedTiles: RunState["savedTiles"];
  discardsUsed: number;
  savesUsed: number;
  status: RunState["status"];
  onDiscard: () => void;
  onSave: () => void;
  onDragStart: (source: DragSource, e: React.PointerEvent<HTMLDivElement>, offset: { x: number; y: number }) => void;
}) {
  const discardDisabled = discardsUsed >= config.maxDiscards || !pendingTile || status !== "in-progress";
  const saveDisabled = savesUsed >= config.maxSaves || !pendingTile || status !== "in-progress";
  const noRoot = Object.keys(state.placedNodes).length === 0;

  return (
    <>
      {/* Pending tile */}
      <div>
        <Label>Pending tile</Label>
        {pendingTile ? (
          <div style={{ display: "flex", justifyContent: "center", margin: "8px 0" }}>
            <DominoTileHTML
              domino={pendingTile}
              size={44}
              {...(status === "in-progress" ? {
                onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  onDragStart({ kind: "pending" }, e, { x: e.clientX - r.left, y: e.clientY - r.top });
                },
              } : {})}
            />
          </div>
        ) : (
          <EmptyText>—</EmptyText>
        )}
        {noRoot && pendingTile && status === "in-progress" && (
          <Note>Drag to center to place as root</Note>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionBtn
          onClick={onSave}
          disabled={saveDisabled}
          data-testid="btn-save"
          title={saveDisabled ? `Max saves reached (${config.maxSaves})` : "Save tile for later"}
        >
          Save ({savesUsed}/{config.maxSaves})
        </ActionBtn>
        <ActionBtn
          onClick={onDiscard}
          disabled={discardDisabled}
          data-testid="btn-discard"
          title={discardDisabled ? `Max discards reached (${config.maxDiscards})` : "Discard tile"}
          style={{ background: discardDisabled ? "#eee" : "#fff0f0", borderColor: discardDisabled ? "#ccc" : "#f44336" }}
        >
          Discard ({discardsUsed}/{config.maxDiscards})
        </ActionBtn>
      </div>

      {/* Saved pool */}
      <div>
        <Label>Saved ({savedTiles.length}/{config.maxSaves})</Label>
        {savedTiles.length === 0 ? (
          <EmptyText>None</EmptyText>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {savedTiles.map((st) => (
              <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <DominoTileHTML
                  domino={st.domino}
                  size={38}
                  {...(status === "in-progress" ? {
                    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      onDragStart({ kind: "saved", savedTileId: st.id }, e, { x: e.clientX - r.left, y: e.clientY - r.top });
                    },
                  } : {})}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 600, color: "#555", marginBottom: 2, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {children}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "#aaa" }}>{children}</span>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#888", fontSize: 11, marginTop: 4 }}>{children}</div>;
}

function ActionBtn({
  children,
  disabled,
  onClick,
  style,
  title,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
  title?: string;
  "data-testid"?: string;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1,
        padding: "6px 4px",
        border: "1px solid #ccc",
        borderRadius: 4,
        background: disabled ? "#eee" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        color: disabled ? "#aaa" : "#333",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
