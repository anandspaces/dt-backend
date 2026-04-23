#!/usr/bin/env bun
/**
 * Integration smoke test for parse-export generation primitives.
 * Runs minimal prompts through each path (Gemini text, HTML verify, TTS, image).
 *
 * Usage:
 *   bun run scripts/test-parse-export-services.ts
 *   bun run test:parse-export-services    # npm script
 *
 * Requires (for full PASS):
 *   - GEMINI_API_KEY + GEMINI_MODEL — quiz, glossary, games, simulation, video
 *   - SUPERTTS_HTTP_URL or GEMINI_TTS_MODEL — TTS
 *   - GEMINI_IMAGE_MODEL — illustration images
 *
 * Exit codes: 0 = no unexpected failures; 1 = at least one FAIL where service was configured
 */

import { z } from "zod";
import { loadEnv } from "../src/config/env.js";
import { GeminiClient } from "../src/services/ai/gemini.client.js";
import { GeminiImageService } from "../src/services/ai/gemini-image.service.js";
import { extractJsonFromModelText } from "../src/services/ai/json-extract.js";
import {
  gameHtmlPromptForAtom,
  glossaryPromptForAtom,
  illustrationImagePromptForAtom,
  microGamePromptForAtom,
  quizPromptForAtom,
  simulationPromptForAtom,
  videoLessonPromptForAtom,
} from "../src/services/ai/templates/prompt-registry.js";
import { verifyGeneratedHtml } from "../src/services/generation/html-verification.js";
import { GeminiTtsService } from "../src/services/tts/gemini-tts.service.js";
import { SuperTtsHttpService } from "../src/services/tts/supertts-http.service.js";

const SAMPLE_ATOM =
  "Water boils at 100 °C at standard atmospheric pressure. The kinetic energy of molecules increases with temperature.";

const quizSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
});

type Row = { name: string; status: "PASS" | "SKIP" | "FAIL"; detail: string };

