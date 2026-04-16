import { describe, expect, test } from "bun:test";
import { detectChapterSegments } from "./chapter-split.js";

describe("detectChapterSegments", () => {
  test("single segment when no chapter headings", () => {
    const pages = ["Some intro text.\n\nMore body."];
    const segs = detectChapterSegments(pages);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.title).toBe("Document");
    expect(segs[0]?.pageIndices).toEqual([0]);
  });

  test("splits on Chapter N headings", () => {
    const pages = [
      "Chapter 1\nPhysical World\n\nBody one.",
      "Chapter 2\nUnits\n\nBody two.",
    ];
    const segs = detectChapterSegments(pages);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]?.pageStart).toBe(1);
  });
});
