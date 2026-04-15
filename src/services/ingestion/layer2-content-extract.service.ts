/** Layer 2: paragraph → atoms, media/formula detection (stub). */
export class Layer2ContentExtractService {
  async run(_fileId: string): Promise<{ ok: true; atomCount: number }> {
    await Promise.resolve();
    return { ok: true, atomCount: 0 };
  }
}