function stripCodeFences(html: string): string {
  const trimmed = html.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const rows: Row[] = [];
  let configuredButFailed = false;

  const gemini = new GeminiClient(env);
  const geminiOk = gemini.isConfigured();

  const htmlOpts = {
    mode: env.PARSE_EXPORT_HTML_VERIFY_MODE,
    maxBytes: env.PARSE_EXPORT_HTML_MAX_BYTES,
  };

  // ── Gemini: quiz JSON ─────────────────────────────────────────
  if (!geminiOk) {
    rows.push({
      name: "quiz (Gemini JSON)",
      status: "SKIP",
      detail: "GEMINI_API_KEY / GEMINI_MODEL not set",
    });
  } else {
    try {
      const prompt = quizPromptForAtom(SAMPLE_ATOM, "Class 10");
      const text = await gemini.generateText(prompt);
      const json = extractJsonFromModelText(text);
      const parsed = quizSchema.safeParse(JSON.parse(json));
      if (parsed.success) {
        rows.push({ name: "quiz (Gemini JSON)", status: "PASS", detail: parsed.data.question.slice(0, 60) + "…" });
      } else {
        rows.push({ name: "quiz (Gemini JSON)", status: "FAIL", detail: "schema mismatch" });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "quiz (Gemini JSON)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: glossary JSON ─────────────────────────────────────
  if (!geminiOk) {
    rows.push({ name: "glossary (Gemini JSON array)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = glossaryPromptForAtom(SAMPLE_ATOM, "Class 10");
      const text = await gemini.generateText(prompt);
      const json = extractJsonFromModelText(text);
      const arr = JSON.parse(json) as unknown;
      if (Array.isArray(arr)) {
        rows.push({
          name: "glossary (Gemini JSON array)",
          status: "PASS",
          detail: `${String(arr.length)} term(s)`,
        });
      } else {
        rows.push({ name: "glossary (Gemini JSON array)", status: "FAIL", detail: "not an array" });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "glossary (Gemini JSON array)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: game HTML + verify ─────────────────────────────────
  if (!geminiOk) {
    rows.push({ name: "gameHtml (Gemini + HTML verify)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = gameHtmlPromptForAtom(SAMPLE_ATOM, "medium", "Class 10");
      const text = await gemini.generateText(prompt);
      const html = stripCodeFences(text);
      const v = verifyGeneratedHtml(html, htmlOpts);
      if (v.ok) {
        rows.push({ name: "gameHtml (Gemini + HTML verify)", status: "PASS", detail: `${html.length} bytes` });
      } else {
        rows.push({ name: "gameHtml (Gemini + HTML verify)", status: "FAIL", detail: v.reason });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "gameHtml (Gemini + HTML verify)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: micro-game HTML + verify ───────────────────────────
  if (!geminiOk) {
    rows.push({ name: "microGame (Gemini + HTML verify)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = microGamePromptForAtom(SAMPLE_ATOM, "medium", "Class 10");
      const text = await gemini.generateText(prompt);
      const html = stripCodeFences(text);
      const v = verifyGeneratedHtml(html, htmlOpts);
      if (v.ok) {
        rows.push({ name: "microGame (Gemini + HTML verify)", status: "PASS", detail: `${html.length} bytes` });
      } else {
        rows.push({ name: "microGame (Gemini + HTML verify)", status: "FAIL", detail: v.reason });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "microGame (Gemini + HTML verify)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: simulation JSON ────────────────────────────────────
  if (!geminiOk) {
    rows.push({ name: "simulation (Gemini JSON spec)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = simulationPromptForAtom(SAMPLE_ATOM, "CONCEPT", "Class 10");
      const text = await gemini.generateText(prompt);
      const json = extractJsonFromModelText(text);
      const obj = JSON.parse(json) as Record<string, unknown>;
      const keys = ["title", "scenario", "learnerControls", "stateVariables", "updateRules", "learningGoal"];
      const missing = keys.filter((k) => !(k in obj));
      if (missing.length === 0) {
        rows.push({ name: "simulation (Gemini JSON spec)", status: "PASS", detail: String(obj.title ?? "") });
      } else {
        rows.push({ name: "simulation (Gemini JSON spec)", status: "FAIL", detail: `missing: ${missing.join(",")}` });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "simulation (Gemini JSON spec)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: video lesson JSON ─────────────────────────────────
  if (!geminiOk) {
    rows.push({ name: "video (Gemini JSON script)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = videoLessonPromptForAtom(SAMPLE_ATOM, "CONCEPT", "Class 10");
      const text = await gemini.generateText(prompt);
      const json = extractJsonFromModelText(text);
      const obj = JSON.parse(json) as Record<string, unknown>;
      if (typeof obj.title === "string" && Array.isArray(obj.voiceoverScript)) {
        rows.push({ name: "video (Gemini JSON script)", status: "PASS", detail: obj.title });
      } else {
        rows.push({ name: "video (Gemini JSON script)", status: "FAIL", detail: "invalid shape" });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "video (Gemini JSON script)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini: image prompt (text) — actual bytes need GEMINI_IMAGE_MODEL ──
  if (!geminiOk) {
    rows.push({ name: "image prompt (Gemini text)", status: "SKIP", detail: "Gemini not configured" });
  } else {
    try {
      const prompt = illustrationImagePromptForAtom(SAMPLE_ATOM, "CONCEPT", "1.2 Boiling", "Class 10");
      const out = await gemini.generateText(prompt);
      if (out.trim().length > 40) {
        rows.push({
          name: "image prompt (Gemini text → image brief)",
          status: "PASS",
          detail: `${out.trim().slice(0, 80)}…`,
        });
      } else {
        rows.push({ name: "image prompt (Gemini text → image brief)", status: "FAIL", detail: "too short" });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "image prompt (Gemini text → image brief)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── Gemini Image API (binary) ────────────────────────────────
  const imgSvc = new GeminiImageService(env);
  if (!imgSvc.isConfigured()) {
    rows.push({
      name: "image bytes (GEMINI_IMAGE_MODEL API)",
      status: "SKIP",
      detail: "GEMINI_IMAGE_MODEL not set",
    });
  } else {
    try {
      // Fixed brief so this test depends only on the image endpoint, not an extra Gemini text call
      const brief =
        "Educational flat-vector illustration for Class 10 chemistry: water boiling at 100°C in a lab beaker, " +
        "clean textbook style, diverse students observing safely, minimal short labels, no logos.";
      const gen = await imgSvc.generate(brief.trim());
      if (gen && gen.buffer.length > 100) {
        rows.push({
          name: "image bytes (GEMINI_IMAGE_MODEL API)",
          status: "PASS",
          detail: `${gen.mime}, ${gen.buffer.length} bytes`,
        });
      } else {
        rows.push({ name: "image bytes (GEMINI_IMAGE_MODEL API)", status: "FAIL", detail: "no image in response" });
        configuredButFailed = true;
      }
    } catch (e) {
      rows.push({
        name: "image bytes (GEMINI_IMAGE_MODEL API)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  }

  // ── TTS: SuperTTS HTTP (preferred if set) ─────────────────────
  const superTts = new SuperTtsHttpService(env);
  const geminiTts = new GeminiTtsService(env);
  if (superTts.isConfigured()) {
    try {
      const { buffer, mime, fileExt } = await superTts.synthesize("Hello, this is a parse-export TTS smoke test.", "en");
      rows.push({
        name: "TTS (SuperTTS HTTP)",
        status: "PASS",
        detail: `${mime}, ${fileExt}, ${buffer.length} bytes`,
      });
    } catch (e) {
      rows.push({
        name: "TTS (SuperTTS HTTP)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  } else if (geminiTts.isConfigured()) {
    try {
      const { buffer, mime, fileExt } = await geminiTts.synthesize("Hello, this is a parse-export TTS smoke test.", "en");
      rows.push({
        name: "TTS (Gemini TTS)",
        status: "PASS",
        detail: `${mime}, ${fileExt}, ${buffer.length} bytes`,
      });
    } catch (e) {
      rows.push({
        name: "TTS (Gemini TTS)",
        status: "FAIL",
        detail: e instanceof Error ? e.message : String(e),
      });
      configuredButFailed = true;
    }
  } else {
    rows.push({
      name: "TTS",
      status: "SKIP",
      detail: "Neither SUPERTTS_HTTP_URL nor GEMINI_TTS_MODEL configured",
    });
  }

  // ── Report ────────────────────────────────────────────────────
  const w = Math.max(...rows.map((r) => r.name.length), 12);
  console.log("\nparse-export service smoke test\n");
  for (const r of rows) {
    const pad = r.name.padEnd(w);
    console.log(`${r.status.padEnd(4)}  ${pad}  ${r.detail}`);
  }
  const pass = rows.filter((r) => r.status === "PASS").length;
  const skip = rows.filter((r) => r.status === "SKIP").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  console.log(`\nSummary: ${pass} PASS, ${skip} SKIP, ${fail} FAIL\n`);

  if (configuredButFailed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
