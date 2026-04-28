import bcrypt from "bcrypt";
import { eq, type InferSelectModel } from "drizzle-orm";
import jwt, { type SignOptions } from "jsonwebtoken";
import { HttpError } from "../../common/http-error.js";
import type { UserRole } from "../../common/auth-user.js";
import type { Env } from "../../config/env.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

const SALT_ROUNDS = 10;

export type SafeUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

export class AuthService {
  constructor(private readonly env: Env) {}

  async register(email: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const db = getDb();
    const { users } = schema();
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      throw HttpError.conflict("Email already registered");
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [row] = await db
      .insert(users)
      .values({ email, passwordHash, role: "student" })
      .returning();
    if (!row) {
      throw HttpError.internal("Failed to create user");
    }
    const token = this.signToken(row.id, row.role as UserRole);
    return { user: toSafeUser(row), token };
  }

  async login(email: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const db = getDb();
    const { users } = schema();
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) {
      throw HttpError.unauthorized("Invalid credentials");
    }
    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) {
      throw HttpError.unauthorized("Invalid credentials");
    }
    const token = this.signToken(row.id, row.role as UserRole);
    return { user: toSafeUser(row), token };
  }

  private signToken(userId: string, role: UserRole): string {
    return jwt.sign({ sub: userId, role }, this.env.JWT_SECRET, {
      expiresIn: this.env.JWT_EXPIRES_IN,
    } as SignOptions);
  }
}

type UserRow = InferSelectModel<typeof users>;

function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
