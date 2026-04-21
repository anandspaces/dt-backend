import { describe, expect, test } from "bun:test";
import { regenerateBodySchema } from "./parse-export-regenerate.js";

describe("regenerateBodySchema", () => {
  test("applies default scope", () => {
    expect(regenerateBodySchema.parse({})).toEqual({ scope: "failed" });
  });

  test("accepts kinds union", () => {
    const v = regenerateBodySchema.parse({
      scope: "all",
      kinds: ["tts", "summary"],
      atomIds: ["550e8400-e29b-41d4-a716-446655440000"],
    });
    expect(v.scope).toBe("all");
    expect(v.kinds).toEqual(["tts", "summary"]);
  });
});
