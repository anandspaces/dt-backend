import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { Layer1StructureService } from "./layer1-structure.service.js";
import { Layer2ContentExtractService } from "./layer2-content-extract.service.js";
import { Layer3ClassifyService } from "./layer3-classify.service.js";
import { Layer4ScoreService } from "./layer4-score.service.js";
import { Layer5CurriculumMapService } from "./layer5-curriculum-map.service.js";
import { Layer6PyqService } from "./layer6-pyq.service.js";

export class PdfIngestionOrchestrator {
  private readonly l1 = new Layer1StructureService();
  private readonly l2 = new Layer2ContentExtractService();
  private readonly l3 = new Layer3ClassifyService();
  private readonly l4 = new Layer4ScoreService();
  private readonly l5 = new Layer5CurriculumMapService();
  private readonly l6 = new Layer6PyqService();

  async runPipeline(fileId: string): Promise<void> {
    const db = getDb();
    const { pdfExtractionLogs } = schema();
    const runId = crypto.randomUUID();
    let layer = "start";
    try {
      layer = "layer1_structure";
      await this.l1.run(fileId);
      layer = "layer2_extract";
      await this.l2.run(fileId);
      layer = "layer3_classify";
      await this.l3.run(fileId);
      layer = "layer4_score";
      await this.l4.run(fileId);
      layer = "layer5_map";
      await this.l5.run(fileId);
      layer = "layer6_pyq";
      await this.l6.run(fileId);
      layer = "complete";
      await db.insert(pdfExtractionLogs).values({
        fileId,
        runId,
        layerReached: layer,
        errorsJson: null,
        timingsJson: JSON.stringify({}),
        version: 1,
      });
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
      throw e;
    }
  }
}
