export type ArtifactCellStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type ArtifactCell = {
  status: ArtifactCellStatus;
  payload?: string;
  error?: string;
  verified?: boolean;
  audioUrl?: string | null;
  mime?: string | null;
  /** Present when `status` is TTS output (auto-detected `en` | `hi`). */
  language?: "en" | "hi";
};

export type AtomArtifactFile = {
  atomId: string;
  /** Inferred from source text when missing (older manifests). */
  lang?: "en" | "hi";
  tts?: ArtifactCell;
  quiz?: ArtifactCell;
  gameHtml?: ArtifactCell;
  microGame?: ArtifactCell;
  simulation?: ArtifactCell;
  video?: ArtifactCell;
  glossary?: ArtifactCell;
};

export type TopicArtifactFile = {
  chapterIndex: number;
  topicIndex: number;
  lang?: "en" | "hi";
  summary?: ArtifactCell;
  quiz?: ArtifactCell;
  gameHtml?: ArtifactCell;
  assessment?: ArtifactCell;
};

export type ChapterArtifactFile = {
  chapterIndex: number;
  lang?: "en" | "hi";
  summary?: ArtifactCell;
  test?: ArtifactCell;
};
