import { describe, expect, test } from "bun:test";
import { bestAtomMatch, splitQuestionBlocks } from "./pyq-ingestion.service.js";

describe("splitQuestionBlocks", () => {
  test("splits numbered blocks", () => {
    const t = "1) First long question text here.\n2) Second question also long enough.";
    const blocks = splitQuestionBlocks(t);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });
});

describe("bestAtomMatch", () => {
  test("picks atom with overlapping tokens", () => {
    const atoms = [
      { id: "a1", body: "horizontal range projectile motion formula" },
      { id: "a2", body: "unrelated poetry text" },
    ];
    const q = "What is the horizontal range of a projectile?";
    const { atomId, score } = bestAtomMatch(q, atoms);
    expect(atomId).toBe("a1");
    expect(score).toBeGreaterThan(0);
  });
});
