export type HtmlVerifyMode = "strict" | "relaxed";

export type HtmlVerifyOptions = {
  mode?: HtmlVerifyMode;
  maxBytes?: number;
};

const STRICT_MAX_BYTES_DEFAULT = 200_000;
const RELAXED_MAX_BYTES_DEFAULT = 600_000;

/** Always blocked (case-insensitive substring match). */
const FORBIDDEN_ALWAYS = [
  "fetch(",
  "XMLHttpRequest",
  "eval(",
  "<script src=",
  'src="http',
  "src='http",
  "javascript:",
] as const;

/** Extra in strict mode (legacy blanket remote URL ban). */
const FORBIDDEN_STRICT_ONLY = ["http://", "https://"] as const;

/** Dynamic code constructor — blocked in strict mode only (LLM game HTML often false-positives in relaxed). */
const FORBIDDEN_STRICT_SCRIPT = ["Function("] as const;

/** Remove common W3C namespace URIs so strict mode does not false-positive on `http://`. */
function stripAllowlistedNamespaceUris(lower: string): string {
  return lower
    .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "")
    .replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, "")
    .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")
    .replace(/http:\/\/www\.w3\.org\/1998\/math\/mathml/g, "")
    .replace(/http:\/\/www\.w3\.org\/1999\/xlink/g, "")
    .replace(/https:\/\/www\.w3\.org\/2000\/svg/g, "");
}

export type HtmlVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates generated HTML for embedding. Default: `strict` + 200k cap (backward compatible).
 * Parse-export should pass `{ mode: "relaxed", maxBytes: env... }` for HTML5 (SVG xmlns, etc.).
 */
export function verifyGeneratedHtml(html: string, options?: HtmlVerifyOptions): HtmlVerifyResult {
  const mode = options?.mode ?? "strict";
  const maxBytes =
    options?.maxBytes ??
    (mode === "relaxed" ? RELAXED_MAX_BYTES_DEFAULT : STRICT_MAX_BYTES_DEFAULT);

  if (html.length > maxBytes) {
    return { ok: false, reason: "payload_too_large" };
  }

  const lower = html.toLowerCase();

  for (const f of FORBIDDEN_ALWAYS) {
    const needle = f.toLowerCase();
    if (lower.includes(needle)) {
      return { ok: false, reason: `forbidden:${f}` };
    }
  }

  if (mode === "strict") {
    for (const f of FORBIDDEN_STRICT_SCRIPT) {
      const needle = f.toLowerCase();
      if (lower.includes(needle)) {
        return { ok: false, reason: `forbidden:${f}` };
      }
    }
    const forStrictScan = stripAllowlistedNamespaceUris(lower);
    for (const f of FORBIDDEN_STRICT_ONLY) {
      if (forStrictScan.includes(f.toLowerCase())) {
        return { ok: false, reason: `forbidden:${f}` };
      }
    }
  }

  if (!html.includes("window.DEXTORA_COMPLETE")) {
    return { ok: false, reason: "missing_dextora_complete" };
  }
  return { ok: true };
}
