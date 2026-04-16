import { jaccard, tokenize } from "../ingestion/pyq-ingestion.service.js";

const DEFAULT_THRESHOLD = 0.82;

/**
 * Within the same topic, skip atoms whose body is too similar to the last atom
 * that was selected for interactive (game) generation — reduces duplicate-feeling games.
 */
export function pickAtomsForGamesDeduped(
  rows: {
    id: string;
    body: string;
    topicId: string | null;
    position: number;
    chapterId: string;
  }[],
  threshold = DEFAULT_THRESHOLD,
): string[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.chapterId !== b.chapterId) return a.chapterId.localeCompare(b.chapterId);
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });

  const selected: string[] = [];
  const lastIncludedBodyByTopic = new Map<string | null, string>();

  for (const row of sorted) {
    const key = row.topicId;
    const prev = lastIncludedBodyByTopic.get(key);
    if (prev && jaccard(tokenize(prev), tokenize(row.body)) >= threshold) {
      continue;
    }
    selected.push(row.id);
    lastIncludedBodyByTopic.set(key, row.body);
  }
  return selected;
}
