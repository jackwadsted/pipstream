# Pipstream

A browser-based domino roguelike (Vite + React 19 + TypeScript).

Draw from a double-six set one tile at a time. Place, discard, or save each tile to build a branching tree structure. Doubles multiply the score of every branch they parent. At the end of the run, the engine traverses every root-to-leaf path and sums up your score.

---

## Project layout

```
pipstream/
├── data/
│   ├── dominoes/              # One JSON file per domino tile (28 files)
│   └── decks/                 # One JSON file per deck definition
├── index.html
└── src/
    ├── schemas/
    │   ├── domino.ts          # Zod schema + TypeScript types for Domino
    │   └── deck.ts            # Zod schema + TypeScript types for Deck / ResolvedDeck
    ├── engine/
    │   ├── types.ts           # RunState, GameConfig, GameNode, PlacementError, etc.
    │   ├── placementEngine.ts # Core placement / discard / save logic
    │   ├── scoring.ts         # computeScore() — DFS traversal with branch multipliers
    │   └── tileTransform.ts   # getTileTransform() — pip orientation per branch angle
    ├── hooks/
    │   ├── useRunState.ts     # useReducer wrapper over the placement engine
    │   └── useFullscreen.ts   # Fullscreen API wrapper (toggle + isSupported)
    ├── lib/
    │   └── leaderboard.ts     # localStorage leaderboard (getLeaderboard / addEntry / clearLeaderboard)
    ├── components/
    │   ├── DominoTile.tsx     # Pip-dot rendering (HTML HUD variant + SVG tree variant)
    │   ├── DominoBoard.tsx    # SVG board: pan/zoom, placed tiles, drag-and-drop targets
    │   ├── HUD.tsx            # Pending tile, save/discard controls, saved tile pool
    │   ├── ScoreScreen.tsx    # End-of-run overlay with per-path breakdown
    │   ├── ScoringAnimation.tsx # Animated scoring reveal (pip-float + multiplier-pop keyframes)
    │   └── Leaderboard.tsx    # High-scores table (localStorage-backed, highlights current run)
    ├── dataBundle.ts          # Browser loader — import.meta.glob + Zod, no fs
    ├── loader.ts              # Node loader — fs-based, for tests and build tooling
    ├── App.tsx
    ├── main.tsx
    └── __tests__/
        ├── loader.test.ts
        ├── placementEngine.test.ts
        ├── gameplay.test.tsx
        ├── scoring.test.ts
        └── tileTransform.test.ts
```

---

## Running

```bash
npm install
npm run dev       # Vite dev server → http://localhost:5173
npm test          # Vitest
npm run build     # Production build
npm run typecheck # tsc --noEmit
```

---

## How to play

1. **Select mode** — choose Save/Discard or Draw Five on the title screen.
2. **Place** — drag a tile onto the tree. The root drop zone accepts the first tile; subsequent tiles connect to any open end. Green circles = legal connections, red = illegal during a drag. Tiles animate into position when placed.
3. **Discard** — drop the pending tile without placing it (limit shown in HUD).
4. **Save / Play Saved** *(Save/Discard mode)* — bank a tile to the save pool (cap shown) and replay it later.
5. **Draw Five mode** — you always hold a hand of 5 tiles; drag any tile to place it. Re-rolls are free up to the limit, then cost a penalty discard.
6. **End of run** — when the deck (and hand) are exhausted, the scoring animation plays, then the score screen with per-path breakdown appears. Enter a name to save your score.
7. **Leaderboard** — accessible from the title screen; shows the top 100 scores across both modes, stored in `localStorage`.
8. **Fullscreen** — toggle via the button in the top-right corner (on supported browsers).

---

## Scoring

The engine does a DFS traversal from the root to every leaf.

- **Pip total** for a path is the sum of all pips on tiles along that path.
- **Doubles** (tiles with equal pips, e.g. `d4-4`) multiply the score of every branch they parent. The default `branchMultiplier` is **2** (placeholder — subject to balance tuning).
- Two doubles stacked on one path multiply **exponentially** (`branchMult²`), not additively.
- A double at a leaf carries no multiplier — no branches come out of it.
- **Final score** is the sum of all per-path contributions.

`ScoreResult` shape:

```typescript
{
  totalScore: number;
  paths: Array<{
    leafNodeId: string;
    pipTotal: number;
    multiplier: number;
    contribution: number;   // pipTotal × multiplier
  }>;
}
```

---

## Data formats

### Domino

```json
{ "id": "d3-5", "pips": [3, 5], "effects": [], "tags": [] }
```

| Field | Notes |
|---|---|
| `id` | `d{lo}-{hi}`, canonical (`lo ≤ hi`) |
| `pips` | Always `[low, high]` — enforced by schema |
| `effects` | Extension point for power-ups; untyped `object[]` now, typed discriminated union later |
| `tags` | Free-form strings for filtering (`"starter"`, `"cursed"`, …) |

### Deck — `"standard-set"`

Generates all `(lo, hi)` pairs where `0 ≤ lo ≤ hi ≤ maxPip`, quantity 1 each.

```json
{ "id": "standard-double-six", "name": "Standard Double Six", "type": "standard-set", "maxPip": 6 }
```

### Deck — `"explicit"`

Explicit tile list with per-tile quantities (duplicates allowed for roguelike builds).

```json
{
  "id": "custom-starter",
  "name": "Custom Starter",
  "type": "explicit",
  "tiles": [
    { "dominoId": "d0-0", "quantity": 2 },
    { "dominoId": "d0-1", "quantity": 1 }
  ]
}
```

---

## Key design decisions

- **Zod over Ajv** — single source of truth for types and runtime validation; `z.infer<>` eliminates hand-maintained drift.
- **Deck `type` discriminated union** — `"standard-set"` vs `"explicit"` lets the resolver branch cleanly without nullable fields.
- **`effects` untyped now** — accepting `object[]` avoids a breaking schema change when the power-up system is designed.
- **`branchMultiplier` in `GameConfig`** — doubles apply multiplicatively per outgoing branch; the `2` default is a balance placeholder.
- **`doubleTriggerLog` in `RunState`** — every double placed (root or non-root) is appended here. No side effects yet; exists as a hook point for future power-up activations.
- **Browser vs Node loaders** — `src/loader.ts` uses `fs` for tests and CI; `src/dataBundle.ts` uses `import.meta.glob` for the browser bundle. Same Zod schemas, no duplication.
- **Leaderboard in `localStorage`** — top 100 entries sorted by score, keyed `pipstream_leaderboard`. `addEntry` merges, sorts, and trims in one call; safe to call on every run end.
- **`useFullscreen`** — thin wrapper around the Fullscreen API; `isSupported` guards the button so it's hidden on environments (e.g. iOS Safari) that don't support it.

---

## What's not built yet

- Power-up effects (trigger log exists; actual effect application does not)
- Meta-progression and unlocks
- Player-controlled tile rotation / flipping as a game mechanic
- Cosmetic themes
- **Portrait mobile layout** — HUD should move to a bottom panel; tree gets full width (landscape already works)
