import { eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import type { UserRole } from "../../common/auth-user.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export type UserPublic = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

export class UsersService {
  async listAll(): Promise<UserPublic[]> {
    const db = getDb();
    const { users } = schema();
    const rows = await db.select().from(users);
    return rows.map(toPublic);
  }

  async getById(id: string): Promise<UserPublic | null> {
    const db = getDb();
    const { users } = schema();
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toPublic(row) : null;
  }

  async updateSelf(
    id: string,
    patch: { email?: string },
  ): Promise<UserPublic> {
    const db = getDb();
    const { users } = schema();
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) throw HttpError.notFound("User not found");
    if (patch.email && patch.email !== existing.email) {
      const clash = await db
        .select()
        .from(users)
        .where(eq(users.email, patch.email))
        .limit(1);
      if (clash[0]) throw HttpError.conflict("Email in use");
    }
    const [row] = await db
      .update(users)
      .set({ ...(patch.email ? { email: patch.email } : {}) })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw HttpError.internal("Update failed");
    return toPublic(row);
  }

  async deleteUser(id: string): Promise<void> {
    const db = getDb();
    const { users } = schema();
    await db.delete(users).where(eq(users.id, id));
  }

  async setRole(id: string, role: UserRole): Promise<UserPublic> {
    const db = getDb();
    const { users } = schema();
    const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!row) throw HttpError.notFound("User not found");
    return toPublic(row);
  }
}

function toPublic(row: { id: string; email: string; role: string; createdAt: Date; updatedAt: Date }): UserPublic {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
