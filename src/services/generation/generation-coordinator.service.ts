import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { tokenBudgetForAtom } from "../ai/token-budget.js";
import { QuizGenerator } from "../ai/generators/quiz-generator.js";

export class GenerationCoordinator {
  private readonly quiz: QuizGenerator;

  constructor(
    _env: Env,
    gemini: GeminiClient,
  ) {
    void _env;
    this.quiz = new QuizGenerator(_env, gemini);
  }

  async generateForAtoms(
    atomIds: string[],
    contentType: "quiz" | "game",
    priority: "high" | "low",
  ): Promise<void> {
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
        if (contentType === "quiz") {
          payload = await this.quiz.generate(atom.body, importance);
        } else {
          payload = JSON.stringify({ kind: "game", stub: true, priority });
        }
        await db
          .update(generatedContent)
          .set({
            status: "succeeded",
            payload,
            tokenCost: Math.min(budget, payload.length),
            verified: false,
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
