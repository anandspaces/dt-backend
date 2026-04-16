const MAX_BYTES = 200_000;

const FORBIDDEN = [
  "fetch(",
  "XMLHttpRequest",
  "http://",
  "https://",
  "<script src=",
  "src=\"http",
  "src='http",
  "eval(",
  "Function(",
];

export type HtmlVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyGeneratedHtml(html: string): HtmlVerifyResult {
  if (html.length > MAX_BYTES) {
    return { ok: false, reason: "payload_too_large" };
  }
  const lower = html.toLowerCase();
  for (const f of FORBIDDEN) {
    if (lower.includes(f.toLowerCase())) {
      return { ok: false, reason: `forbidden:${f}` };
    }
  }
  if (!html.includes("window.DEXTORA_COMPLETE")) {
    return { ok: false, reason: "missing_dextora_complete" };
  }
  return { ok: true };
}
