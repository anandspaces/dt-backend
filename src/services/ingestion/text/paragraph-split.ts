/** Split chapter text into paragraph-sized atoms (blank-line boundaries). */
export function splitIntoParagraphs(text: string, maxLen = 4000): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n\s*\n+/).map((b) => b.replace(/\s+/g, " ").trim());
  const out: string[] = [];
  for (const b of blocks) {
    if (b.length <= maxLen) {
      if (b.length > 0) out.push(b);
      continue;
    }
    for (let i = 0; i < b.length; i += maxLen) {
      const chunk = b.slice(i, i + maxLen).trim();
      if (chunk) out.push(chunk);
    }
  }
  return out.filter((p) => p.length > 2);
}
