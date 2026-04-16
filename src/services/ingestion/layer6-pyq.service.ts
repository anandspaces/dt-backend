/** Reserved for richer PYQ tagging on textbook atoms; textbook PDFs skip this layer. */
export class Layer6PyqService {
  async run(_fileId: string): Promise<{ ok: true }> {
    await Promise.resolve();
    return { ok: true };
  }
}
