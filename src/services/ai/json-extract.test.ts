import { describe, expect, test } from "bun:test";
import { extractJsonFromModelText } from "./json-extract.js";

describe("extractJsonFromModelText", () => {
  test("strips markdown fences", () => {
    expect(extractJsonFromModelText("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  test("returns trimmed raw json", () => {
    expect(extractJsonFromModelText('  {"x":2}  ')).toBe('{"x":2}');
  });
});
