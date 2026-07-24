import type { HealRow } from '@/lib/db/repositories/gaps'
import type { HistoryTarget, YieldAdapter } from '@/lib/protocols/core/types'

/** A hole to fill: either no row at all, or one built from too few spots. */
export interface GapEntry {
  productId: string
  hour: Date
  kind: 'missing' | 'incomplete'
}

/**
 * Everything `runReconcile` touches, injected.
 *
 * The job's whole point is the ORDER of its steps, and an order is only worth
 * asserting if it can be asserted without a database, a network, or a signed
 * QStash request. Hence dependency injection rather than direct imports.
 */
export interface ReconcileDeps {
  findGaps(start: Date, end: Date): Promise<{ productId: string; hour: Date }[]>
  findIncomplete(
    start: Date,
    end: Date
  ): Promise<{ productId: string; hour: Date; count: number }[]>
  markStale(start: Date, end: Date): Promise<number>
  collectedProductCount(start: Date, end: Date): Promise<number>

  productProviders(productIds: string[]): Promise<Map<string, string>>
  historyTargets(productIds: string[]): Promise<HistoryTarget[]>
  adapterIdsForProvider(provider: string): readonly string[]
  loadAdapter(adapterId: string): Promise<YieldAdapter>

  fetchDonors(
    productIds: string[],
    start: Date,
    end: Date
  ): Promise<Record<string, unknown>[]>
  writeHealed(rows: HealRow[]): Promise<number>

  aggregateDaily(start: Date, end: Date, computedAt: Date): Promise<number>
  pruneHourly(): Promise<number>
}

export interface ReconcileOpts {
  /** Days of the sliding window to converge. Must cover the repair lookback. */
  days: number
  /** Detect and report, write nothing. */
  dryRun: boolean
  onProgress?: (msg: string) => void
}

/**
 * What one nightly convergence did.
 *
 * `repaired.byNeighbor` and `fetch.failed` are the two series to watch across
 * several nights: ADR 0001 defers the decision on whether nearest-neighbor
 * healing is worth keeping to exactly this measurement.
 */
export interface ReconcileReport {
  success: boolean
  window: string
  days: number
  dryRun: boolean
  detected: {
    missing: number
    incomplete: number
    markedStale: number
    collectedProducts: number
  }
  repaired: {
    byRefetch: number
    byNeighbor: number
    noDonor: number
    written: number
    perProvider: Record<
      string,
      { gaps: number; byRefetch: number; byNeighbor: number }
    >
  }
  fetch: {
    requested: number
    returned: number
    failed: number
    failuresSample: { productId: string; reason: string }[]
  }
  aggregated: { perDay: { date: string; rows: number }[] }
  pruned: number
  durationMs: number
  errors: string[]
}
