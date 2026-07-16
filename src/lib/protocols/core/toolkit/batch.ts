const DEFAULT_BATCH_SIZE = 10

/**
 * Process an array of items in parallel batches.
 * Returns only non-null results, preserving order.
 */
export async function processBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R | null>,
  batchSize = DEFAULT_BATCH_SIZE
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    for (const r of batchResults) {
      if (r != null) results.push(r)
    }
  }
  return results
}
