#!/usr/bin/env bun
/**
 * Smoke test for SuperTtsHttpService (same HTTP client as parse-export TTS).
 *
 * Requires at least one of:
 *   SILERO_TTS_HTTP_URL — e.g. http://127.0.0.1:4001/tts (wins over SUPERTTS_HTTP_URL)
 *   SUPERTTS_HTTP_URL  — remote or local SuperTTS-compatible POST /tts
 *
 * Optional:
 *   SUPER_TTS_TEST_LANG — default "en"
 *   SUPER_TTS_TEST_OUT  — output path prefix (writes *-short.wav and *-long.wav under uploads/)
 *
 * Usage:
 *   bun run scripts/test-supertts-http.ts
 *   bun run test:supertts
 *
 * Exit: 0 success; 1 not configured or synthesis failed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEnv } from "../src/config/env.js";
import { SuperTtsHttpService } from "../src/services/tts/supertts-http.service.js";

const SHORT =
  "Matter is anything that has mass and occupies space. Water, air, and this book are all examples of matter.";

const LONG =
  `${SHORT} `.repeat(12) +
  " In solids, particles are tightly packed; in liquids they move more freely; in gases they spread out. " +
  "Mixtures contain two or more substances; pure substances have fixed composition. ";

async function main(): Promise<void> {
  const env = loadEnv();
  const tts = new SuperTtsHttpService(env);

  if (!tts.isConfigured()) {
    console.error(
      "Set SILERO_TTS_HTTP_URL or SUPERTTS_HTTP_URL in .env (e.g. SILERO_TTS_HTTP_URL=http://127.0.0.1:4001/tts)",
    );
    process.exit(1);
  }

  const lang = (process.env.SUPER_TTS_TEST_LANG ?? "en").trim() || "en";
  const outArg = process.env.SUPER_TTS_TEST_OUT?.trim();
  const outPath = outArg?.length ? outArg : join(process.cwd(), "uploads", "test-supertts-smoke.wav");

  const started = performance.now();
  console.log(`[test-supertts] POST TTS lang=${lang} short sample…`);

  const short = await tts.synthesize(SHORT, lang as "en");
  const shortPath = outPath.replace(/\.wav$/i, "") + "-short.wav";
  await mkdir(dirname(shortPath), { recursive: true });
  await writeFile(shortPath, short.buffer);
  console.log(
    `[test-supertts] short OK ${short.mime} → ${shortPath} (${short.buffer.byteLength} bytes, ${(performance.now() - started).toFixed(0)} ms)`,
  );

  const t1 = performance.now();
  console.log(`[test-supertts] long sample (${LONG.length} chars)…`);
  const longAudio = await tts.synthesize(LONG, lang as "en");
  const longPath = outPath.replace(/\.wav$/i, "") + "-long.wav";
  await writeFile(longPath, longAudio.buffer);
  console.log(
    `[test-supertts] long OK ${longAudio.mime} → ${longPath} (${longAudio.buffer.byteLength} bytes, ${(performance.now() - t1).toFixed(0)} ms)`,
  );

  console.log(`[test-supertts] done total ${(performance.now() - started).toFixed(0)} ms`);
}

main().catch((e) => {
  console.error("[test-supertts] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
