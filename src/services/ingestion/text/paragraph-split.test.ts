import { describe, expect, test } from "bun:test";
import { splitIntoParagraphs } from "./paragraph-split.js";

describe("splitIntoParagraphs", () => {
  test("splits on blank lines", () => {
    const out = splitIntoParagraphs("A line.\n\nSecond block.\n\nThird.");
    expect(out.length).toBe(3);
  });

  test("returns empty for whitespace", () => {
    expect(splitIntoParagraphs("   \n  \n")).toEqual([]);
  });
});
