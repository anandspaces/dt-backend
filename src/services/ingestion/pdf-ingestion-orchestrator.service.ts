import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { Layer1StructureService } from "./layer1-structure.service.js";
import { Layer2ContentExtractService } from "./layer2-content-extract.service.js";
import { PyqIngestionService } from "./pyq-ingestion.service.js";

export class PdfIngestionOrchestrator {
  private readonly l1: Layer1StructureService;
  private readonly l2 = new Layer2ContentExtractService();
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
    this.l1 = new Layer1StructureService(env);
  }

  async runPipeline(fileId: string): Promise<void> {
    const db = getDb();
    const { pdfExtractionLogs, files } = schema();
    const runId = crypto.randomUUID();
    let layer = "start";
    try {
      const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
      if (!file) throw new Error("file not found");

      await db
        .update(files)
        .set({ ingestionStatus: "running", lastError: null })
        .where(eq(files.id, fileId));

      if (file.fileKind === "pyq") {
        layer = "pyq_ingest";
        await new PyqIngestionService(this.env).run(fileId);
      } else {
        layer = "layer1_structure";
        await this.l1.run(fileId);
        layer = "layer2_extract";
        await this.l2.run(fileId);
      }

      layer = "complete";
      await db.insert(pdfExtractionLogs).values({
        fileId,
        runId,
        layerReached: layer,
        errorsJson: null,
        timingsJson: JSON.stringify({}),
        version: 1,
      });
      await db
        .update(files)
        .set({ ingestionStatus: "completed", lastError: null })
        .where(eq(files.id, fileId));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.insert(pdfExtractionLogs).values({
        fileId,
        runId,
        layerReached: layer,
        errorsJson: JSON.stringify({ message }),
        timingsJson: null,
        version: 1,
      });
      await db
        .update(files)
        .set({ ingestionStatus: "failed", lastError: message })
        .where(eq(files.id, fileId));
      throw e;
    }
  }
}
