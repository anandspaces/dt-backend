import { splitIntoParagraphs } from "../ingestion/text/paragraph-split.js";

/**
 * Each atom stores two consecutive paragraphs when possible (better game/sim context,
 * avoids near-duplicate activities in the same topic via downstream Jaccard dedup).
 */
export function pairedAtomBodiesFromTopicBody(topicBody: string): string[] {
  const paras = splitIntoParagraphs(topicBody);
  const out: string[] = [];
  for (let i = 0; i < paras.length; i += 2) {
    const a = paras[i];
    const b = paras[i + 1];
    if (a && b) {
      out.push(`${a}\n\n${b}`);
    } else if (a) {
      out.push(a);
    }
  }
  return out.filter((b) => b.length > 2);
}
