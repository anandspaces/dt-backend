import { z } from "zod";
import type { Env } from "../../../config/env.js";
import { GeminiClient } from "../gemini.client.js";
import { extractJsonFromModelText } from "../json-extract.js";
import { quizPromptForAtom } from "../templates/prompt-registry.js";
import { tokenBudgetForAtom } from "../token-budget.js";

const quizOutputSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
});

export class QuizGenerator {
  constructor(
    _env: Env,
    private readonly gemini: GeminiClient,
  ) {
    void _env;
  }

  async generate(atomBody: string, importanceScore: number): Promise<string> {
    const budget = tokenBudgetForAtom(importanceScore, "quiz");
    void budget;
    if (!this.gemini.isConfigured()) {
      return JSON.stringify({
        question: "Placeholder (configure Gemini)",
        choices: ["A", "B", "C", "D"],
        answerIndex: 0,
      });
    }
    const raw = await this.gemini.generateText(quizPromptForAtom(atomBody));
    const json = extractJsonFromModelText(raw);
    const parsed = quizOutputSchema.safeParse(JSON.parse(json));
    if (!parsed.success) {
      throw new Error("Quiz output failed validation");
    }
    return JSON.stringify(parsed.data);
  }
}
