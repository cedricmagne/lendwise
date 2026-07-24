import type {
  HistoryDataPoint,
  HistoryParams,
  HistoryResult,
  HistoryTarget,
} from '@/lib/protocols/core/types'

/**
 * What the caller asked for, from whichever form it used — or null for "your
 * whole catalogue".
 *
 * `targets` and `productIds` describe the same request at two levels of detail,
 * so deriving one from the other here is what keeps them from ever disagreeing.
 */
export function requestedProducts(params: {
  productIds?: HistoryParams['productIds']
  targets?: HistoryParams['targets']
}): { ids: Set<string>; byId: Map<string, HistoryTarget> } | null {
  if (params.targets?.length) {
    return {
      ids: new Set(params.targets.map((t) => t.productId)),
      byId: new Map(params.targets.map((t) => [t.productId, t])),
    }
  }
  if (params.productIds?.length) {
    return { ids: new Set(params.productIds), byId: new Map() }
  }
  return null
}

/**
 * Normalize whatever `getApyHistory` returned into a `HistoryResult`.
 *
 * The contract accepts a bare `HistoryDataPoint[]` so that an adapter which
 * cannot attribute a failure to a specific product stays conforming — it simply
 * reports no failures. Callers go through here instead of branching, so adding
 * failure reporting to an adapter never touches its callers.
 */
export function toHistoryResult(
  r: HistoryDataPoint[] | HistoryResult
): HistoryResult {
  return Array.isArray(r) ? { points: r, failures: [] } : r
}
