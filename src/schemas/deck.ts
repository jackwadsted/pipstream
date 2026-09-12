import { z } from "zod";
import type { Domino } from "./domino.js";

const TileRefSchema = z.object({
  dominoId: z.string(),
  quantity: z.number().int().min(1).default(1),
});

const ExplicitDeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("explicit"),
  tiles: z.array(TileRefSchema).min(1),
});

const GeneratedDeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("standard-set"),
  /** Generates all (lo, hi) pairs where 0 ≤ lo ≤ hi ≤ maxPip, qty 1 each. */
  maxPip: z.number().int().min(0),
});

export const DeckSchema = z.discriminatedUnion("type", [
  ExplicitDeckSchema,
  GeneratedDeckSchema,
]);

export type Deck = z.infer<typeof DeckSchema>;
export type TileRef = z.infer<typeof TileRefSchema>;

export type ResolvedDeck = {
  id: string;
  name: string;
  tiles: Array<{ domino: Domino; quantity: number }>;
};
