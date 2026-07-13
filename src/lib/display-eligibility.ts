/**
 * Display eligibility — the read-side filter layer.
 *
 * Strictly separate from ingestion. `/status` answers "did the protocol API
 * respond and did we store what it said?" and its only guard is
 * `isFiniteApyBlock`. THIS module answers a different question: "is a stored,
 * perfectly-collected observation fit to put in front of a user?" A pool failing
 * these rules is still active, still collected, still counted as complete in the
 * pipeline heatmap. It is merely not shown.
 *
 * Two ways a pool becomes unshowable:
 *
 *   - `empty_market` — no liquidity behind the quote. An IRM on a drained market
 *     returns arithmetic, not a rate: our two worst pools sit at TVL $0 with
 *     utilisation 0.000 and quote 297,996%. Below the floor nobody can deposit
 *     and the APY is numerically meaningless, so the number is noise whatever it
 *     says. This is the rule that survives the next weird IRM — magnitude alone
 *     would not have caught a dead pool quoting a plausible 8%.
 *   - `outlier_apy` — a rate no market can sustain, on a pool that does have
 *     liquidity. The backstop for the case the TVL floor misses.
 *
 * Not to be confused with `ApyFilters.minTvlUsd`, which is a CONSUMER preference
 * ("only show me markets over $1M") applied per row and opt-in. Eligibility is a
 * property of the product, always on, and not negotiable by the caller — except
 * through the explicit `includeIneligible` raw-data escape hatch.
 */

export const DISPLAY_POLICY = {
  /**
   * TVL floor, USD, on the latest `supply_assets_usd`. Chosen to match the
   * `borrowAssetsUsd_gte: 10000` filter Morpho's own ingestion query already
   * applies, so the two ends of the pipeline agree on what counts as a market.
   * Hides 60 of 705 pools at time of writing.
   */
  minTvlUsd: 10_000,

  /**
   * Absolute net-APY ceiling, as a fraction (10 = 1000%). Rates are stored as
   * fractions — 0.05 is 5% — so this is 1000%, not 10%.
   */
  maxAbsNetApy: 10,

  /** Consecutive ineligible hours before a pool is hidden. */
  flagHours: 3,

  /**
   * Consecutive eligible hours before a hidden pool comes back. Deliberately
   * asymmetric: re-showing a pool is the risky direction, so it needs four times
   * the evidence. Prevents a single good hour from flapping a dead pool back
   * into the rankings.
   */
  clearHours: 12,
} as const

/** Why a pool is not shown. Recorded so "why is my pool missing?" is answerable. */
export type IneligibilityReason = 'empty_market' | 'outlier_apy'

/** The fields of one hourly observation the policy actually looks at. */
export interface Observation {
  apyNet: number | null
  tvlUsd: number | null
}

/**
 * The reason this observation is unshowable, or null if it is fine.
 *
 * `empty_market` is tested first: when a pool is both empty AND absurd (which is
 * exactly what our two worst pools are), the empty market is the root cause and
 * the absurd rate is its symptom. Reporting the cause is more useful.
 *
 * A null TVL is treated as empty. "We don't know the liquidity" is not a basis
 * for ranking a market — same reasoning as pushing NULLs last in ORDER BY.
 */
export function ineligibilityReason(
  o: Observation
): IneligibilityReason | null {
  if (o.tvlUsd == null || o.tvlUsd < DISPLAY_POLICY.minTvlUsd) {
    return 'empty_market'
  }
  if (
    o.apyNet == null ||
    !Number.isFinite(o.apyNet) ||
    Math.abs(o.apyNet) > DISPLAY_POLICY.maxAbsNetApy
  ) {
    return 'outlier_apy'
  }
  return null
}

export type FlagAction = 'flag' | 'clear' | 'unchanged'

/**
 * Decide what to do with a pool, given whether it is currently hidden and its
 * most recent COMPLETED hourly observations (newest first).
 *
 * Missing hours are not evidence. A pool with fewer than the required number of
 * observations stays as it is: we neither hide a pool because the pipeline was
 * down, nor un-hide one because it stopped reporting.
 */
export function decideFlag(input: {
  currentlyFlagged: boolean
  recent: Observation[]
}): FlagAction {
  const { currentlyFlagged, recent } = input

  if (!currentlyFlagged) {
    const window = recent.slice(0, DISPLAY_POLICY.flagHours)
    if (window.length < DISPLAY_POLICY.flagHours) return 'unchanged'
    return window.every((o) => ineligibilityReason(o) !== null)
      ? 'flag'
      : 'unchanged'
  }

  const window = recent.slice(0, DISPLAY_POLICY.clearHours)
  if (window.length < DISPLAY_POLICY.clearHours) return 'unchanged'
  return window.every((o) => ineligibilityReason(o) === null)
    ? 'clear'
    : 'unchanged'
}
