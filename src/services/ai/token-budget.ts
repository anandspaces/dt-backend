/**
 * Token budget: importance score × content type → max tokens for prompts.
 * Tune multipliers with product data.
 */
export function tokenBudgetForAtom(
  importanceScore: number,
  _contentType: string,
): number {
  const clamped = Math.max(0, Math.min(importanceScore, 10));
  const base = 512;
  const multiplier = 1 + clamped / 4;
  return Math.floor(base * multiplier);
}
