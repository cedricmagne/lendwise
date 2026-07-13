import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { apyHourly, productDisplayFlags, products } from '@/lib/db/schema'
import {
  DISPLAY_POLICY,
  type IneligibilityReason,
  type Observation,
  decideFlag,
  ineligibilityReason,
} from '@/lib/display-eligibility'

// ─── Reconciliation (hourly cron) ────────────────────────────────────────────

export interface ReconciliationResult {
  evaluated: number
  flagged: number
  cleared: number
  unchanged: number
}

/**
 * A row is evidence only if the hour was actually collected. `quality_count >= 6`
 * means all six 10-minute spots landed, so the hour's mean is a real mean and not
 * one unlucky sample. Healed rows count too: the policy judges the protocol's
 * RATE, not how we came by it.
 */
const MIN_QUALITY_COUNT = 6

/**
 * How many completed hours back to look. `clearHours` is the larger window, and a
 * couple of spare hours absorb a slot the pipeline missed without stalling the
 * decision forever.
 */
const LOOKBACK_HOURS = DISPLAY_POLICY.clearHours + 6

/**
 * Recompute which pools are withheld from public rankings.
 *
 * Reads the recent completed hourly rows for every active product, applies the
 * hysteresis, and writes the difference. Only the CURRENT set of hidden pools is
 * stored: `flag` upserts (preserving the original `flagged_at`, so the row keeps
 * saying when the episode began), `clear` deletes.
 *
 * The in-progress hour is excluded. Its `quality_count` is still climbing, so it
 * would look incomplete to `MIN_QUALITY_COUNT` and silently drop out of every
 * decision window — worse, it would do so non-deterministically depending on what
 * minute the cron fired.
 */
export async function reconcileDisplayFlags(
  now: Date
): Promise<ReconciliationResult> {
  const currentHour = new Date(now)
  currentHour.setUTCMinutes(0, 0, 0)
  const since = new Date(
    currentHour.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000
  )

  const [rows, flaggedRows] = await Promise.all([
    db
      .select({
        productId: apyHourly.productId,
        hour: apyHourly.hour,
        apyNet: apyHourly.apyNet,
        tvlUsd: apyHourly.supplyAssetsUsd,
      })
      .from(apyHourly)
      .innerJoin(products, eq(products.id, apyHourly.productId))
      .where(
        and(
          eq(products.active, true),
          gte(apyHourly.hour, since),
          sql`${apyHourly.hour} < ${currentHour}`,
          gte(apyHourly.qualityCount, MIN_QUALITY_COUNT)
        )
      )
      .orderBy(apyHourly.productId, desc(apyHourly.hour)),
    db
      .select({
        productId: productDisplayFlags.productId,
        flaggedAt: productDisplayFlags.flaggedAt,
      })
      .from(productDisplayFlags),
  ])

  // Group into per-product series, newest hour first (the query already sorts).
  const series = new Map<
    string,
    { hour: Date; apyNet: number | null; tvlUsd: number | null }[]
  >()
  for (const r of rows) {
    const list = series.get(r.productId)
    if (list) list.push(r)
    else series.set(r.productId, [r])
  }

  const flaggedAtById = new Map(
    flaggedRows.map((r) => [r.productId, r.flaggedAt])
  )

  const toFlag: {
    productId: string
    reason: IneligibilityReason
    flaggedAt: Date
    lastObservedHour: Date
    lastObservedApyNet: number | null
    lastObservedTvlUsd: number | null
  }[] = []
  const toClear: string[] = []
  let unchanged = 0

  for (const [productId, observations] of series) {
    const currentlyFlagged = flaggedAtById.has(productId)
    const recent: Observation[] = observations.map((o) => ({
      apyNet: o.apyNet,
      tvlUsd: o.tvlUsd,
    }))

    const action = decideFlag({ currentlyFlagged, recent })
    if (action === 'unchanged') {
      unchanged++
      continue
    }
    if (action === 'clear') {
      toClear.push(productId)
      continue
    }

    const latest = observations[0]
    const reason = ineligibilityReason(recent[0])
    // decideFlag only returns 'flag' when every observation in the window is
    // ineligible, so the newest one necessarily has a reason.
    if (!reason) continue
    toFlag.push({
      productId,
      reason,
      // Preserve the start of the episode across re-flags of an already-hidden
      // pool; a newly hidden one starts its episode now.
      flaggedAt: flaggedAtById.get(productId) ?? now,
      lastObservedHour: latest.hour,
      lastObservedApyNet: latest.apyNet,
      lastObservedTvlUsd: latest.tvlUsd,
    })
  }

  if (toFlag.length > 0) {
    const CHUNK = 200
    for (let i = 0; i < toFlag.length; i += CHUNK) {
      await db
        .insert(productDisplayFlags)
        .values(
          toFlag
            .slice(i, i + CHUNK)
            .map((f) => ({ ...f, lastEvaluatedAt: now }))
        )
        .onConflictDoUpdate({
          target: productDisplayFlags.productId,
          set: {
            reason: sql`excluded.reason`,
            lastEvaluatedAt: sql`excluded.last_evaluated_at`,
            lastObservedHour: sql`excluded.last_observed_hour`,
            lastObservedApyNet: sql`excluded.last_observed_apy_net`,
            lastObservedTvlUsd: sql`excluded.last_observed_tvl_usd`,
            // flagged_at deliberately NOT in set → the episode start survives.
          },
        })
    }
  }

  if (toClear.length > 0) {
    await db
      .delete(productDisplayFlags)
      .where(inArray(productDisplayFlags.productId, toClear))
  }

  return {
    evaluated: series.size,
    flagged: toFlag.length,
    cleared: toClear.length,
    unchanged,
  }
}

// ─── Read side ───────────────────────────────────────────────────────────────

export interface FlaggedProduct {
  productId: string
  reason: string
  flaggedAt: Date
  lastObservedApyNet: number | null
  lastObservedTvlUsd: number | null
}

/** The currently hidden pools, with why — answers "where did my pool go?". */
export async function listDisplayFlags(): Promise<FlaggedProduct[]> {
  return db
    .select({
      productId: productDisplayFlags.productId,
      reason: productDisplayFlags.reason,
      flaggedAt: productDisplayFlags.flaggedAt,
      lastObservedApyNet: productDisplayFlags.lastObservedApyNet,
      lastObservedTvlUsd: productDisplayFlags.lastObservedTvlUsd,
    })
    .from(productDisplayFlags)
    .orderBy(productDisplayFlags.reason, productDisplayFlags.productId)
}

/** Product ids currently hidden — for the page-level guard in server actions. */
export async function listDisplayFlaggedIds(): Promise<Set<string>> {
  const rows = await db
    .select({ productId: productDisplayFlags.productId })
    .from(productDisplayFlags)
  return new Set(rows.map((r) => r.productId))
}
