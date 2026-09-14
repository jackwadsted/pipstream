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
  maxMultiplier: number | null;
  minOptimal: number | null;
  beamWidth: number;
  parRerolls: number;
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
    maxMultiplier: has("--max-multiplier") ? parseFloat(flag("--max-multiplier", "12")) : null,
    minOptimal: has("--min-optimal") ? parseInt(flag("--min-optimal", "500"), 10) : null,
    beamWidth: parseInt(flag("--beam", "200"), 10),
    parRerolls: parseInt(flag("--par-rerolls", "0"), 10),
    outputDir: has("--output-dir") ? (flag("--output-dir", "") || null) : null,
  };
}

// ─── solving ─────────────────────────────────────────────────────────────────

interface SolveResult {
  seed: number;
  par: number;
  optimal: number;
}

function solveSeed(
  deck: Parameters<typeof buildInitialState>[0],
  seed: number,
  beamWidth: number,
  parRerolls: number,
): SolveResult {
  const baseConfig: GameConfig = { ...defaultConfig };

  const optimalState = beamSearch(
    buildInitialState(deck, seed, baseConfig),
    baseConfig,
    { beamWidth, allowRerolls: true },
  );
  const optimal = computeScore(optimalState, baseConfig).totalScore;

  const parConfig: GameConfig = { ...baseConfig, freeRerolls: parRerolls };
  const parState = beamSearch(
    buildInitialState(deck, seed, parConfig),
    parConfig,
    { beamWidth, allowRerolls: parRerolls > 0 },
  );
  const par = computeScore(parState, parConfig).totalScore;

  return { seed, par, optimal };
}

// ─── output ──────────────────────────────────────────────────────────────────

function levelJson(deckId: string, r: SolveResult): string {
  return JSON.stringify(
    {
      id: `level-${String(r.seed).padStart(5, "0")}`,
      name: "Untitled Level",
      deckRef: deckId,
      seed: r.seed,
      targets: { par: r.par, optimal: r.optimal },
    },
    null,
    2,
  ) + "\n";
}

function writeLevel(dir: string, deckId: string, r: SolveResult): string {
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `level-${String(r.seed).padStart(5, "0")}.json`);
  fs.writeFileSync(outPath, levelJson(deckId, r));
  return outPath;
}

// ─── main ────────────────────────────────────────────────────────────────────

const args = parseArgs();
const decksDir = path.join(PROJECT_ROOT, "data", "decks");
const deck = loadDeck(args.deckId, undefined, decksDir);

const p = (n: number, w: number) => String(n).padStart(w);

function printTable(results: SolveResult[]): void {
  process.stdout.write("\nseed    par      optimal  ratio\n");
  process.stdout.write("------  -------  -------  -----\n");
  for (const r of results) {
    const ratio = r.par > 0 ? (r.optimal / r.par).toFixed(2) : "N/A";
    process.stdout.write(`${p(r.seed, 6)}  ${p(r.par, 7)}  ${p(r.optimal, 7)}  ${ratio}\n`);
  }
}

if (args.find !== null) {
  // Find mode: iterate seeds until `find` pass the max-multiplier filter.
  const target = args.find;
  const maxMult = args.maxMultiplier;
  const found: SolveResult[] = [];
  let seed = args.startSeed;
  let tried = 0;

  while (found.length < target) {
    tried++;
    process.stderr.write(`\r[seed ${seed}] found ${found.length}/${target}...`);
    const result = solveSeed(deck, seed, args.beamWidth, args.parRerolls);
    const ratio = result.par > 0 ? result.optimal / result.par : Infinity;

    if ((maxMult === null || ratio <= maxMult) && (args.minOptimal === null || result.optimal >= args.minOptimal)) {
      found.push(result);
    }
    seed++;
  }
  process.stderr.write(`\r[done] tried ${tried} seeds, found ${found.length}.\n`);

  found.sort((a, b) => b.optimal - a.optimal);
  printTable(found);

  if (args.outputDir) {
    for (const r of found) writeLevel(args.outputDir, args.deckId, r);
    process.stderr.write(`\n${found.length} levels written to ${args.outputDir}\n`);
  }
} else if (args.count === 1) {
  process.stderr.write(`Solving seed ${args.startSeed} (beam=${args.beamWidth})...\n`);
  const result = solveSeed(deck, args.startSeed, args.beamWidth, args.parRerolls);
  process.stdout.write(levelJson(args.deckId, result));

  if (args.outputDir) {
    const outPath = writeLevel(args.outputDir, args.deckId, result);
    process.stderr.write(`Written to ${outPath}\n`);
  }
} else {
  const results: SolveResult[] = [];
  for (let i = 0; i < args.count; i++) {
    const seed = args.startSeed + i;
    process.stderr.write(`\r[${i + 1}/${args.count}] seed ${seed}...`);
    results.push(solveSeed(deck, seed, args.beamWidth, args.parRerolls));
  }
  process.stderr.write("\n");

  results.sort((a, b) => b.optimal - a.optimal);
  printTable(results);

  if (args.outputDir) {
    for (const r of results) writeLevel(args.outputDir, args.deckId, r);
    process.stderr.write(`\n${results.length} levels written to ${args.outputDir}\n`);
  }
}
