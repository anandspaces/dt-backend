export type ArtifactCellStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type ArtifactCell = {
  status: ArtifactCellStatus;
  /** JSON payload, HTML string, or plain-text prompt depending on the cell kind. */
  payload?: string;
  error?: string;
  verified?: boolean;
  /** URL to a stored audio file (TTS cells). Same value as `fileUrl` when set. Absolute when `PUBLIC_API_BASE_URL` / dev default is set. */
  audioUrl?: string | null;
  /** Same as `fileUrl` for HTML games (legacy alias). */
  htmlUrl?: string | null;
  /** Stored asset URL — images, illustration/comic binaries, HTML games (`/api/v1/files/audio?key=...`). */
  fileUrl?: string | null;
  mime?: string | null;
  /** Present on TTS cells (auto-detected `en` | `hi`). */
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
  /** Illustration image — fileUrl set when GEMINI_IMAGE_MODEL configured; payload = image prompt otherwise. */
  image?: ArtifactCell;
  /** Single-page educational comic image for this atom. */
  comic?: ArtifactCell;
};

export type TopicArtifactFile = {
  chapterIndex: number;
  topicIndex: number;
  lang?: "en" | "hi";
  summary?: ArtifactCell;
  quiz?: ArtifactCell;
  gameHtml?: ArtifactCell;
  assessment?: ArtifactCell;
  /** Term glossary across all atoms in this topic. */
  glossary?: ArtifactCell;
  /** Micro-game drilling vocabulary / key facts for the whole topic. */
  microGame?: ArtifactCell;
  /** Illustration image — fileUrl set when GEMINI_IMAGE_MODEL configured; payload = image prompt otherwise. */
  image?: ArtifactCell;
  /** Single-page educational comic image for this topic. */
  comic?: ArtifactCell;
};

export type ChapterArtifactFile = {
  chapterIndex: number;
  lang?: "en" | "hi";
  summary?: ArtifactCell;
  test?: ArtifactCell;
  /** Full-chapter interactive HTML game spanning all topics. */
  gameHtml?: ArtifactCell;
  /** Micro-game drilling key chapter vocabulary / facts. */
  microGame?: ArtifactCell;
  /** Illustration image — fileUrl set when GEMINI_IMAGE_MODEL configured; payload = image prompt otherwise. */
  image?: ArtifactCell;
  /** Multi-page chapter comic story metadata as JSON in payload. */
  comicStory?: ArtifactCell;
};
