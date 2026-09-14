#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeck } from "../src/loader.js";
import { defaultConfig, type GameConfig } from "../src/engine/types.js";
import { computeScore } from "../src/engine/scoring.js";
import { buildInitialState, beamSearch } from "./beamSearch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── arg parsing ─────────────────────────────────────────────────────────────

interface Args {
  deckId: string;
  startSeed: number;
  count: number;
  find: number | null;
  minHumanRatio: number;
  minScore: number | null;
  outputDir: string | null;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const flag = (name: string, fallback: string): string => {
    const i = raw.indexOf(name);
    return i !== -1 ? (raw[i + 1] ?? fallback) : fallback;
  };
  const has = (name: string) => raw.includes(name);
  return {
    deckId: flag("--deck", "standard-double-six"),
    startSeed: parseInt(flag("--seed", "1"), 10),
    count: parseInt(flag("--count", "1"), 10),
    find: has("--find") ? parseInt(flag("--find", "10"), 10) : null,
    // Filter: human-equivalent (beam=3) score must be >= this fraction of nearOptimal.
    // Seeds below this threshold have unlucky draws a human can't recover from.
    minHumanRatio: parseFloat(flag("--min-human-ratio", "0.5")),
    minScore: has("--min-score") ? parseInt(flag("--min-score", "500"), 10) : null,
    outputDir: has("--output-dir") ? (flag("--output-dir", "") || null) : null,
  };
}

// ─── solving ─────────────────────────────────────────────────────────────────

const FREE_REROLLS = 3;
const BEAM_HUMAN = 3;    // representative human lookahead — used for reachability filter only
const BEAM_OPTIMAL = 200; // ceiling — stored as the level target

interface SolveResult {
  seed: number;
  humanScore: number;   // beam=3, used for filtering, not stored in level file
  nearOptimal: number;  // beam=200, the level ceiling
}

function solveSeed(
  deck: Parameters<typeof buildInitialState>[0],
  seed: number,
): SolveResult {
  const config: GameConfig = { ...defaultConfig, freeRerolls: FREE_REROLLS };
  const run = (beamWidth: number) =>
    computeScore(
      beamSearch(buildInitialState(deck, seed, config), config, { beamWidth, allowRerolls: true }),
      config,
    ).totalScore;

  const humanScore = run(BEAM_HUMAN);
  const optimalScore = run(BEAM_OPTIMAL);
  // Take the best of both runs — beam search is not monotonic in width.
  return { seed, humanScore, nearOptimal: Math.max(humanScore, optimalScore) };
}

// ─── output ──────────────────────────────────────────────────────────────────

function levelJson(deckId: string, r: SolveResult, name: string): string {
  return JSON.stringify(
    {
      id: `level-${String(r.seed).padStart(5, "0")}`,
      name,
      deckRef: deckId,
      seed: r.seed,
      targets: { nearOptimal: r.nearOptimal },
    },
    null,
    2,
  ) + "\n";
}

function writeLevel(dir: string, deckId: string, r: SolveResult, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `level-${String(r.seed).padStart(5, "0")}.json`);
  fs.writeFileSync(outPath, levelJson(deckId, r, name));
  return outPath;
}

// ─── main ────────────────────────────────────────────────────────────────────

const args = parseArgs();
const decksDir = path.join(PROJECT_ROOT, "data", "decks");
const deck = loadDeck(args.deckId, undefined, decksDir);

const p = (n: number, w: number) => String(n).padStart(w);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4);

function printTable(results: SolveResult[]): void {
  process.stdout.write("\nseed    human    nearOpt  ratio\n");
  process.stdout.write("------  -------  -------  -----\n");
  for (const r of results) {
    const ratio = r.nearOptimal > 0 ? r.humanScore / r.nearOptimal : 0;
    process.stdout.write(`${p(r.seed, 6)}  ${p(r.humanScore, 7)}  ${p(r.nearOptimal, 7)}  ${pct(ratio)}\n`);
  }
}

function passesFilters(r: SolveResult): boolean {
  const ratio = r.nearOptimal > 0 ? r.humanScore / r.nearOptimal : 0;
  if (ratio < args.minHumanRatio) return false;
  if (args.minScore !== null && r.nearOptimal < args.minScore) return false;
  return true;
}

if (args.find !== null) {
  const target = args.find;
  const found: SolveResult[] = [];
  let seed = args.startSeed;
  let tried = 0;

  while (found.length < target) {
    tried++;
    process.stderr.write(`\r[seed ${seed}] found ${found.length}/${target}...`);
    const result = solveSeed(deck, seed);
    if (passesFilters(result)) found.push(result);
    seed++;
  }
  process.stderr.write(`\r[done] tried ${tried} seeds, found ${found.length}.\n`);

  found.sort((a, b) => b.nearOptimal - a.nearOptimal);
  printTable(found);

  if (args.outputDir) {
    found.forEach((r, i) => writeLevel(args.outputDir!, args.deckId, r, String(i + 1)));
    process.stderr.write(`\n${found.length} levels written to ${args.outputDir}\n`);
  }
} else if (args.count === 1) {
  process.stderr.write(`Solving seed ${args.startSeed}...\n`);
  const result = solveSeed(deck, args.startSeed);
  process.stdout.write(levelJson(args.deckId, result, "1"));

  if (args.outputDir) {
    const outPath = writeLevel(args.outputDir, args.deckId, result, "1");
    process.stderr.write(`Written to ${outPath}\n`);
  }
} else {
  const results: SolveResult[] = [];
  for (let i = 0; i < args.count; i++) {
    const seed = args.startSeed + i;
    process.stderr.write(`\r[${i + 1}/${args.count}] seed ${seed}...`);
    results.push(solveSeed(deck, seed));
  }
  process.stderr.write("\n");

  results.sort((a, b) => b.nearOptimal - a.nearOptimal);
  printTable(results);

  if (args.outputDir) {
    results.forEach((r, i) => writeLevel(args.outputDir!, args.deckId, r, String(i + 1)));
    process.stderr.write(`\n${results.length} levels written to ${args.outputDir}\n`);
  }
}
