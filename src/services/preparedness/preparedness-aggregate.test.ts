import { describe, expect, test } from "bun:test";
import {
  averageQuizScore,
  compositePreparedness,
  coveragePercent,
  weakAtomCountFromAggs,
} from "./preparedness-aggregate.js";

describe("preparedness-aggregate", () => {
  test("averageQuizScore", () => {
    expect(
      averageQuizScore([
        { atomId: "1", avgScore: 80, count: 1 },
        { atomId: "2", avgScore: 60, count: 1 },
      ]),
    ).toBe(70);
  });

  test("coveragePercent", () => {
    expect(coveragePercent(10, 5)).toBe(50);
  });

  test("weakAtomCountFromAggs", () => {
    expect(
      weakAtomCountFromAggs([
        { atomId: "1", avgScore: 40, count: 1 },
        { atomId: "2", avgScore: 90, count: 1 },
      ]),
    ).toBe(1);
  });

  test("compositePreparedness", () => {
    const c = compositePreparedness({
      quizScore: 80,
      retentionScore: 80,
      coveragePercent: 50,
      weakAtomCount: 2,
    });
    expect(c).toBeGreaterThan(50);
    expect(c).toBeLessThanOrEqual(100);
  });
});
