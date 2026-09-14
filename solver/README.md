# Pipstream Solver

Offline beam-search solver for generating puzzle levels. Lives outside `src/` because it's a build tool, not part of the game bundle — it imports the engine directly and is never shipped to players.

## Running

```bash
npm run solve -- [flags]
```

## Flags

| Flag | Default | Description |
|---|---|---|
| `--seed N` | `1` | Starting seed for the shuffled deck |
| `--count N` | `1` | Solve exactly N consecutive seeds starting from `--seed` |
| `--find N` | — | Iterate seeds until N pass the active filters (use instead of `--count` when curating levels) |
| `--max-multiplier X` | — | Skip seeds where `optimal / par > X` |
| `--min-optimal N` | — | Skip seeds where optimal score < N |
| `--par-rerolls N` | `0` | Free rerolls given to the par solver (0 = no rerolls; 3 = same as player) |
| `--beam N` | `200` | Beam width — higher finds better solutions but is slower |
| `--deck ID` | `standard-double-six` | Deck to load from `data/decks/{ID}.json` |
| `--output-dir PATH` | — | Write a level JSON file per result to this directory |

## Typical workflows

**Scan a range to see the distribution:**
```bash
npm run solve -- --count 50
```

**Find 10 curated levels:**
```bash
npm run solve -- --find 10 --max-multiplier 12 --min-optimal 500
```

**Write them straight to the levels directory:**
```bash
npm run solve -- --find 10 --max-multiplier 12 --min-optimal 500 --output-dir data/decks/levels
```

**Inspect a single seed:**
```bash
npm run solve -- --seed 24
```

**Check what happens when par gets the same reroll budget as the player (should always equal optimal):**
```bash
npm run solve -- --count 10 --par-rerolls 3
```

## Level file format

Output files land at `data/decks/levels/level-NNNNN.json`:

```json
{
  "id": "level-00024",
  "name": "Untitled Level",
  "deckRef": "standard-double-six",
  "seed": 24,
  "targets": {
    "par": 3604,
    "optimal": 4354
  }
}
```

`deckRef` points to `data/decks/{deckRef}.json`. The game loads the deck's tile set and applies the same seeded shuffle to reproduce the draw order. `name` is intentionally left as a placeholder — rename by hand when curating.

## Design decisions

### Seeded shuffle (mulberry32)

The draw order is derived from the seed via Fisher-Yates shuffle using the mulberry32 PRNG. **This algorithm is permanently locked in** — changing it would invalidate every existing seed. The seed is compact (one integer), human-shareable, and deterministic across platforms.

### par vs optimal

- **par** — beam search with 0 free rerolls (`--par-rerolls 0`). Represents the score a player achieves by making optimal placement choices but never rerolling their hand. Many seeds produce stuck hands under this constraint, so par can be very low.
- **optimal** — beam search with 3 free rerolls (same budget as the player). This is the ceiling a fully optimal player could reach.

When `--par-rerolls 3` is passed, par equals optimal on every seed — confirmed empirically. The gap between par(0) and optimal is entirely the value of the reroll budget.

### Beam search

The solver uses beam search (width 200 by default) over the draw-five game state, calling the same `playFromHand`, `rerollHand`, and `computeScore` functions as the live game. It is not guaranteed to find the global optimum — it's a heuristic — but at width 200 it converges well for 28-tile runs. Increase `--beam` if you want higher-confidence scores at the cost of speed.

### Filter guidelines (from initial experiments)

- `--max-multiplier 12` is a reasonable ceiling for playable levels. Seeds above ×12 tend to have draw orders that deal unplayable hands without rerolls, making par too low to be a meaningful target.
- `--min-optimal 500` filters out low-stakes seeds where the puzzle ends quickly regardless of play quality.
- Roughly 1-in-6 seeds in the range 1–100 pass both filters simultaneously.
