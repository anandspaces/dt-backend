import { describe, expect, test } from "bun:test";
import { detectAtomLanguage, majorityAtomLang } from "./lang-detect.js";

describe("detectAtomLanguage", () => {
  test("English prose defaults to en", () => {
    expect(detectAtomLanguage("Newton's laws describe motion and force.")).toBe("en");
  });

  test("Hindi Devanagari density triggers hi", () => {
    expect(detectAtomLanguage("यह एक उदाहरण पैराग्राफ है जिसमें हिंदी शब्द हैं।")).toBe("hi");
  });
});

describe("majorityAtomLang", () => {
  test("empty defaults to en", () => {
    expect(majorityAtomLang([])).toBe("en");
  });

  test("majority hi", () => {
    expect(majorityAtomLang(["hi", "hi", "en"])).toBe("hi");
  });
});
