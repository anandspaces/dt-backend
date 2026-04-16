import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { GameHtmlGenerator } from "../ai/generators/game-html-generator.js";
import { tokenBudgetForAtom } from "../ai/token-budget.js";
import { QuizGenerator } from "../ai/generators/quiz-generator.js";
import { verifyGeneratedHtml } from "./html-verification.js";

function verifyQuizPayload(payload: string): boolean {
  try {
    const o = JSON.parse(payload) as {
      question?: unknown;
      choices?: unknown;
      answerIndex?: unknown;
    };
    return (
      typeof o.question === "string" &&
      Array.isArray(o.choices) &&
      o.choices.length === 4 &&
      typeof o.answerIndex === "number"
    );
  } catch {
    return false;
  }
}

export class GenerationCoordinator {
  private readonly quiz: QuizGenerator;
  private readonly gameHtml: GameHtmlGenerator;

  constructor(
    env: Env,
    gemini: GeminiClient,
  ) {
    this.quiz = new QuizGenerator(env, gemini);
    this.gameHtml = new GameHtmlGenerator(env, gemini);
  }

  async generateForAtoms(
    atomIds: string[],
    contentType: "quiz" | "game",
    _priority: "high" | "low",
  ): Promise<void> {
    void _priority;
    const db = getDb();
    const { atoms, atomScores, generatedContent } = schema();
    for (const atomId of atomIds) {
      const [atom] = await db.select().from(atoms).where(eq(atoms.id, atomId)).limit(1);
      if (!atom) continue;
      const [scoreRow] = await db
        .select()
        .from(atomScores)
        .where(eq(atomScores.atomId, atomId))
        .limit(1);
      const importance = scoreRow?.score ?? 1;
      const budget = tokenBudgetForAtom(importance, contentType);
      const [row] = await db
        .insert(generatedContent)
        .values({
          atomId,
          contentType,
          status: "running",
          tokenBudget: budget,
          tokenCost: 0,
          version: 1,
        })
        .returning();
      if (!row) continue;
      try {
        let payload: string;
        let verified = false;
        if (contentType === "quiz") {
          payload = await this.quiz.generate(atom.body, importance);
          verified = verifyQuizPayload(payload);
        } else {
          payload = await this.gameHtml.generate(atom.body, importance);
          const v = verifyGeneratedHtml(payload);
          verified = v.ok;
        }
        await db
          .update(generatedContent)
          .set({
            status: "succeeded",
            payload,
            tokenCost: Math.min(budget, payload.length),
            verified,
          })
          .where(eq(generatedContent.id, row.id));
      } catch {
        await db
          .update(generatedContent)
          .set({ status: "failed" })
          .where(eq(generatedContent.id, row.id));
      }
    }
  }
}
