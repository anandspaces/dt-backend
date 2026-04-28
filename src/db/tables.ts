import * as pg from "./schema/postgres/schema.js";

/** Unified schema surface for all services. */
export function schema(): typeof pg {
  return pg;
}
