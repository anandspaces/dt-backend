/**
 * Split a chapter's plain text into topic sections using numbered heading heuristics
 * (e.g. 1.1 Introduction, 3.2.1 Vector resolution). Falls back to a single topic.
 */
export function detectTopicsInChapter(chapterText: string): { title: string; body: string }[] {
  const t = chapterText.replace(/\r\n/g, "\n").trim();
  if (!t) return [{ title: "Main", body: "" }];

  const parts = t.split(/\n(?=\s*(?:\d+(?:\.\d+)+\s+[^\n]+|[A-Z]\)\s+[^\n]+))/);
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length <= 1) {
    return [{ title: "Main", body: t }];
  }

  return cleaned.map((block, i) => {
    const firstLine = block.split("\n")[0]?.trim() ?? `Topic ${String(i + 1)}`;
    const title = firstLine.slice(0, 200);
    return { title, body: block };
  });
}
