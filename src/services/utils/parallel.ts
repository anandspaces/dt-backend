import pLimit from "p-limit";

/** Run async work over items with a max concurrency (good for I/O-bound PDF pages, TTS, etc.). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(Math.max(1, concurrency));
  return Promise.all(items.map((item, index) => limit(() => fn(item, index))));
}
