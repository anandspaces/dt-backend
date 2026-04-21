import { describe, expect, test } from "bun:test";
import { manifestToPublicResult, type ParseExportManifestV1 } from "./parse-export-generation.service.js";

describe("manifestToPublicResult", () => {
  test("strips internal manifest fields", () => {
    const m = {
      exportId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user-1",
      ttsPendingAtomIds: [],
      ttsMaxAtoms: 10,
      expectedGenerationJobs: 3,
      meta: {
        originalName: "x.pdf",
        pageCount: 1,
        ocrHints: { sparsePageIndices: [], sparseRatio: 0 },
        pipeline: "parse_export_v1" as const,
      },
      chapters: [],
    } satisfies ParseExportManifestV1;
    const pub = manifestToPublicResult(m);
    expect(pub).toEqual({
      exportId: m.exportId,
      meta: m.meta,
      chapters: [],
    });
    expect("userId" in pub).toBe(false);
  });
});
