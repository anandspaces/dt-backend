import { describe, expect, test } from "bun:test";
import {
  glossaryPromptForAtom,
  microGamePromptForAtom,
  gameHtmlPromptForAtom,
  topicSummaryPrompt,
  topicQuizPrompt,
  topicGameHtmlPrompt,
  topicAssessmentPrompt,
  chapterSummaryPrompt,
  chapterTestPrompt,
  illustrationImagePromptForAtom,
  illustrationImagePromptForTopic,
  illustrationImagePromptForChapter,
} from "./prompt-registry.js";

const SAMPLE_ATOM = "Photosynthesis is the process by which green plants convert carbon dioxide and water into glucose and oxygen using sunlight. The chloroplast contains chlorophyll, which absorbs light energy.";

describe("glossaryPromptForAtom", () => {
  test("returns non-empty string containing key instructions", () => {
    const result = glossaryPromptForAtom(SAMPLE_ATOM);
    expect(result.length).toBeGreaterThan(50);
    expect(result).toContain("word");
    expect(result).toContain("meaning");
    expect(result).toContain("JSON");
  });
});

describe("microGamePromptForAtom", () => {
  test("returns HTML game instructions", () => {
    const result = microGamePromptForAtom(SAMPLE_ATOM, "chloroplast, chlorophyll");
    expect(result).toContain("DEXTORA_COMPLETE");
    expect(result).toContain("micro-game");
    expect(result).toContain("chloroplast");
    expect(result).toMatch(/HTML5|semantic/i);
  });
});

describe("gameHtmlPromptForAtom", () => {
  test("invites full HTML5 and DEXTORA_COMPLETE", () => {
    const r = gameHtmlPromptForAtom(SAMPLE_ATOM, "high");
    expect(r).toContain("DEXTORA_COMPLETE");
    expect(r).toMatch(/HTML5|semantic/i);
    expect(r).toMatch(/SVG|MathML|canvas/i);
  });
});

describe("topic-level prompts", () => {
  const bodies = [SAMPLE_ATOM, "The light reactions occur in the thylakoid membranes."];

  test("topicSummaryPrompt includes topic title and paragraphs", () => {
    const r = topicSummaryPrompt("Photosynthesis", bodies);
    expect(r).toContain("Photosynthesis");
    expect(r).toContain("[1]");
    expect(r).toContain("summary");
  });

  test("topicQuizPrompt asks for questions JSON", () => {
    const r = topicQuizPrompt("Photosynthesis", bodies);
    expect(r).toContain("questions");
    expect(r).toContain("answerIndex");
  });

  test("topicGameHtmlPrompt includes DEXTORA_COMPLETE", () => {
    const r = topicGameHtmlPrompt("Photosynthesis", bodies, "high");
    expect(r).toContain("DEXTORA_COMPLETE");
    expect(r).toContain("ENTIRE topic");
    expect(r).toMatch(/HTML5|semantic/i);
  });

  test("topicAssessmentPrompt asks for short-answer questions", () => {
    const r = topicAssessmentPrompt("Photosynthesis", bodies);
    expect(r).toContain("expectedAnswer");
    expect(r).toContain("marks");
  });
});

describe("chapter-level prompts", () => {
  const topicTitles = ["Photosynthesis", "Respiration"];
  const keyBodies = [SAMPLE_ATOM];

  test("chapterSummaryPrompt includes topics and summary instruction", () => {
    const r = chapterSummaryPrompt("Life Processes", topicTitles, keyBodies);
    expect(r).toContain("Life Processes");
    expect(r).toContain("Photosynthesis");
    expect(r).toContain("Respiration");
    expect(r).toContain("topicOverviews");
  });

  test("chapterTestPrompt asks for mixed-format test", () => {
    const r = chapterTestPrompt("Life Processes", topicTitles, keyBodies);
    expect(r).toContain("mcq");
    expect(r).toContain("short_answer");
    expect(r).toContain("true_false");
  });
});

describe("illustration image prompts", () => {
  test("atom prompt is plain-text image brief with CBSE tone", () => {
    const r = illustrationImagePromptForAtom(SAMPLE_ATOM, "biology", "Section 1");
    expect(r.length).toBeGreaterThan(80);
    expect(r).toMatch(/CBSE|Indian school/i);
    expect(r).toContain("biology");
    expect(r).toContain("Section 1");
    expect(r).toMatch(/watermark|no watermarks/i);
  });

  test("topic prompt describes hero visual", () => {
    const r = illustrationImagePromptForTopic("Photosynthesis", [SAMPLE_ATOM]);
    expect(r.length).toBeGreaterThan(60);
    expect(r).toContain("Photosynthesis");
    expect(r).toMatch(/CBSE|Indian school/i);
  });

  test("chapter prompt is cover-style brief", () => {
    const r = illustrationImagePromptForChapter("Life Processes", ["A", "B"], [SAMPLE_ATOM]);
    expect(r.length).toBeGreaterThan(60);
    expect(r).toContain("Life Processes");
    expect(r).toMatch(/chapter|cover|opener/i);
  });
});
