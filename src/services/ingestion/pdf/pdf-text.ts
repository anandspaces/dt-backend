import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type PdfParseResult = { text?: string; numpages: number };

/**
 * Extract plain text from a PDF buffer. Uses form-feed page breaks when present;
 * otherwise splits evenly by reported page count.
 */
export async function extractPdfTextPages(buffer: Buffer): Promise<{
  pages: string[];
  numPages: number;
}> {
  const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<PdfParseResult>;
  const data = await pdfParse(buffer);
  const raw = (data.text ?? "").replace(/\r\n/g, "\n");
  const n = Math.max(1, data.numpages || 1);
  let pages = raw
    .split(/\f+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (pages.length === 0 && raw.trim()) {
    pages = [raw.trim()];
  }
  if (pages.length === 1 && n > 1 && raw.length > 200) {
    pages = splitEvenChunks(raw, n);
  }
  return { pages, numPages: n };
}

function splitEvenChunks(text: string, n: number): string[] {
  const chunk = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const slice = text.slice(i * chunk, (i + 1) * chunk).trim();
    if (slice.length) out.push(slice);
  }
  return out.length ? out : [text];
}
