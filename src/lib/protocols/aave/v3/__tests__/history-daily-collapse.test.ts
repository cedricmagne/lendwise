import { describe, expect, it } from 'vitest'

import { collapseToDaily } from '@/lib/protocols/aave/v3/apy-history'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

/**
 * Aave's API windows are not the granularity the caller asked for. A request
 * whose lookback is 7 days or less maps to `LAST_WEEK`, which returns 168
 * HOURLY points — measured 2026-07-26: a 3-day window brought back 6,904
 * points where an 8-day window (`LAST_YEAR`, genuinely daily) brought back
 * 1,376. The contract says `interval: 'DAY'` yields one point per
 * (product, day), so the adapter owes the caller that collapse.
 */
function point(productId: string, iso: string, base: number): HistoryDataPoint {
  return {
    timestamp: new Date(iso),
    productId,
    kind: 'supply',
    apy: { base, rewards: 0, fees: 0, net: base, rewardItems: [] },
    market: {
      supplyAssets: null,
      supplyAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
    },
  }
}

const A = 'aave:v3:ethereum:reserve:0xaaa:supply'
const B = 'aave:v3:ethereum:reserve:0xbbb:supply'

describe('collapseToDaily', () => {
  it('keeps one point per (product, UTC day), dated at UTC midnight', () => {
    const collapsed = collapseToDaily([
      point(A, '2026-07-23T01:00:00Z', 1),
      point(A, '2026-07-23T23:00:00Z', 2),
      point(A, '2026-07-24T05:00:00Z', 3),
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((p) => p.timestamp.toISOString())).toEqual([
      '2026-07-23T00:00:00.000Z',
      '2026-07-24T00:00:00.000Z',
    ])
  })

  it('keeps the last reading of the day, not the first', () => {
    // The day-closing market state merged in afterwards describes the end of
    // the day, so the rates it travels with must too. Averaging would pair a
    // closing balance with a mean rate — a reading nobody ever observed.
    const collapsed = collapseToDaily([
      point(A, '2026-07-23T23:00:00Z', 2),
      point(A, '2026-07-23T01:00:00Z', 1),
    ])

    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].apy.base).toBe(2)
  })

  it('never merges two products that share a day', () => {
    const collapsed = collapseToDaily([
      point(A, '2026-07-23T01:00:00Z', 1),
      point(B, '2026-07-23T02:00:00Z', 9),
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((p) => p.productId).sort()).toEqual([A, B])
  })

  it('leaves an already-daily series untouched, so a long window is unaffected', () => {
    // `LAST_YEAR` already returns one point per day. The collapse must be a
    // no-op there — the 365-day backfills that built 58,632 rows keep their
    // exact behaviour.
    const daily = [
      point(A, '2026-07-23T00:00:00Z', 1),
      point(A, '2026-07-24T00:00:00Z', 2),
    ]

    expect(collapseToDaily(daily)).toEqual(daily)
  })
})
