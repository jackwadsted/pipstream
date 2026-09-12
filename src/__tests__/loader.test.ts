import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDeck, loadDominoes } from "../loader.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipstream-test-"));
  fs.mkdirSync(path.join(dir, "dominoes"));
  fs.mkdirSync(path.join(dir, "decks"));
  return dir;
}

function writeDomino(dir: string, data: object, filename?: string) {
  const id = (data as { id?: string }).id ?? "d0-0";
  fs.writeFileSync(
    path.join(dir, "dominoes", filename ?? `${id}.json`),
    JSON.stringify(data)
  );
}

function writeDeck(dir: string, data: object, filename?: string) {
  const id = (data as { id?: string }).id ?? "test-deck";
  fs.writeFileSync(
    path.join(dir, "decks", filename ?? `${id}.json`),
    JSON.stringify(data)
  );
}

function validDomino(lo: number, hi: number) {
  return { id: `d${lo}-${hi}`, pips: [lo, hi], effects: [], tags: [] };
}

// ─── loadDominoes ────────────────────────────────────────────────────────────

describe("loadDominoes", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("loads the full double-six set — 28 dominoes, no errors", () => {
    const projectData = path.join(new URL("../..", import.meta.url).pathname, "data");
    const dominoes = loadDominoes(path.join(projectData, "dominoes"));
    expect(dominoes).toHaveLength(28);
    // spot-check a few
    const ids = new Set(dominoes.map((d) => d.id));
    expect(ids.has("d0-0")).toBe(true);
    expect(ids.has("d3-5")).toBe(true);
    expect(ids.has("d6-6")).toBe(true);
  });

  it("returns an empty array when the dominoes directory is empty", () => {
    expect(loadDominoes(path.join(tmp, "dominoes"))).toEqual([]);
  });

  it("throws on a domino file with pips in wrong order (hi < lo)", () => {
    writeDomino(tmp, { id: "d5-3", pips: [5, 3], effects: [], tags: [] });
    expect(() => loadDominoes(path.join(tmp, "dominoes"))).toThrowError(
      /pips\[0\] must be ≤ pips\[1\]/
    );
  });

  it("throws on a domino file with a missing required field", () => {
    writeDomino(tmp, { id: "d0-1" }, "d0-1.json"); // missing pips
    expect(() => loadDominoes(path.join(tmp, "dominoes"))).toThrowError(
      /Schema validation failed/
    );
  });

  it("throws on a malformed JSON file", () => {
    fs.writeFileSync(path.join(tmp, "dominoes", "bad.json"), "{ not valid json");
    expect(() => loadDominoes(path.join(tmp, "dominoes"))).toThrowError(
      /Invalid JSON/
    );
  });

  it("throws on duplicate domino IDs across files", () => {
    writeDomino(tmp, validDomino(0, 1));
    // write a second file with the same ID under a different filename
    writeDomino(tmp, validDomino(0, 1), "duplicate.json");
    expect(() => loadDominoes(path.join(tmp, "dominoes"))).toThrowError(
      /Duplicate domino ID/
    );
  });

  it("includes the file path in any error message", () => {
    writeDomino(tmp, { id: "d2-1", pips: [2, 1], effects: [], tags: [] });
    let msg = "";
    try {
      loadDominoes(path.join(tmp, "dominoes"));
    } catch (e) {
      msg = String(e);
    }
    expect(msg).toMatch(/d2-1\.json/);
  });
});

// ─── loadDeck ────────────────────────────────────────────────────────────────

describe("loadDeck — standard-set generator", () => {
  let tmp: string;
  let dominoes: ReturnType<typeof loadDominoes>;

  beforeEach(() => {
    tmp = makeTmpDir();
    // populate 28 dominoes
    for (let lo = 0; lo <= 6; lo++) {
      for (let hi = lo; hi <= 6; hi++) {
        writeDomino(tmp, validDomino(lo, hi));
      }
    }
    dominoes = loadDominoes(path.join(tmp, "dominoes"));
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("resolves standard-double-six to 28 tiles, each qty 1", () => {
    const projectData = path.join(new URL("../..", import.meta.url).pathname, "data");
    const deck = loadDeck("standard-double-six", dominoes, path.join(projectData, "decks"));
    expect(deck.tiles).toHaveLength(28);
    expect(deck.tiles.every((t) => t.quantity === 1)).toBe(true);
  });

  it("generated deck contains every expected domino ID", () => {
    writeDeck(tmp, { id: "gen", name: "Gen", type: "standard-set", maxPip: 2 });
    const deck = loadDeck("gen", dominoes, path.join(tmp, "decks"));
    const ids = deck.tiles.map((t) => t.domino.id).sort();
    expect(ids).toEqual(["d0-0", "d0-1", "d0-2", "d1-1", "d1-2", "d2-2"]);
  });

  it("throws when standard-set generator references a maxPip not in the domino set", () => {
    writeDeck(tmp, { id: "big", name: "Big", type: "standard-set", maxPip: 9 });
    expect(() => loadDeck("big", dominoes, path.join(tmp, "decks"))).toThrowError(
      /missing from the loaded domino set/
    );
  });
});

describe("loadDeck — explicit tile list", () => {
  let tmp: string;
  let dominoes: ReturnType<typeof loadDominoes>;

  beforeEach(() => {
    tmp = makeTmpDir();
    writeDomino(tmp, validDomino(0, 0));
    writeDomino(tmp, validDomino(0, 1));
    dominoes = loadDominoes(path.join(tmp, "dominoes"));
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it("resolves explicit tiles with correct quantities", () => {
    writeDeck(tmp, {
      id: "custom",
      name: "Custom",
      type: "explicit",
      tiles: [
        { dominoId: "d0-0", quantity: 3 },
        { dominoId: "d0-1", quantity: 1 },
      ],
    });
    const deck = loadDeck("custom", dominoes, path.join(tmp, "decks"));
    expect(deck.tiles).toHaveLength(2);
    expect(deck.tiles[0]?.quantity).toBe(3);
    expect(deck.tiles[1]?.quantity).toBe(1);
  });

  it("throws on an explicit deck referencing an unknown domino ID", () => {
    writeDeck(tmp, {
      id: "bad-ref",
      name: "Bad Ref",
      type: "explicit",
      tiles: [{ dominoId: "d9-9", quantity: 1 }],
    });
    expect(() => loadDeck("bad-ref", dominoes, path.join(tmp, "decks"))).toThrowError(
      /Unknown domino ID "d9-9"/
    );
  });

  it("throws on a deck file that fails schema validation", () => {
    writeDeck(tmp, { id: "bad-schema", name: "Bad", type: "explicit", tiles: [] });
    expect(() => loadDeck("bad-schema", dominoes, path.join(tmp, "decks"))).toThrowError(
      /Schema validation failed/
    );
  });

  it("allows quantity > 1 (roguelike duplicate tiles)", () => {
    writeDeck(tmp, {
      id: "dupes",
      name: "Dupes",
      type: "explicit",
      tiles: [{ dominoId: "d0-0", quantity: 10 }],
    });
    const deck = loadDeck("dupes", dominoes, path.join(tmp, "decks"));
    expect(deck.tiles[0]?.quantity).toBe(10);
  });
});
