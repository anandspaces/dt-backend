import { PDFParse } from "pdf-parse";

/**
 * Extract plain text from a PDF buffer. Uses per-page text from pdf-parse v2;
 * falls back to form-feed splits or even chunks when page text is merged.
 */
export async function extractPdfTextPages(buffer: Buffer): Promise<{
  pages: string[];
  numPages: number;
}> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const n = Math.max(1, result.total || 1);
    const raw = result.text.replace(/\r\n/g, "\n").trim();

    let pages = result.pages.map((p) => p.text.trim()).filter((p) => p.length > 0);

    if (pages.length === 0 && raw.length > 0) {
      pages = raw
        .split(/\f+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (pages.length === 0) {
        pages = [raw];
      }
    }

    if (pages.length === 1 && n > 1 && raw.length > 200) {
      pages = splitEvenChunks(raw, n);
    }

    return { pages, numPages: n };
  } finally {
    await parser.destroy();
  }
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
