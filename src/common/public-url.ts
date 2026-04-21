import type { Env } from "../config/env.js";

/** Join public API origin with a path that starts with `/`. */
export function buildPublicApiUrl(env: Pick<Env, "PUBLIC_API_BASE_URL">, pathStartingWithSlash: string): string {
  const base = (env.PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base.length) return pathStartingWithSlash;
  const path = pathStartingWithSlash.startsWith("/") ? pathStartingWithSlash : `/${pathStartingWithSlash}`;
  return `${base}${path}`;
}
