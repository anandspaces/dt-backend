import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env.js";

/** Prefer dedicated secret in production; falls back to JWT_SECRET. */
export function getFileUrlSigningSecret(env: Pick<Env, "FILE_URL_SIGNING_SECRET" | "JWT_SECRET">): string {
  const s = env.FILE_URL_SIGNING_SECRET?.trim();
  return s?.length ? s : env.JWT_SECRET;
}

export function signFileBlobAccess(key: string, mime: string, expUnix: number, secret: string): string {
  const payload = `${key}|${expUnix}|${mime}`;
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

export function verifyFileBlobAccess(
  key: string,
  mime: string,
  expStr: string,
  sigB64: string,
  secret: string,
): boolean {
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signFileBlobAccess(key, mime, exp, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sigB64, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Adds `exp` + `sig` so GET /files/audio can authorize without JWT (tamper-evident). */
export function appendPublicFileSignature(
  params: URLSearchParams,
  key: string,
  mime: string,
  env: Pick<Env, "FILE_URL_PUBLIC_TTL_SECONDS" | "FILE_URL_SIGNING_SECRET" | "JWT_SECRET">,
): void {
  const ttl = env.FILE_URL_PUBLIC_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const secret = getFileUrlSigningSecret(env);
  params.set("exp", String(exp));
  params.set("sig", signFileBlobAccess(key, mime, exp, secret));
}

export function buildSignedFilesAudioRelativeUrl(
  key: string,
  mime: string,
  env: Pick<Env, "FILE_URL_PUBLIC_TTL_SECONDS" | "FILE_URL_SIGNING_SECRET" | "JWT_SECRET">,
): string {
  const q = new URLSearchParams({ key, mime });
  appendPublicFileSignature(q, key, mime, env);
  return `/api/v1/files/audio?${q.toString()}`;
}
