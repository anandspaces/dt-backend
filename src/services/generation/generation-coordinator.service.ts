import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { GameHtmlGenerator } from "../ai/generators/game-html-generator.js";
import { tokenBudgetForAtom } from "../ai/token-budget.js";
import { QuizGenerator } from "../ai/generators/quiz-generator.js";
import { verifyGeneratedHtml } from "./html-verification.js";
import {
  topicSummaryPrompt,
  topicQuizPrompt,
  topicGameHtmlPrompt,
  topicAssessmentPrompt,
  chapterSummaryPrompt,
  chapterTestPrompt,
} from "../ai/templates/prompt-registry.js";

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

export type TopicContentType = "topic_summary" | "topic_quiz" | "topic_game" | "topic_assessment";
export type ChapterContentType = "chapter_summary" | "chapter_test";

export class GenerationCoordinator {
  private readonly quiz: QuizGenerator;
  private readonly gameHtml: GameHtmlGenerator;
  private readonly gemini: GeminiClient;

  constructor(
    env: Env,
    gemini: GeminiClient,
  ) {
    this.gemini = gemini;
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

  /** Generate content for an entire topic by aggregating its child atoms. */
  async generateForTopic(
    topicId: string,
    contentType: TopicContentType,
  ): Promise<{ id: string; status: string }> {
    const db = getDb();
    const { topics, atoms, generatedContent } = schema();

    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
    if (!topic) throw new Error(`Topic ${topicId} not found`);

    const topicAtoms = await db
      .select()
      .from(atoms)
      .where(eq(atoms.topicId, topicId))
      .orderBy(asc(atoms.position));
    if (topicAtoms.length === 0) throw new Error(`Topic ${topicId} has no atoms`);

    const atomBodies = topicAtoms.map((a) => a.body);
    const anchorAtomId = topicAtoms[0]!.id;

    let prompt: string;
    switch (contentType) {
      case "topic_summary":
        prompt = topicSummaryPrompt(topic.title, atomBodies);
        break;
      case "topic_quiz":
        prompt = topicQuizPrompt(topic.title, atomBodies);
        break;
      case "topic_game":
        prompt = topicGameHtmlPrompt(topic.title, atomBodies, "medium");
        break;
      case "topic_assessment":
        prompt = topicAssessmentPrompt(topic.title, atomBodies);
        break;
    }

    const [row] = await db
      .insert(generatedContent)
      .values({
        atomId: anchorAtomId,
        contentType,
        status: "running",
        tokenBudget: 4000,
        tokenCost: 0,
        version: 1,
      })
      .returning();
    if (!row) throw new Error("Insert failed");

    try {
      const payload = await this.gemini.generateText(prompt);
      const verified = contentType === "topic_game"
        ? verifyGeneratedHtml(payload).ok
        : payload.trim().startsWith("{") || payload.trim().startsWith("[");

      await db
        .update(generatedContent)
        .set({
          status: "succeeded",
          payload,
          tokenCost: Math.min(4000, payload.length),
          verified,
        })
        .where(eq(generatedContent.id, row.id));

      return { id: row.id, status: "succeeded" };
    } catch {
      await db
        .update(generatedContent)
        .set({ status: "failed" })
        .where(eq(generatedContent.id, row.id));
      return { id: row.id, status: "failed" };
    }
  }

  /** Generate content for an entire chapter by aggregating its topics and key atoms. */
  async generateForChapter(
    chapterId: string,
    contentType: ChapterContentType,
  ): Promise<{ id: string; status: string }> {
    const db = getDb();
    const { chapters, topics, atoms, generatedContent } = schema();

    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`);

    const chapterTopics = await db
      .select()
      .from(topics)
      .where(eq(topics.chapterId, chapterId))
      .orderBy(asc(topics.position));

    const chapterAtoms = await db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, chapterId))
      .orderBy(asc(atoms.position));

    if (chapterAtoms.length === 0) throw new Error(`Chapter ${chapterId} has no atoms`);

    const topicTitles = chapterTopics.map((t) => t.title);
    // Pick up to 3 atoms per topic as key representative atoms
    const keyAtomBodies: string[] = [];
    for (const tp of chapterTopics) {
      const tpAtoms = chapterAtoms
        .filter((a) => a.topicId === tp.id)
        .slice(0, 3);
      for (const a of tpAtoms) keyAtomBodies.push(a.body);
    }
    // Include orphan atoms (no topic) as fallback
    if (keyAtomBodies.length === 0) {
      for (const a of chapterAtoms.slice(0, 9)) keyAtomBodies.push(a.body);
    }

    const anchorAtomId = chapterAtoms[0]!.id;

    let prompt: string;
    switch (contentType) {
      case "chapter_summary":
        prompt = chapterSummaryPrompt(chapter.title, topicTitles, keyAtomBodies);
        break;
      case "chapter_test":
        prompt = chapterTestPrompt(chapter.title, topicTitles, keyAtomBodies);
        break;
    }

    const [row] = await db
      .insert(generatedContent)
      .values({
        atomId: anchorAtomId,
        contentType,
        status: "running",
        tokenBudget: 6000,
        tokenCost: 0,
        version: 1,
      })
      .returning();
    if (!row) throw new Error("Insert failed");

    try {
      const payload = await this.gemini.generateText(prompt);
      const verified = payload.trim().startsWith("{") || payload.trim().startsWith("[");

      await db
        .update(generatedContent)
        .set({
          status: "succeeded",
          payload,
          tokenCost: Math.min(6000, payload.length),
          verified,
        })
        .where(eq(generatedContent.id, row.id));

      return { id: row.id, status: "succeeded" };
    } catch {
      await db
        .update(generatedContent)
        .set({ status: "failed" })
        .where(eq(generatedContent.id, row.id));
      return { id: row.id, status: "failed" };
    }
  }
}
