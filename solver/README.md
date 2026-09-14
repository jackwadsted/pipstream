# Pipstream Solver

Offline beam-search solver for generating puzzle levels. Lives outside `src/` because it's a build tool, not part of the game bundle — it imports the engine directly and is never shipped to players.

## Running

```bash
npm run solve -- [flags]
```

## Flags

| Flag | Default | Description |
|---|---|---|
| `--seed N` | `1` | Starting seed |
| `--count N` | `1` | Solve N consecutive seeds starting from `--seed` |
| `--find N` | — | Iterate seeds until N pass all filters (use when curating levels) |
| `--min-score N` | — | Skip seeds where `nearOptimal` < N |
| `--min-human-ratio X` | `0.5` | Skip seeds where the human-equivalent score is less than X× the ceiling (filters out unlucky draws a real player can't recover from) |
| `--deck ID` | `standard-double-six` | Deck to load from `data/decks/{ID}.json` |
| `--output-dir PATH` | — | Write a level JSON file per result to this directory |

## Typical workflows

**Find 10 curated levels and write them straight to the levels directory:**
```bash
npm run solve -- --find 10 --min-score 500 --output-dir data/decks/levels
```

**Scan a range to see score distribution before picking filters:**
```bash
npm run solve -- --count 50
```

**Inspect a single seed:**
```bash
npm run solve -- --seed 24
```

**Raise the human-reachability bar (only levels where a human can get 70%+ of the ceiling):**
```bash
npm run solve -- --find 10 --min-score 500 --min-human-ratio 0.7 --output-dir data/decks/levels
```

## How it works

### The beam search

Beam search is a heuristic tree search that balances exploration with practicality. At each step it keeps only the N best game states seen so far (the "beam"), expands each one by trying every legal move, scores the results, and keeps the top N again. It repeats until all states are finished.

**What beam width represents:** a wider beam = a stronger player. A beam of 1 is pure greedy — it always picks whichever single move looks best right now, with no fallback if that path turns out poorly. A beam of 200 explores a much richer set of paths in parallel, recovering from locally-suboptimal moves that turn out to be globally good.

A human player's effective beam width is roughly 3–4: they can hold a few candidate plans in mind and pick the most promising, but they can't exhaustively evaluate hundreds of continuations.

Beam search is not guaranteed to find the global optimum — it's a heuristic. But at width 200 it converges reliably on near-optimal play for 28-tile runs. **Importantly, it is not monotonic in beam width:** a narrower beam can occasionally stumble onto a better path than a wider one because the two searches take different branches early on and never converge. The solver accounts for this by taking the best score found by either the human or the optimal run.

### Two runs per seed

Each seed is solved twice:

1. **Human run** (beam = 3): simulates a typical player who uses their 3 free rerolls and makes decent move choices, but doesn't look far ahead. This score is used only as a reachability filter — it's not stored in the level file.

2. **Optimal run** (beam = 200): finds the best score a near-optimal player can achieve. This becomes the level's `nearOptimal` target. The stored ceiling is `max(human score, optimal score)` so it always reflects the best-known achievable result.

### Level selection filter

Seeds are rejected if the human score is less than `--min-human-ratio` × `nearOptimal` (default 50%). This filters out seeds where the draw order is so unlucky that a human player gets stuck regardless of skill. The remaining seeds are the ones where good play is both rewarded and reachable.

### Stars

Stars are awarded in-game at fixed fractions of the `nearOptimal` ceiling:

| Stars | Threshold |
|---|---|
| ★☆☆ | 60% of nearOptimal |
| ★★☆ | 80% of nearOptimal |
| ★★★ | 100% of nearOptimal |

These thresholds are constants in `src/lib/completedLevels.ts` and can be tuned after playtesting.

## Level file format

Output files land at `data/decks/levels/level-NNNNN.json`:

```json
{
  "id": "level-00024",
  "name": "Untitled Level",
  "deckRef": "standard-double-six",
  "seed": 24,
  "targets": {
    "nearOptimal": 4354
  }
}
```

`deckRef` points to `data/decks/{deckRef}.json`. The game loads the deck's tile set and applies the same seeded shuffle to reproduce the draw order. `name` is intentionally left as a placeholder — rename by hand when curating.

## Design decisions

### Seeded shuffle (mulberry32)

The draw order is derived from the seed via Fisher-Yates shuffle using the mulberry32 PRNG. **This algorithm is permanently locked in** — changing it would invalidate every existing seed. The seed is compact (one integer), human-shareable, and deterministic across platforms.

### Why not more beam runs for difficulty tiers?

An earlier design ran the solver at three beam widths (3, 6, 10) to produce easy/hard/nearOptimal targets. This was abandoned because:

- Beam search is non-monotonic in width: beam=3 regularly outscores beam=6 or beam=10 on specific seeds, so the ordering is not reliable.
- The tiers don't have a natural game-design meaning. The ceiling does: it's the best known score for this seed, full stop.

The current design is cleaner — one number defines the ceiling, and stars are awarded at fractions of it. The human-run filter handles reachability separately.
