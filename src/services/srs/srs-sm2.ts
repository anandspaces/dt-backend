/** Minimal SM-2 style step after a study session (quality 0–5, default neutral 3). */
export function nextIntervalAndEase(
  prior: { easeFactor: number; intervalDays: number } | null,
  quality: number,
): { easeFactor: number; intervalDays: number } {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let ease = prior?.easeFactor ?? 2.5;
  let interval = prior?.intervalDays ?? 0;

  if (q < 3) {
    ease = Math.max(1.3, ease - 0.2);
    interval = 1;
  } else {
    if (interval < 1) interval = 1;
    else interval = Math.max(1, Math.round(interval * ease));
    ease += 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
    ease = Math.max(1.3, Math.min(3.0, ease));
  }
  return { easeFactor: ease, intervalDays: interval };
}
