import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

// The module reads our own tables; stub the client so the rules can be tested
// without a database. `execute` is answered per call in the order the module
// issues them: products lookup first, then the price aggregation.
const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/postgres', () => ({ db: { execute } }))

const { enrichPointsWithUsd } = await import('@/lib/backfill/enrich-usd')

const SUPPLY_ID = 'aave:v3:ethereum:reserve:0xabc:supply'
const BORROW_ID = 'aave:v3:ethereum:reserve:0xabc:borrow'
const DAY = new Date('2026-03-15T00:00:00.000Z')

function point(
  productId: string,
  kind: 'supply' | 'borrow',
  market: Partial<SupplyMarketState & BorrowMarketState>,
  timestamp = DAY
): HistoryDataPoint {
  return {
    timestamp,
    productId,
    kind,
    apy: { base: 0.04, rewards: 0, fees: 0, net: 0.04, rewardItems: [] },
    market: {
      supplyAssets: null,
      supplyAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
      ...market,
    } as SupplyMarketState | BorrowMarketState,
  }
}

/** Queue: products rows, then price rows. */
function stubDb(
  products: { id: string; asset_symbol: string }[],
  prices: { sym: string; date: string; price: number }[]
) {
  execute
    .mockResolvedValueOnce({ rows: products })
    .mockResolvedValueOnce({ rows: prices })
}

beforeEach(() => execute.mockReset())

describe('enrichPointsWithUsd', () => {
  it('prices amounts from another provider s same-day observation', async () => {
    stubDb(
      [{ id: SUPPLY_ID, asset_symbol: 'WETH' }],
      [{ sym: 'WETH', date: '2026-03-15T00:00:00.000Z', price: 2000 }]
    )

    const { points, report } = await enrichPointsWithUsd([
      point(SUPPLY_ID, 'supply', { supplyAssets: 3, utilizationRate: 0.5 }),
    ])
    const m = points[0].market as SupplyMarketState

    expect(m.assetPriceUsd).toBe(2000)
    expect(m.supplyAssetsUsd).toBe(6000)
    expect(report.crossProvider).toBe(1)
    expect(report.unpriced).toBe(0)
  })

  it('excludes no provider from the price query', async () => {
    // Morpho was excluded by name while its stored price was off by
    // 10^decimals — a single Morpho row on an asset-day halved the avg(). Both
    // the source and the stored rows are fixed, so the exclusion is gone: the
    // query must name no provider at all. The stub returns pre-filtered rows,
    // so the SQL itself is the only place this is observable in a unit test.
    stubDb(
      [{ id: SUPPLY_ID, asset_symbol: 'WETH' }],
      [{ sym: 'WETH', date: '2026-03-15T00:00:00.000Z', price: 2000 }]
    )

    await enrichPointsWithUsd([point(SUPPLY_ID, 'supply', { supplyAssets: 3 })])

    // Second execute call is the price aggregation.
    const priceCall = execute.mock.calls[1][0]
    expect(JSON.stringify(priceCall)).not.toContain('morpho')
    expect(JSON.stringify(priceCall)).not.toContain('provider')
  })

  it('derives the borrow side too', async () => {
    stubDb(
      [{ id: BORROW_ID, asset_symbol: 'WETH' }],
      [{ sym: 'WETH', date: '2026-03-15T00:00:00.000Z', price: 2000 }]
    )

    const { points } = await enrichPointsWithUsd([
      point(BORROW_ID, 'borrow', { supplyAssets: 3, borrowAssets: 2 }),
    ])
    const m = points[0].market as BorrowMarketState

    expect(m.supplyAssetsUsd).toBe(6000)
    expect(m.borrowAssetsUsd).toBe(4000)
  })

  it('never overwrites a price the source already had', async () => {
    const { points, report } = await enrichPointsWithUsd([
      point(SUPPLY_ID, 'supply', { supplyAssets: 3, assetPriceUsd: 1234 }),
    ])

    expect((points[0].market as SupplyMarketState).assetPriceUsd).toBe(1234)
    expect(report.ownPrice).toBe(1)
    // Nothing to enrich → no query at all.
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves USD null when no provider observed that asset-day', async () => {
    stubDb([{ id: SUPPLY_ID, asset_symbol: 'PT-EXOTIC' }], [])

    const { points, report } = await enrichPointsWithUsd([
      point(SUPPLY_ID, 'supply', { supplyAssets: 3 }),
    ])
    const m = points[0].market as SupplyMarketState

    expect(m.assetPriceUsd).toBeNull()
    expect(m.supplyAssetsUsd).toBeNull()
    // The amount itself is still known — a gap in USD is not a gap in tokens.
    expect(m.supplyAssets).toBe(3)
    expect(report.unpriced).toBe(1)
  })

  it('never carries a price across days', async () => {
    const nextDay = new Date('2026-03-16T00:00:00.000Z')
    stubDb(
      [{ id: SUPPLY_ID, asset_symbol: 'WETH' }],
      [{ sym: 'WETH', date: '2026-03-15T00:00:00.000Z', price: 2000 }]
    )

    const { points } = await enrichPointsWithUsd([
      point(SUPPLY_ID, 'supply', { supplyAssets: 3 }),
      point(SUPPLY_ID, 'supply', { supplyAssets: 3 }, nextDay),
    ])

    expect((points[0].market as SupplyMarketState).assetPriceUsd).toBe(2000)
    expect((points[1].market as SupplyMarketState).assetPriceUsd).toBeNull()
  })

  it('skips points that have no amount to price', async () => {
    const { points, report } = await enrichPointsWithUsd([
      point(SUPPLY_ID, 'supply', {}),
    ])

    expect((points[0].market as SupplyMarketState).supplyAssetsUsd).toBeNull()
    expect(report.unpriced).toBe(1)
    expect(execute).not.toHaveBeenCalled()
  })
})
