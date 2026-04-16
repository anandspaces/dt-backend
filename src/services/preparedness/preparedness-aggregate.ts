/** Pure helpers for chapter preparedness (testable without DB). */

export type AtomScoreAgg = { atomId: string; avgScore: number; count: number };

export function averageQuizScore(aggs: AtomScoreAgg[]): number {
  const withData = aggs.filter((a) => a.count > 0);
  if (withData.length === 0) return 0;
  const sum = withData.reduce((s, a) => s + a.avgScore * a.count, 0);
  const n = withData.reduce((s, a) => s + a.count, 0);
  return n === 0 ? 0 : Math.min(100, sum / n);
}

export function coveragePercent(totalAtoms: number, atomsWithPassingActivity: number): number {
  if (totalAtoms === 0) return 0;
  return Math.min(100, (atomsWithPassingActivity / totalAtoms) * 100);
}

export function weakAtomCountFromAggs(aggs: AtomScoreAgg[], threshold = 50): number {
  return aggs.filter((a) => a.count > 0 && a.avgScore < threshold).length;
}

export function compositePreparedness(input: {
  quizScore: number;
  retentionScore: number;
  coveragePercent: number;
  weakAtomCount: number;
}): number {
  const { quizScore, retentionScore, coveragePercent: cov, weakAtomCount: weak } = input;
  const raw = quizScore * 0.35 + retentionScore * 0.35 + cov * 0.2 - weak * 0.1;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}
