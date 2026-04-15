import { asc, eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class StudentsService {
  async getOrCreateProfile(userId: string) {
    const db = getDb();
    const { studentProfiles } = schema();
    const [existing] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);
    if (existing) return existing;
    const [row] = await db.insert(studentProfiles).values({ userId }).returning();
    if (!row) throw HttpError.internal("Profile create failed");
    return row;
  }

  async updateProfileJson(userId: string, profileJson: string) {
    const db = getDb();
    const { studentProfiles } = schema();
    await this.getOrCreateProfile(userId);
    const [row] = await db
      .update(studentProfiles)
      .set({ profileJson })
      .where(eq(studentProfiles.userId, userId))
      .returning();
    if (!row) throw HttpError.notFound("Profile not found");
    return row;
  }

  async createCalibrationTest(userId: string, title: string) {
    const db = getDb();
    const { calibrationTests } = schema();
    const [row] = await db.insert(calibrationTests).values({ userId, title }).returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async addCalibrationResponse(testId: string, userId: string, questionId: string, answerJson: string) {
    const db = getDb();
    const { calibrationTests, calibrationResponses } = schema();
    const [t] = await db
      .select()
      .from(calibrationTests)
      .where(eq(calibrationTests.id, testId))
      .limit(1);
    if (!t || t.userId !== userId) throw HttpError.notFound("Test not found");
    const [row] = await db
      .insert(calibrationResponses)
      .values({ testId, questionId, answerJson })
      .returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async logInteraction(
    userId: string,
    input: {
      eventType: string;
      atomId?: string | null;
      sessionId?: string | null;
      durationMs?: number | null;
      payload?: Record<string, unknown>;
    },
  ) {
    const db = getDb();
    const { interactionEvents } = schema();
    const [row] = await db
      .insert(interactionEvents)
      .values({
        userId,
        atomId: input.atomId ?? null,
        sessionId: input.sessionId ?? null,
        eventType: input.eventType,
        durationMs: input.durationMs ?? null,
        payloadJson: input.payload ? JSON.stringify(input.payload) : null,
      })
      .returning();
    if (!row) throw HttpError.internal("Log failed");
    return row;
  }

  async listRoadmap(userId: string) {
    const db = getDb();
    const { roadmapItems } = schema();
    return db
      .select()
      .from(roadmapItems)
      .where(eq(roadmapItems.userId, userId))
      .orderBy(asc(roadmapItems.orderIndex));
  }

  async listSrsDue(userId: string) {
    const db = getDb();
    const { srsCards } = schema();
    const now = new Date();
    return db
      .select()
      .from(srsCards)
      .where(eq(srsCards.userId, userId))
      .then((rows) =>
        rows.filter((r) => !r.dueAt || r.dueAt.getTime() <= now.getTime()),
      );
  }
}
