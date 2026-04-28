import type { Env } from "../config/env.js";

/**
 * Join public origin with a path starting with `/`.
 * Parse-export artifact URLs use `PUBLIC_ARTIFACT_BASE_URL` when set, else `PUBLIC_API_BASE_URL`.
 */
export function buildPublicApiUrl(
  env: Pick<Env, "PUBLIC_API_BASE_URL" | "PUBLIC_ARTIFACT_BASE_URL">,
  pathStartingWithSlash: string,
): string {
  const base = (env.PUBLIC_ARTIFACT_BASE_URL ?? env.PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base.length) return pathStartingWithSlash;
  const path = pathStartingWithSlash.startsWith("/") ? pathStartingWithSlash : `/${pathStartingWithSlash}`;
  return `${base}${path}`;
}
