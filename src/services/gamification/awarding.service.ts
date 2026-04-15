import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class AwardingService {
  async grantXp(
    userId: string,
    source: string,
    amount: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const db = getDb();
    const { xpEvents, userXp } = schema();
    await db.insert(xpEvents).values({
      userId,
      source,
      amount,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    });
    const rows = await db.select().from(userXp).where(eq(userXp.userId, userId)).limit(1);
    if (rows[0]) {
      await db
        .update(userXp)
        .set({ totalXp: rows[0].totalXp + amount })
        .where(eq(userXp.userId, userId));
    } else {
      await db.insert(userXp).values({ userId, totalXp: amount });
    }
  }
}
