/**
 * Display eligibility — the ONE place that decides what a user is shown.
 *
 * The pipeline has three layers, and this is the middle one:
 *
 *   1. INGESTION — per protocol, in its config. The only filter allowed in a
 *      query's `where`, and it exists solely to avoid collecting literal dust. It
 *      must stay low, because it is the one IRREVERSIBLE decision in the system: a
 *      pool we never collect has no history, and can never be given one. A market
 *      at $80k that grows to $500k arrives with no 30-day mean, no 180-day stddev,
 *      and nothing the MCP can say about whether it is stable.
 *   2. ELIGIBILITY — here. Applied on the READ side, in SQL, before ordering,
 *      counting and pagination, on every surface: /supply, /borrow, the public
 *      GraphQL API, the MCP tools. Change a number here and it takes effect
 *      everywhere, instantly, retroactively, with the full history intact. That
 *      reversibility is the whole reason the filter belongs at read time and not
 *      in the fetch.
 *   3. RELEVANCE — `ApyFilters.minTvlUsd`, a per-row CONSUMER preference ("only
 *      show me markets over $1M"), opt-in, stacked on top.
 *
 * Ingestion answers "did the protocol tell us?", and its only guard is
 * `isFiniteApyBlock`. THIS module answers something else entirely: "is a stored,
 * perfectly-collected observation fit to put in front of a user?" A pool failing
 * these rules is still active, still collected, still counted as complete in the
 * /status heatmap. It is merely not shown.
 *
 * Two ways a pool becomes unshowable:
 *
 *   - `low_liquidity` — not enough behind the quote to act on. This is the rule
 *     that does most of the work, and the one that survives the next weird IRM:
 *     magnitude alone would never have caught a $22k market quoting a plausible
 *     342%, nor a dead pool quoting a plausible 8%.
 *   - `outlier_apy` — a rate no market can sustain, on a pool that DOES have
 *     liquidity. The backstop: two Morpho markets hold $27M and $8.9M at 100%
 *     utilisation and quote 297,996%. Real IRM output, real money behind it, and
 *     completely unactionable.
 *
 * Not negotiable by the caller — except through the explicit `includeIneligible`
 * escape hatch, which is what a future "expert mode" toggle will flip.
 */

export const DISPLAY_POLICY = {
  /**
   * TVL floor, USD, on the latest organically-collected `supply_assets_usd`.
   *
   * $100k is where a market starts being one you can actually act on. Below it the
   * APY is real but the liquidity is not: a $22k market at 342% would top the
   * borrow rankings and be worth nothing to anyone.
   *
   * This number used to live in the protocol GraphQL queries themselves
   * (`totalAssetsUsd_gte: 100000`), which meant it silently governed which pools
   * the /supply and /borrow PAGES fetched, while the API and the MCP applied a
   * different rule — two truths from one system. It lives here now, in one place,
   * where changing it is a one-line, retroactive change.
   *
   * Hides ~168 of 701 pools at time of writing.
   */
  minTvlUsd: 100_000,

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
export type IneligibilityReason = 'low_liquidity' | 'outlier_apy'

/** The fields of one hourly observation the policy actually looks at. */
export interface Observation {
  apyNet: number | null
  tvlUsd: number | null
}

/**
 * The reason this observation is unshowable, or null if it is fine.
 *
 * `low_liquidity` is tested first: when a pool is both empty AND absurd (which is
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
    return 'low_liquidity'
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
