#!/usr/bin/env bun
/**
 * Smoke test for GeminiImageService (REST image generation).
 *
 * Requires:
 *   GEMINI_API_KEY
 *   GEMINI_IMAGE_MODEL (e.g. gemini-3-pro-image-preview or an image-capable Flash model)
 *
 * Optional:
 *   GEMINI_IMAGE_ASPECT_RATIO (default 3:4)
 *   GEMINI_IMAGE_TEST_PROMPT — full prompt string; overrides built-in prompts
 *
 * Usage:
 *   bun run scripts/test-gemini-image.ts
 *   bun run scripts/test-gemini-image.ts --simple
 *   bun run test:gemini-image
 *
 * Writes the returned image under STORAGE_LOCAL_DIR (default ./uploads).
 *
 * Exit codes: 0 success; 1 missing env, API error, or no image bytes.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "../src/config/env.js";
import { GeminiImageService } from "../src/services/ai/gemini-image.service.js";
import { illustrationImagePromptForAtom } from "../src/services/ai/templates/prompt-registry.js";

const SAMPLE_ATOM =
  "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll in leaf cells absorbs sunlight.";

async function main(): Promise<void> {
  const env = loadEnv();
  const image = new GeminiImageService(env);

  if (!image.isConfigured()) {
    console.error("Missing GEMINI_API_KEY and/or GEMINI_IMAGE_MODEL — set both in .env");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const simple = args.includes("--simple");
  const custom = process.env.GEMINI_IMAGE_TEST_PROMPT?.trim();

  let prompt: string;
  if (custom) {
    prompt = custom;
  } else if (simple) {
    prompt =
      "Educational illustration for Indian school students (CBSE-style): cross-section of a leaf showing photosynthesis — sunlight, chlorophyll, glucose output; flat vector textbook art, minimal short labels only, diverse students optional in background, no watermark.";
  } else {
    prompt = illustrationImagePromptForAtom(
      SAMPLE_ATOM,
      "SCIENCE_PROCESS",
      "Unit: Life Processes",
      "Class 10",
    );
  }

  console.log(`model:              ${env.GEMINI_IMAGE_MODEL}`);
  console.log(`aspect ratio:       ${env.GEMINI_IMAGE_ASPECT_RATIO}`);
  console.log(`max output tokens:  ${env.GEMINI_IMAGE_MAX_OUTPUT_TOKENS}`);
  console.log(`prompt (${prompt.length} chars):\n${prompt.slice(0, 400)}${prompt.length > 400 ? "…" : ""}\n`);

  const started = Date.now();
  const out = await image.generate(prompt);
  const ms = Date.now() - started;

  if (!out) {
    console.error("generate() returned null (unexpected while configured)");
    process.exit(1);
  }

  const dir = env.STORAGE_LOCAL_DIR;
  await mkdir(dir, { recursive: true });
  const name = `test-gemini-image-${Date.now()}.${out.fileExt}`;
  const filePath = join(dir, name);
  await Bun.write(filePath, out.buffer);

  console.log(`PASS  ${out.mime}  ${out.buffer.length} bytes  ${ms} ms`);
  console.log(`wrote ${filePath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
