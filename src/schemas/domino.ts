import { z } from "zod";

export const DominoSchema = z.object({
  id: z.string().regex(/^d\d+-\d+$/, 'id must match pattern "d{lo}-{hi}"'),
  pips: z
    .tuple([z.number().int().min(0), z.number().int().min(0)])
    .refine(([lo, hi]) => lo <= hi, {
      message: "pips[0] must be ≤ pips[1] (canonical low-to-high form)",
    }),
  /**
   * Extension point for future power-up associations.
   * Each entry will become a typed discriminated union once the power-up
   * system is designed. For now, any object is accepted.
   */
  effects: z.array(z.record(z.unknown())).optional().default([]),
  /**
   * Categorical tags for grouping/filtering (e.g. "starter", "cursed").
   * Unused in the base game; reserved for future mechanics and cosmetics.
   */
  tags: z.array(z.string()).optional().default([]),
});

export type Domino = z.infer<typeof DominoSchema>;
