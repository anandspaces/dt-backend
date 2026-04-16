/** Heuristic: scanned pages often yield very little extractable text without OCR. */
export function isPageTextProbablyScannedSparse(pageText: string): boolean {
  const t = pageText.replace(/\s+/g, " ").trim();
  return t.length < 40;
}

export type PageOcrHint = { pageIndex: number; sparse: boolean };

export function summarizeOcrHints(hints: PageOcrHint[]): {
  sparsePageIndices: number[];
  sparseRatio: number;
} {
  const sparsePageIndices = hints.filter((h) => h.sparse).map((h) => h.pageIndex);
  const sparseRatio = hints.length === 0 ? 0 : sparsePageIndices.length / hints.length;
  return { sparsePageIndices, sparseRatio };
}
