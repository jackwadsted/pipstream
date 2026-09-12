import * as fs from "node:fs";
import * as path from "node:path";
import { DominoSchema, type Domino } from "./schemas/domino.js";
import { DeckSchema, type Deck, type ResolvedDeck } from "./schemas/deck.js";

const PROJECT_ROOT = new URL("..", import.meta.url).pathname;

function dataDir(...parts: string[]): string {
  return path.join(PROJECT_ROOT, "data", ...parts);
}

function parseJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`[${filePath}] Could not read file: ${String(err)}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`[${filePath}] Invalid JSON: ${String(err)}`);
  }
}

function formatZodError(filePath: string, issues: { path: (string | number)[]; message: string }[]): string {
  const details = issues
    .map((i) => `  .${i.path.join(".")}: ${i.message}`)
    .join("\n");
  return `[${filePath}] Schema validation failed:\n${details}`;
}

/**
 * Loads and validates every *.json file under data/dominoes/.
 * Throws on any validation error, duplicate ID, or unreadable file.
 */
export function loadDominoes(dominoesDir?: string): Domino[] {
  const dir = dominoesDir ?? dataDir("dominoes");
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch (err) {
    throw new Error(`[${dir}] Could not read dominoes directory: ${String(err)}`);
  }

  const dominoes: Domino[] = [];
  const seenIds = new Map<string, string>();

  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = parseJsonFile(filePath);
    const result = DominoSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(formatZodError(filePath, result.error.issues));
    }
    const domino = result.data;
    const existing = seenIds.get(domino.id);
    if (existing !== undefined) {
      throw new Error(
        `[${filePath}] Duplicate domino ID "${domino.id}" (first seen in ${existing})`
      );
    }
    seenIds.set(domino.id, filePath);
    dominoes.push(domino);
  }

  return dominoes;
}

/**
 * Loads and validates a single deck by ID from data/decks/{id}.json.
 * Resolves all domino references against the provided (or auto-loaded) domino set.
 * Throws on validation errors, unknown domino IDs, or unreadable files.
 */
export function loadDeck(
  id: string,
  dominoes?: Domino[],
  decksDir?: string
): ResolvedDeck {
  const filePath = path.join(decksDir ?? dataDir("decks"), `${id}.json`);
  const raw = parseJsonFile(filePath);
  const result = DeckSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatZodError(filePath, result.error.issues));
  }
  const deck: Deck = result.data;
  const dominoMap = buildDominoMap(dominoes ?? loadDominoes());

  return resolveDeck(deck, dominoMap, filePath);
}

function buildDominoMap(dominoes: Domino[]): Map<string, Domino> {
  return new Map(dominoes.map((d) => [d.id, d]));
}

function resolveDeck(
  deck: Deck,
  dominoMap: Map<string, Domino>,
  filePath: string
): ResolvedDeck {
  if (deck.type === "explicit") {
    const tiles = deck.tiles.map(({ dominoId, quantity }) => {
      const domino = dominoMap.get(dominoId);
      if (domino === undefined) {
        throw new Error(
          `[${filePath}] Unknown domino ID "${dominoId}" — not found in loaded domino set`
        );
      }
      return { domino, quantity };
    });
    return { id: deck.id, name: deck.name, tiles };
  }

  // type === "standard-set": generate all (lo, hi) pairs, qty 1 each
  const tiles: ResolvedDeck["tiles"] = [];
  for (let lo = 0; lo <= deck.maxPip; lo++) {
    for (let hi = lo; hi <= deck.maxPip; hi++) {
      const dominoId = `d${lo}-${hi}`;
      const domino = dominoMap.get(dominoId);
      if (domino === undefined) {
        throw new Error(
          `[${filePath}] Standard-set generator expected domino "${dominoId}" (maxPip=${deck.maxPip}) but it is missing from the loaded domino set`
        );
      }
      tiles.push({ domino, quantity: 1 });
    }
  }
  return { id: deck.id, name: deck.name, tiles };
}

/**
 * Loads and validates all dominoes and all decks, then resolves every deck.
 * Use this as a build-time or CI check. Throws on the first error encountered.
 */
export function validateAll(dataRoot?: string): void {
  const dominoesDir = dataRoot ? path.join(dataRoot, "dominoes") : undefined;
  const decksDir = dataRoot ? path.join(dataRoot, "decks") : undefined;

  const dominoes = loadDominoes(dominoesDir);

  const deckFiles = fs
    .readdirSync(decksDir ?? dataDir("decks"))
    .filter((f) => f.endsWith(".json"));

  for (const file of deckFiles) {
    const id = path.basename(file, ".json");
    loadDeck(id, dominoes, decksDir ?? dataDir("decks"));
  }
}
