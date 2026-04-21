/**
 * Lightweight script-based language hints for TTS (English vs Hindi).
 * Uses Devanagari codepoint density; not a full NLP classifier.
 */
export type AtomLang = "en" | "hi";

const DEVANAGARI = /[\u0900-\u097F]/g;

export function detectAtomLanguage(text: string): AtomLang {
  const compact = text.replace(/\s+/g, "");
  const total = compact.length || 1;
  const devanagari = (compact.match(DEVANAGARI) ?? []).length;
  return devanagari / total >= 0.15 ? "hi" : "en";
}

/** Majority vote; default `en` when empty. */
export function majorityAtomLang(langs: readonly AtomLang[]): AtomLang {
  if (langs.length === 0) return "en";
  let hi = 0;
  for (const l of langs) {
    if (l === "hi") hi += 1;
  }
  return hi * 2 >= langs.length ? "hi" : "en";
}
