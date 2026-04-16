import type { Env } from "../../../config/env.js";
import { GeminiClient } from "../gemini.client.js";
import { gameHtmlPromptForAtom } from "../templates/prompt-registry.js";

export class GameHtmlGenerator {
  constructor(
    _env: Env,
    private readonly gemini: GeminiClient,
  ) {
    void _env;
  }

  async generate(atomBody: string, importance: number): Promise<string> {
    const hint = importance >= 8 ? "high" : importance >= 5 ? "medium" : "low";
    if (!this.gemini.isConfigured()) {
      return minimalPlaceholderHtml();
    }
    const raw = await this.gemini.generateText(gameHtmlPromptForAtom(atomBody, hint));
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }
    return trimmed;
  }
}

function minimalPlaceholderHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Activity</title></head><body>
<p>Configure GEMINI_API_KEY for interactive games.</p>
<button type="button" onclick="window.DEXTORA_COMPLETE({score:100,time:0,passed:true})">Done</button>
</body></html>`;
}
