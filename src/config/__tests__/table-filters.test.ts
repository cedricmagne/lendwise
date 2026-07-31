import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BORROW_FILTERS,
  DEFAULT_MAX_ABS_NET_APY,
  DEFAULT_MIN_TVL_USD,
  DEFAULT_SUPPLY_FILTERS,
} from '@/config/table-filters'
import { type FilterableRow, matchesFilters } from '@/lib/table-filters'

/**
 * The defaults must reproduce today's visible set — the same pools the removed
 * DISPLAY_POLICY judged, minus the 3h/12h lag. These are the two real markets
 * the old policy was built around.
 */
const morphoOutlier: FilterableRow = {
  assetAmountUsd: 27_800_000,
  liquidityAmountUsd: 0,
  apy: 2979.96, // 297 996 %
}
const thinMarket: FilterableRow = {
  assetAmountUsd: 22_000,
  liquidityAmountUsd: 22_000,
  apy: 3.42,
}
const healthy: FilterableRow = {
  assetAmountUsd: 5_000_000,
  liquidityAmountUsd: 2_000_000,
  apy: 0.043,
}

describe('default table filters', () => {
  it('carries the old policy numbers as starting values', () => {
    expect(DEFAULT_MIN_TVL_USD).toBe(100_000)
    expect(DEFAULT_MAX_ABS_NET_APY).toBe(10)
  })

  it('bounds Net APY on BOTH sides — a borrow net can go deeply negative', () => {
    for (const set of [DEFAULT_SUPPLY_FILTERS, DEFAULT_BORROW_FILTERS]) {
      const netApy = set.filter((f) => f.field === 'netApy')
      expect(netApy).toHaveLength(2)
      expect(netApy.map((f) => f.op).sort()).toEqual(['gte', 'lte'])
    }
  })

  it('hides the outlier, the thin market, and nothing healthy', () => {
    for (const set of [DEFAULT_SUPPLY_FILTERS, DEFAULT_BORROW_FILTERS]) {
      expect(matchesFilters(morphoOutlier, set, 'intraday')).toBe(false)
      expect(matchesFilters(thinMarket, set, 'intraday')).toBe(false)
      expect(matchesFilters(healthy, set, 'intraday')).toBe(true)
    }
  })

  it('shows the thin market again once the user lowers the floor to zero', () => {
    const relaxed = DEFAULT_SUPPLY_FILTERS.filter((f) => f.field !== 'deposits')
    expect(matchesFilters(thinMarket, relaxed, 'intraday')).toBe(true)
  })
})
