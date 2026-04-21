import { z } from "zod";
import type { Env } from "../../config/env.js";
import type { AtomParseExport } from "../ingestion-v2/pdf-parse-export.service.js";
import type { ParseExportManifestV1 } from "./parse-export-generation.service.js";
import {
  loadSingleAtomArtifact,
  loadSingleChapterArtifact,
  loadSingleTopicArtifact,
  readParseExportManifest,
} from "./parse-export-generation.service.js";
import { getQueue } from "../queue/queue-global.js";
import type { JobPriority } from "../queue/job-queue.types.js";
import type { ParseExportAtomPayload, ParseExportChapterPayload, ParseExportTopicPayload } from "../../jobs/contracts/job-schemas.js";
import type { ArtifactCell } from "./parse-export-artifact.types.js";

const atomKinds = ["tts", "quiz", "gameHtml", "microGame", "glossary", "simulation", "video"] as const;
const topicKinds = ["summary", "quiz", "gameHtml", "assessment"] as const;
const chapterKinds = ["summary", "test"] as const;

export const regenerateBodySchema = z.object({
  scope: z.enum(["all", "failed"]).default("failed"),
  kinds: z.array(z.enum([...atomKinds, ...topicKinds, ...chapterKinds])).optional(),
  atomIds: z.array(z.string().uuid()).optional(),
});

export type RegenerateBody = z.infer<typeof regenerateBodySchema>;

function atomExportKinds(manifest: ParseExportManifestV1, atomId: string, atom: AtomParseExport): Set<string> {
  const s = new Set<string>();
  if (manifest.ttsPendingAtomIds.includes(atomId)) s.add("tts");
  if (atom.recommended.quiz) {
    s.add("quiz");
    s.add("glossary");
  }
  if (atom.recommended.gameHtml || atom.recommended.quiz) s.add("microGame");
  if (atom.recommended.gameHtml) s.add("gameHtml");
  if (atom.recommended.simulation) s.add("simulation");
  if (atom.recommended.video) s.add("video");
  return s;
}

function cellFailed(artifact: Record<string, unknown> | null, kind: string): boolean {
  if (!artifact) return true;
  const cell = artifact[kind];
  if (!cell || typeof cell !== "object" || !("status" in cell)) return true;
  return (cell as ArtifactCell).status === "failed";
}

function kindsFilter(body: RegenerateBody): Set<string> | null {
  if (!body.kinds || body.kinds.length === 0) return null;
  return new Set(body.kinds);
}

function shouldEnqueueAtom(
  manifest: ParseExportManifestV1,
  atomId: string,
  atom: AtomParseExport,
  artifact: Record<string, unknown> | null,
  body: RegenerateBody,
): boolean {
  if (body.atomIds && !body.atomIds.includes(atomId)) return false;
  const applicable = atomExportKinds(manifest, atomId, atom);
  const filter = kindsFilter(body);
  const relevantKinds = filter ? [...filter].filter((k) => applicable.has(k)) : [...applicable];
  if (relevantKinds.length === 0) return false;

  if (body.scope === "all") return true;
  if (!artifact) return true;
  return relevantKinds.some((k) => cellFailed(artifact, k));
}

function shouldEnqueueTopic(artifact: Record<string, unknown> | null, body: RegenerateBody): boolean {
  if (body.atomIds && body.atomIds.length > 0) return false;
  const applicable = new Set<string>(topicKinds);
  const filter = kindsFilter(body);
  const relevantKinds = filter ? [...filter].filter((k) => applicable.has(k)) : [...applicable];
  if (relevantKinds.length === 0) return false;

  if (body.scope === "all") return true;
  if (!artifact) return true;
  return relevantKinds.some((k) => cellFailed(artifact, k));
}

function shouldEnqueueChapter(artifact: Record<string, unknown> | null, body: RegenerateBody): boolean {
  if (body.atomIds && body.atomIds.length > 0) return false;
  const applicable = new Set<string>(chapterKinds);
  const filter = kindsFilter(body);
  const relevantKinds = filter ? [...filter].filter((k) => applicable.has(k)) : [...applicable];
  if (relevantKinds.length === 0) return false;

  if (body.scope === "all") return true;
  if (!artifact) return true;
  return relevantKinds.some((k) => cellFailed(artifact, k));
}

export async function enqueueParseExportRegeneration(
  env: Env,
  userId: string,
  exportId: string,
  body: RegenerateBody,
  priority: JobPriority = "medium",
): Promise<{ enqueuedAtoms: number; enqueuedTopics: number; enqueuedChapters: number }> {
  const manifest = await readParseExportManifest(env, userId, exportId);
  if (!manifest) {
    return { enqueuedAtoms: 0, enqueuedTopics: 0, enqueuedChapters: 0 };
  }

  const q = getQueue();
  const pending: Promise<void>[] = [];
  const track = (v: void | Promise<void>): void => {
    if (v instanceof Promise) pending.push(v);
  };

  let enqueuedAtoms = 0;
  let enqueuedTopics = 0;
  let enqueuedChapters = 0;

  for (const ch of manifest.chapters) {
    for (const tp of ch.topics) {
      for (const at of tp.atoms) {
        const art = (await loadSingleAtomArtifact(env, userId, exportId, at.id)) as Record<string, unknown> | null;
        if (shouldEnqueueAtom(manifest, at.id, at, art, body)) {
          track(
            q.enqueue(
              "parse-export-atom",
              { exportId, userId, atomId: at.id } satisfies ParseExportAtomPayload,
              priority,
            ),
          );
          enqueuedAtoms += 1;
        }
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const ch = manifest.chapters[chi];
    if (!ch) continue;
    for (let tpi = 0; tpi < ch.topics.length; tpi++) {
      const art = (await loadSingleTopicArtifact(env, userId, exportId, chi, tpi)) as Record<string, unknown> | null;
      if (shouldEnqueueTopic(art, body)) {
        track(
          q.enqueue(
            "parse-export-topic",
            { exportId, userId, chapterIndex: chi, topicIndex: tpi } satisfies ParseExportTopicPayload,
            priority,
          ),
        );
        enqueuedTopics += 1;
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const art = (await loadSingleChapterArtifact(env, userId, exportId, chi)) as Record<string, unknown> | null;
    if (shouldEnqueueChapter(art, body)) {
      track(
        q.enqueue(
          "parse-export-chapter",
          { exportId, userId, chapterIndex: chi } satisfies ParseExportChapterPayload,
          priority,
        ),
      );
      enqueuedChapters += 1;
    }
  }

  await Promise.all(pending);
  return { enqueuedAtoms, enqueuedTopics, enqueuedChapters };
}
