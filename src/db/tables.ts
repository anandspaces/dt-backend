import { getDbDriver } from "./global.js";
import * as pg from "./schema/postgres/schema.js";
import * as sqlite from "./schema/sqlite/schema.js";

/** Unified schema surface; both drivers expose the same table names. */
export function schema(): typeof sqlite {
  return (getDbDriver() === "postgresql" ? pg : sqlite) as typeof sqlite;
}
