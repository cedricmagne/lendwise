import { describe, expect, it } from 'vitest'

import { morphoMarketWhere } from '@/lib/protocols/morpho/v1/listing'

/**
 * A Morpho Blue market is (loan asset, COLLATERAL, oracle, IRM, LLTV). Set the
 * collateral to the zero address and you get an idle market: a parking slot
 * where MetaMorpho vaults leave liquidity they have not allocated. Nobody can
 * post collateral there, so nobody can ever borrow.
 *
 * Seen 2026-07-26 as `USDC/none` on Base: 209.21K supplied, 0% utilization,
 * 0.00% rate, no history at all — and yet counted in the borrow table's market
 * total and median, and a candidate for "cheapest rate".
 *
 * The exclusion belongs in the `where`, not in a predicate every caller must
 * remember: this file exists precisely because Morpho's listing rule IS the
 * query, and a rule that must be re-applied by hand is a rule that drifts.
 */
describe('morphoMarketWhere — idle markets', () => {
  const chains = [8453]

  it('excludes idle markets', () => {
    expect(morphoMarketWhere(chains)).toMatchObject({ isIdle: false })
  })

  it('still excludes them unfloored, because idle is not a floor', () => {
    // `unfloored` lifts thresholds a market drifts across, so a targeted
    // refetch can reach a market that has since dipped under one. A Morpho Blue
    // market id is the hash of its parameters, collateral included — nothing
    // ever stops being idle, so there is nothing to reach back for.
    expect(morphoMarketWhere(chains, { unfloored: true })).toMatchObject({
      isIdle: false,
    })
  })

  it('drops the borrow floor when unfloored, and keeps it otherwise', () => {
    expect(morphoMarketWhere(chains)).toHaveProperty('borrowAssetsUsd_gte')
    expect(morphoMarketWhere(chains, { unfloored: true })).not.toHaveProperty(
      'borrowAssetsUsd_gte'
    )
  })
})
