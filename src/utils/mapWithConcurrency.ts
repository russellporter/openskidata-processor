import { Semaphore } from "async-mutex";

/**
 * Maps over items with a bounded number of concurrently running operations.
 *
 * Uses a sliding window rather than fixed chunks, so a single slow item doesn't
 * stall the items behind it. Results are returned in input order.
 */
export async function mapWithConcurrency<X, Y>(
  items: readonly X[],
  concurrency: number,
  operation: (item: X) => Promise<Y>,
): Promise<Y[]> {
  if (concurrency < 1) {
    throw new Error(`Concurrency must be at least 1, got ${concurrency}`);
  }

  const semaphore = new Semaphore(concurrency);
  return await Promise.all(
    items.map((item) => semaphore.runExclusive(() => operation(item))),
  );
}
