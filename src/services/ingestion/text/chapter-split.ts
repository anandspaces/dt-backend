export type ChapterSegment = {
  title: string;
  chapterNumber: number | null;
  pageStart: number;
  pageEnd: number;
  /** 0-based inclusive page indices merged for this chapter */
  pageIndices: number[];
};

const CHAPTER_LINE =
  /^\s*(?:CHAPTER|Chapter)\s+(\d+|[IVXLCDM]+)\b[:\s.-]*([^\n]*)$/im;

/**
 * Detect NCERT-style chapter headings at the start of a page (or after newline).
 * If none found, returns a single segment covering all pages.
 */
export function detectChapterSegments(pages: string[]): ChapterSegment[] {
  if (pages.length === 0) {
    return [];
  }
  const boundaries: { pageIndex: number; title: string; chapterNumber: number | null }[] =
    [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] ?? "";
    const lines = page.split("\n").map((l) => l.trim());
    const first = lines.find((l) => l.length > 0);
    if (!first) continue;
    const m = first.match(CHAPTER_LINE);
    if (m) {
      const numRaw = m[1] ?? "";
      const rest = (m[2] ?? "").trim();
      const chapterNumber = /^[0-9]+$/.test(numRaw) ? Number.parseInt(numRaw, 10) : null;
      const title = rest.length > 0 ? `Chapter ${numRaw}: ${rest}` : `Chapter ${numRaw}`;
      boundaries.push({ pageIndex: i, title, chapterNumber });
    }
  }
  if (boundaries.length === 0) {
    return [
      {
        title: "Document",
        chapterNumber: null,
        pageStart: 1,
        pageEnd: pages.length,
        pageIndices: pages.map((_, i) => i),
      },
    ];
  }
  const segments: ChapterSegment[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const cur = boundaries[b];
    const next = boundaries[b + 1];
    if (!cur) continue;
    const start = cur.pageIndex;
    const end = next ? next.pageIndex - 1 : pages.length - 1;
    const pageIndices: number[] = [];
    for (let p = start; p <= end; p++) pageIndices.push(p);
    segments.push({
      title: cur.title,
      chapterNumber: cur.chapterNumber,
      pageStart: start + 1,
      pageEnd: end + 1,
      pageIndices,
    });
  }
  return segments;
}
