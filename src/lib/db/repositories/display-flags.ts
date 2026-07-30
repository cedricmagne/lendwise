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
 * Evidence is an hour we ORGANICALLY collected, in full: all six 10-minute spots
 * landed, and no part of the row was reconstructed.
 *
 * `quality_count >= 6` alone is not enough, and the difference is not academic —
 * it is the bug that hid two real $27M markets as `low_liquidity`:
 *
 *   - A REFETCH-healed row carries `quality_count = 6` and the protocol's true
 *     RATE, but Morpho's market-history query returns no liquidity, so its market
 *     state is blank. It asserts nothing about TVL, and must not be allowed to
 *     decide a question that turns on TVL.
 *   - A NEAREST-NEIGHBOR-healed row is a verbatim copy of an adjacent hour, APY and
 *     TVL alike. A drained market could inherit a healthy neighbour's liquidity and
 *     slip back into the rankings on evidence that was never observed.
 *
 * Neither is a lie about the rate. Both are silent about the market. A policy that
 * weighs liquidity has to read rows that actually measured it.
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
          gte(apyHourly.qualityCount, MIN_QUALITY_COUNT),
          eq(apyHourly.healed, false)
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

  /**
   * Every pool that is hidden AFTER this run — the newly hidden AND the ones that
   * were already hidden and stay so.
   *
   * The row is rewritten for both, not just for the ones whose state changed. A
   * pool that stays hidden decides `unchanged`, and an earlier version skipped it
   * entirely: its `reason` and observed values froze at the instant it was first
   * flagged and never moved again. That went wrong in the most misleading way
   * possible — the two Morpho markets were first flagged from HEAL-written rows,
   * whose market state is empty by construction, so they were recorded as
   * `low_liquidity, TVL $0`. Once real collection resumed they turned out to hold
   * $27.8M at 100% utilisation, and the frozen row went on insisting they were
   * empty. A flag nobody can trust is a flag nobody will act on.
   *
   * So: the row always reflects the LATEST observation and the reason that holds
   * NOW. Only `flagged_at` is preserved, because that one really is about the past
   * — it marks when the current episode began.
   */
  const toPersist: {
    productId: string
    reason: IneligibilityReason
    flaggedAt: Date
    lastObservedHour: Date
    lastObservedApyNet: number | null
    lastObservedTvlUsd: number | null
  }[] = []
  const toClear: string[] = []
  let flagged = 0
  let unchanged = 0

  for (const [productId, observations] of series) {
    const currentlyFlagged = flaggedAtById.has(productId)
    const recent: Observation[] = observations.map((o) => ({
      apyNet: o.apyNet,
      tvlUsd: o.tvlUsd,
    }))

    const action = decideFlag({ currentlyFlagged, recent })

    if (action === 'clear') {
      toClear.push(productId)
      continue
    }
    if (action === 'unchanged') {
      unchanged++
      // An unflagged pool that stays unflagged has nothing to write.
      if (!currentlyFlagged) continue
    } else {
      flagged++
    }

    // Reaching here means the pool is hidden from now on. Its newest observation
    // decides the reason — which can legitimately CHANGE between runs without the
    // pool ever becoming visible: a market that empties out flips `outlier_apy` →
    // `low_liquidity`, and one that refills flips back.
    const latest = observations[0]
    const reason = ineligibilityReason(recent[0])
    // Defensive: a still-flagged pool whose newest hour is fine but which has not
    // yet earned its 12 clean hours has no reason to record. Keep the row as it is
    // rather than invent one.
    if (!reason) {
      if (currentlyFlagged) {
        await db
          .update(productDisplayFlags)
          .set({ lastEvaluatedAt: now })
          .where(eq(productDisplayFlags.productId, productId))
      }
      continue
    }

    toPersist.push({
      productId,
      reason,
      // The episode start survives; everything else is refreshed.
      flaggedAt: flaggedAtById.get(productId) ?? now,
      lastObservedHour: latest.hour,
      lastObservedApyNet: latest.apyNet,
      lastObservedTvlUsd: latest.tvlUsd,
    })
  }

  if (toPersist.length > 0) {
    const CHUNK = 200
    for (let i = 0; i < toPersist.length; i += CHUNK) {
      await db
        .insert(productDisplayFlags)
        .values(
          toPersist
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
    flagged,
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
