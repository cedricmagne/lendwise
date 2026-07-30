import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpotPayload } from '@/lib/db/types'

import { issuedSql } from './issued-sql'

// It's the statement under test, not the database. The client is stubbed and
// the SQL it's handed is inspected — same pattern as aggregate-daily-orphans.
const execute = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() =>
  vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve([{ id: 'p1' }]) }),
  }))
)
vi.mock('@/lib/db/postgres', () => ({ db: { execute, select } }))

const { upsertHourlySlots } = await import('@/lib/db/repositories/apy')

const payload: SpotPayload = {
  productId: 'p1',
  kind: 'supply',
  protocol: 'aave',
  chainId: 1,
  asset: 'USDC',
  apy: { base: 0.05, rewards: 0, fees: 0.01, net: 0.04, rewardItems: [] },
  market: {
    supplyAssets: 1_000,
    supplyAssetsUsd: 1_000_000,
    utilizationRate: 0.8,
    assetPriceUsd: 1,
  },
}

describe('upsertHourlySlots — last-observation columns', () => {
  beforeEach(() => {
    execute.mockReset()
    execute.mockResolvedValue({ rowCount: 1, rows: [] })
  })

  it('writes last_supply_assets_usd without averaging it', async () => {
    await upsertHourlySlots(
      [payload],
      new Date('2026-07-27T14:00:00Z'),
      new Date('2026-07-27T14:20:00Z')
    )
    // The slot's value replaces the previous one; COALESCE keeps the last
    // KNOWN value when the current observation doesn't know.
    expect(issuedSql(execute)).toMatch(
      /last_supply_assets_usd = COALESCE\(excluded\.last_supply_assets_usd, apy_hourly\.last_supply_assets_usd\)/
    )
  })

  it('averages no last_* column', async () => {
    await upsertHourlySlots(
      [payload],
      new Date('2026-07-27T14:00:00Z'),
      new Date('2026-07-27T14:20:00Z')
    )
    // quality_count appears in no last_* expression: the incremental-mean
    // formula is the only place that uses it. Anchored at the start
    // (lookbehind) to avoid matching the "last_slot" suffix inside
    // "quality_last_slot = excluded.quality_last_slot" — that false positive
    // kept this test green even without lastSetClause(). The exact count (7)
    // also closes the gap a `toBeGreaterThan(0)` would leave open: removing
    // six of the seven columns from LAST_COLUMNS stayed green.
    const lastClauses =
      issuedSql(execute).match(/(?<![a-z_])last_[a-z_]+ = [^,]+/g) ?? []
    expect(lastClauses.length).toBe(7)
    for (const clause of lastClauses) {
      expect(clause).not.toContain('quality_count')
    }
  })

  it('leaves the mean intact on the rate columns', async () => {
    await upsertHourlySlots(
      [payload],
      new Date('2026-07-27T14:00:00Z'),
      new Date('2026-07-27T14:20:00Z')
    )
    expect(issuedSql(execute)).toContain('apy_net = CASE')
    expect(issuedSql(execute)).not.toContain('last_apy_net')
  })
})
