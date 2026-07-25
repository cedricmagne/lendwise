import type { HealRow } from '@/lib/db/repositories/gaps'
import { findNearestDonor } from '@/lib/heal/donors'
import { groupGapsByProvider } from '@/lib/heal/gap-spans'
import { toHistoryResult } from '@/lib/protocols/core/history-result'
import type {
  HistoryDataPoint,
  HistoryFailure,
} from '@/lib/protocols/core/types'

import type {
  GapEntry,
  ReconcileDeps,
  ReconcileOpts,
  ReconcileReport,
} from './types'

export type {
  GapEntry,
  ReconcileDeps,
  ReconcileOpts,
  ReconcileReport,
} from './types'

/** Extra hours either side of the gap window to search for donors. */
const DONOR_PADDING_HOURS = 6

/**
 * The sliding window reconcile converges every night, in days.
 *
 * Exported because it is a CONTRACT, not a default: maintenance scripts skip
 * re-aggregating any day inside it, on the strength of reconcile getting to it
 * tonight. If the two numbers ever drifted apart, a script would silently leave
 * days stale. One constant, read by the route and by every script that deletes
 * rows.
 */
export const RECONCILE_WINDOW_DAYS = 7

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeHour(d: Date): Date {
  const n = new Date(d)
  n.setUTCMinutes(0, 0, 0)
  return n
}

/** Lookup key `${productId}:${YYYY-MM-DDTHH}`. */
function lookupKey(productId: string, hour: Date): string {
  return `${productId}:${hour.toISOString().slice(0, 13)}`
}

function donorMarket(
  d: Record<string, unknown>
): Record<string, number | null> {
  return {
    supplyAssets: d.supply_assets as number | null,
    supplyAssetsUsd: d.supply_assets_usd as number | null,
    utilizationRate: d.utilization_rate as number | null,
    assetPriceUsd: d.asset_price_usd as number | null,
    borrowAssets: d.borrow_assets as number | null,
    borrowAssetsUsd: d.borrow_assets_usd as number | null,
    collateralAssetsUsd: d.collateral_assets_usd as number | null,
    priceCollateralInLoanAsset: d.price_collateral_in_loan_asset as
      | number
      | null,
  }
}

