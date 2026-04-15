/** Layer 1: TOC, chapter boundaries, page mapping (stub — replace with real PDF parsing). */
export class Layer1StructureService {
  async run(_fileId: string): Promise<{ ok: true; pages: number }> {
    await Promise.resolve();
    return { ok: true, pages: 0 };
  }
}
