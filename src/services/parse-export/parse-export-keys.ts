/** Storage keys under the uploads / S3 prefix for parse-export async generation. */
export function parseExportManifestKey(userId: string, exportId: string): string {
  return `parse-export/${userId}/${exportId}/manifest.json`;
}

export function parseExportProgressKey(userId: string, exportId: string): string {
  return `parse-export/${userId}/${exportId}/progress.json`;
}

export function parseExportRootPrefix(userId: string, exportId: string): string {
  return `parse-export/${userId}/${exportId}`;
}

export function parseExportAtomArtifactKey(userId: string, exportId: string, atomId: string): string {
  return `parse-export/${userId}/${exportId}/artifacts/atom-${atomId}.json`;
}

export function parseExportTopicArtifactKey(
  userId: string,
  exportId: string,
  chapterIndex: number,
  topicIndex: number,
): string {
  return `parse-export/${userId}/${exportId}/artifacts/topic-${String(chapterIndex)}-${String(topicIndex)}.json`;
}

export function parseExportChapterArtifactKey(
  userId: string,
  exportId: string,
  chapterIndex: number,
): string {
  return `parse-export/${userId}/${exportId}/artifacts/chapter-${String(chapterIndex)}.json`;
}

/**
 * Key for a stored HTML game / micro-game file.
 * scope: "atom" | "topic" | "chapter"
 * scopeId: atomId for atoms; "{chi}-{tpi}" for topics; "{chi}" for chapters.
 * kind: "game" | "microgame"
 */
export function parseExportHtmlKey(
  userId: string,
  exportId: string,
  scope: "atom" | "topic" | "chapter",
  scopeId: string,
  kind: "game" | "microgame",
): string {
  return `parse-export/${userId}/${exportId}/html/${scope}-${scopeId}-${kind}.html`;
}

/**
 * Key for a generated illustration image.
 * scope: "atom" | "topic" | "chapter"
 * scopeId: atomId for atoms; "{chi}-{tpi}" for topics; "{chi}" for chapters.
 */
export function parseExportImageKey(
  userId: string,
  exportId: string,
  scope: "atom" | "topic" | "chapter",
  scopeId: string,
  fileExt: string,
): string {
  return `parse-export/${userId}/${exportId}/images/${scope}-${scopeId}.${fileExt}`;
}

/** Key for one generated chapter comic page image. */
export function parseExportComicPageKey(
  userId: string,
  exportId: string,
  chapterIndex: number,
  pageNumber: number,
  fileExt: string,
): string {
  return `parse-export/${userId}/${exportId}/comic/chapter-${String(chapterIndex)}-page-${String(pageNumber)}.${fileExt}`;
}