/** Hour-aligned UTC midnights covering the window, oldest first. */
function daysOf(windowStart: Date, windowEnd: Date): Date[] {
  const days: Date[] = []
  const cursor = new Date(windowStart)
  cursor.setUTCHours(0, 0, 0, 0)
  while (cursor < windowEnd) {
    days.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

// ─── The job ────────────────────────────────────────────────────────────────

/**
 * Converge the sliding window: detect holes, repair them, re-aggregate the days
 * they belong to, then prune what has aged out.
 *
 * The ORDER is the point. These four steps used to be three separately
 * scheduled jobs — daily aggregation at 00:10, gap detection at 01:00, healing
 * after it — coupled only by cron times and by a report row acting as an
 * interface. Aggregation therefore ran BEFORE the night's repairs, so not one
 * repaired row ever reached `apy_daily`: the deep series carried biased
 * averages and understated completeness, permanently. Chaining the steps makes
 * that class of bug impossible rather than fixed, and demotes the report back
 * to what it should be — a log.
 *
 * A failing step never cancels the previous ones. Every write is idempotent, so
 * the honest recovery is to record the error and let the next night replay.
 */
export async function runReconcile(
  deps: ReconcileDeps,
  opts: ReconcileOpts
): Promise<ReconcileReport> {
  const started = Date.now()
  const log = opts.onProgress ?? console.log
  const errors: string[] = []

  const windowEnd = new Date()
  windowEnd.setUTCMinutes(0, 0, 0)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCHours(windowStart.getUTCHours() - opts.days * 24)

  const report: ReconcileReport = {
    success: true,
    window: `${windowStart.toISOString()} → ${windowEnd.toISOString()}`,
    days: opts.days,
    dryRun: opts.dryRun,
    detected: {
      missing: 0,
      incomplete: 0,
      markedStale: 0,
      collectedProducts: 0,
    },
    repaired: {
      byRefetch: 0,
      byNeighbor: 0,
      noDonor: 0,
      written: 0,
      perProvider: {},
    },
    fetch: { requested: 0, returned: 0, failed: 0, failuresSample: [] },
    aggregated: { perDay: [] },
    pruned: 0,
    orphans: { hourly: 0, daily: 0 },
    durationMs: 0,
    errors,
  }

  // ── Step 1 — detect ───────────────────────────────────────────────────────

  let entries: GapEntry[] = []
  try {
    const [gaps, incomplete, collectedProducts] = await Promise.all([
      deps.findGaps(windowStart, windowEnd),
      deps.findIncomplete(windowStart, windowEnd),
      deps.collectedProductCount(windowStart, windowEnd),
    ])
    // markStale mutates, so it is skipped in a dry run; the others only read.
    const markedStale = opts.dryRun
      ? 0
      : await deps.markStale(windowStart, windowEnd)

    entries = [
      ...gaps.map((g) => ({ ...g, kind: 'missing' as const })),
      ...incomplete.map((i) => ({
        productId: i.productId,
        hour: i.hour,
        kind: 'incomplete' as const,
      })),
    ]
    report.detected = {
      missing: gaps.length,
      incomplete: incomplete.length,
      markedStale,
      collectedProducts,
    }
    log(
      `[reconcile] detected ${gaps.length} missing, ${incomplete.length} incomplete over ${opts.days}d`
    )
  } catch (err) {
    errors.push(`detect: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Step 2 — repair ───────────────────────────────────────────────────────

  if (entries.length > 0) {
    try {
      await repair(deps, opts, entries, report, errors, log)
    } catch (err) {
      errors.push(`repair: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Step 3 — re-aggregate the SAME window ─────────────────────────────────

  // Oldest day first, so a partially failing run still leaves the series
  // consistent from the past forward rather than in scattered patches.
  for (const day of daysOf(windowStart, windowEnd)) {
    const dayEnd = new Date(day)
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)
    try {
      const rows = opts.dryRun
        ? 0
        : await deps.aggregateDaily(day, dayEnd, new Date())
      report.aggregated.perDay.push({
        date: day.toISOString().slice(0, 10),
        rows,
      })
    } catch (err) {
      errors.push(
        `aggregate ${day.toISOString().slice(0, 10)}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── Step 4 — prune ────────────────────────────────────────────────────────

  try {
    report.pruned = opts.dryRun ? 0 : await deps.pruneHourly()
  } catch (err) {
    errors.push(`prune: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Health probe — orphan rows ────────────────────────────────────────────
  // Not a step: it reads, reports, and repairs nothing. It runs in dry mode
  // too, since counting writes nothing and a dry run is exactly when someone is
  // looking at the output.
  try {
    report.orphans = await deps.countOrphans()
    if (report.orphans.hourly > 0 || report.orphans.daily > 0) {
      log(
        `[reconcile] ORPHAN ROWS — ${report.orphans.hourly} hourly, ${report.orphans.daily} daily ` +
          `with no products row. A listing predicate has drifted; investigate before purging.`
      )
    }
  } catch (err) {
    errors.push(`orphans: ${err instanceof Error ? err.message : String(err)}`)
  }

  report.success = errors.length === 0
  report.durationMs = Date.now() - started
  log(
    `[reconcile] repaired ${report.repaired.written} (refetch ${report.repaired.byRefetch}, neighbor ${report.repaired.byNeighbor}, noDonor ${report.repaired.noDonor}), pruned ${report.pruned}`
  )
  return report
}

// ─── Step 2, in detail ──────────────────────────────────────────────────────

async function repair(
  deps: ReconcileDeps,
  opts: ReconcileOpts,
  entries: GapEntry[],
  report: ReconcileReport,
  errors: string[],
  log: (msg: string) => void
): Promise<void> {
  const productIds = [...new Set(entries.map((e) => e.productId))]
  const [providerOf, targets] = await Promise.all([
    deps.productProviders(productIds),
    deps.historyTargets(productIds),
  ])
  const targetById = new Map(targets.map((t) => [t.productId, t]))

  const { spanByProvider, globalSpan } = groupGapsByProvider(
    entries.map((e) => ({
      productId: e.productId,
      hour: e.hour.toISOString(),
    })),
    providerOf
  )

  for (const entry of entries) {
    const provider = providerOf.get(entry.productId)
    if (!provider) continue
    const bucket = (report.repaired.perProvider[provider] ??= {
      gaps: 0,
      byRefetch: 0,
      byNeighbor: 0,
    })
    bucket.gaps++
  }

  // Phase 1 — authoritative refetch, each provider over its OWN span and only
  // for the products it actually has holes for.
  const historyLookup = new Map<string, HistoryDataPoint>()
  const failures: HistoryFailure[] = []

  for (const [provider, span] of spanByProvider) {
    const wanted = productIds.filter((id) => providerOf.get(id) === provider)
    const wantedTargets = wanted
      .map((id) => targetById.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
    report.fetch.requested += wanted.length

    for (const adapterId of deps.adapterIdsForProvider(provider)) {
      try {
        const adapter = await deps.loadAdapter(adapterId)
        if (!adapter.getApyHistory) continue

        const result = toHistoryResult(
          await adapter.getApyHistory({
            startTimestamp: Math.floor(span.min / 1000) - 3600,
            endTimestamp: Math.floor(span.max / 1000) + 3600,
            interval: 'HOUR',
            productIds: wanted,
            targets: wantedTargets.length > 0 ? wantedTargets : undefined,
            onProgress: (m) => log(`[reconcile] ${m}`),
          })
        )

        for (const pt of result.points) {
          historyLookup.set(
            lookupKey(pt.productId, normalizeHour(pt.timestamp)),
            pt
          )
        }
        failures.push(...result.failures)
      } catch (err) {
        errors.push(
          `${adapterId}-history: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  report.fetch.returned = new Set(
    [...historyLookup.values()].map((p) => p.productId)
  ).size
  report.fetch.failed = failures.length
  report.fetch.failuresSample = failures.slice(0, 20)

  // Phase 2 — donors, for whatever phase 1 could not reach.
  const needNeighbor = new Set(
    entries
      .filter((e) => !historyLookup.has(lookupKey(e.productId, e.hour)))
      .map((e) => e.productId)
  )
  const donorsByProduct = new Map<
    string,
    { hour: Date; apy: HealRow['apy']; market: Record<string, number | null> }[]
  >()

  if (needNeighbor.size > 0) {
    const donorRows = await deps.fetchDonors(
      [...needNeighbor],
      new Date(globalSpan.min - DONOR_PADDING_HOURS * 3600_000),
      new Date(globalSpan.max + DONOR_PADDING_HOURS * 3600_000)
    )
    for (const d of donorRows) {
      const productId = d.product_id as string
      const list = donorsByProduct.get(productId) ?? []
      list.push({
        hour: new Date(d.hour as string),
        apy: {
          base: d.apy_base as number,
          rewards: d.apy_rewards as number,
          fees: d.apy_fees as number,
          net: d.apy_net as number,
          rewardItems: (d.reward_items as unknown[]) ?? [],
        },
        market: donorMarket(d),
      })
      donorsByProduct.set(productId, list)
    }
  }

  // Phase 3 — build the rows.
  const rows: HealRow[] = []
  for (const entry of entries) {
    const provider = providerOf.get(entry.productId)
    const bucket = provider ? report.repaired.perProvider[provider] : undefined

    const hp = historyLookup.get(lookupKey(entry.productId, entry.hour))
    if (hp) {
      rows.push({
        productId: entry.productId,
        hour: entry.hour,
        apy: {
          base: hp.apy.base,
          rewards: hp.apy.rewards,
          fees: hp.apy.fees,
          net: hp.apy.net,
          rewardItems: hp.apy.rewardItems ?? [],
        },
        market: hp.market as unknown as Record<string, number | null>,
        source: 'refetch',
        healedFrom: hp.timestamp.toISOString(),
        gapKind: entry.kind,
      })
      report.repaired.byRefetch++
      if (bucket) bucket.byRefetch++
      continue
    }

    const donor = findNearestDonor(
      entry.hour,
      donorsByProduct.get(entry.productId) ?? []
    )
    if (donor) {
      rows.push({
        productId: entry.productId,
        hour: entry.hour,
        apy: donor.apy,
        market: donor.market,
        source: 'nearest-neighbor',
        healedFrom: donor.hour.toISOString(),
        gapKind: entry.kind,
      })
      report.repaired.byNeighbor++
      if (bucket) bucket.byNeighbor++
    } else {
      report.repaired.noDonor++
    }
  }

  report.repaired.written = opts.dryRun ? 0 : await deps.writeHealed(rows)
}
