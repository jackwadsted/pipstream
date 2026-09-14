/// <reference types="vite/client" />
import { DominoSchema, type Domino } from "./schemas/domino.js";
import { DeckSchema, type ResolvedDeck } from "./schemas/deck.js";

const dominoModules = import.meta.glob("../data/dominoes/*.json", { eager: true });
const deckModules = import.meta.glob("../data/decks/*.json", { eager: true });
const levelModules = import.meta.glob("../data/decks/levels/*.json", { eager: true });

export interface LevelData {
  id: string;
  name: string;
  deckRef: string;
  seed: number;
  targets: { nearOptimal: number };
}

export function loadLevelsBrowser(): LevelData[] {
  const levels: LevelData[] = [];
  for (const [, mod] of Object.entries(levelModules)) {
    levels.push((mod as { default: LevelData }).default);
  }
  return levels.sort((a, b) => a.seed - b.seed);
}

function loadDominoesBrowser(): Domino[] {
  const dominoes: Domino[] = [];
  for (const [path, mod] of Object.entries(dominoModules)) {
    const result = DominoSchema.safeParse((mod as { default: unknown }).default);
    if (!result.success) {
      throw new Error(`[${path}] Invalid domino data: ${result.error.message}`);
    }
    dominoes.push(result.data);
  }
  return dominoes;
}

function buildDominoMap(dominoes: Domino[]): Map<string, Domino> {
  return new Map(dominoes.map((d) => [d.id, d]));
}

export function loadDeckBrowser(id: string): ResolvedDeck {
  const key = Object.keys(deckModules).find((k) => k.endsWith(`/${id}.json`));
  if (!key) throw new Error(`Deck "${id}" not found`);
  const mod = deckModules[key] as { default: unknown };
  const result = DeckSchema.safeParse(mod.default);
  if (!result.success) {
    throw new Error(`[${key}] Invalid deck data: ${result.error.message}`);
  }
  const deck = result.data;
  const dominoMap = buildDominoMap(loadDominoesBrowser());

  if (deck.type === "explicit") {
    const tiles = deck.tiles.map(({ dominoId, quantity }) => {
      const domino = dominoMap.get(dominoId);
      if (!domino) throw new Error(`Unknown domino "${dominoId}" in deck "${id}"`);
      return { domino, quantity };
    });
    return { id: deck.id, name: deck.name, tiles };
  }

  const tiles: ResolvedDeck["tiles"] = [];
  for (let lo = 0; lo <= deck.maxPip; lo++) {
    for (let hi = lo; hi <= deck.maxPip; hi++) {
      const dominoId = `d${lo}-${hi}`;
      const domino = dominoMap.get(dominoId);
      if (!domino) throw new Error(`Missing domino "${dominoId}" for standard-set deck "${id}"`);
      tiles.push({ domino, quantity: 1 });
    }
  }
  return { id: deck.id, name: deck.name, tiles };
}
