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
