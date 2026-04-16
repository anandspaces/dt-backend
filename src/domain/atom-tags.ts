import { z } from "zod";

/** Twelve-ish pedagogical tags aligned with the product spec. */
export const atomPrimaryTagSchema = z.enum([
  "DEFINITION",
  "FORMULA",
  "PROCESS",
  "COMPARISON",
  "EXAMPLE",
  "FACT_LIST",
  "DIAGRAM_REF",
  "EXPERIMENT",
  "THEOREM_LAW",
  "HISTORICAL",
  "INTRO_CONTEXT",
  "CONCEPT",
]);

export type AtomPrimaryTag = z.infer<typeof atomPrimaryTagSchema>;

export const atomClassificationOutputSchema = z.object({
  primary: atomPrimaryTagSchema,
  tags: z.array(atomPrimaryTagSchema).min(1).max(6),
});

export type AtomClassificationOutput = z.infer<typeof atomClassificationOutputSchema>;

export function normalizePrimaryTag(raw: string): AtomPrimaryTag {
  const u = raw.trim().toUpperCase().replace(/\s+/g, "_");
  const parsed = atomPrimaryTagSchema.safeParse(u);
  return parsed.success ? parsed.data : "CONCEPT";
}
