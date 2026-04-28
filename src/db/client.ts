import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env.js";
import * as schema from "./schema/postgres/schema.js";

export type AppDb = PostgresJsDatabase<typeof schema>;

export function createDb(env: Env): AppDb {
  const client = postgres(env.DATABASE_URL, { max: 10 });
  return drizzle(client, { schema });
}
