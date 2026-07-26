import { describe, expect, it, vi } from 'vitest'

// The selection rule is pure, but its module opens a database client on import.
vi.mock('@/lib/db/postgres', () => ({ db: { execute: vi.fn() } }))

const { selectDailyInserts } = await import('@/lib/db/repositories/apy')
type DailyBackfillInput = Parameters<typeof selectDailyInserts>[0][number]

/**
 * The dry run of `backfill-history` used to count POINTS while the write
 * counted ROWS: on 2026-07-26 it announced 1,724 insertions and wrote 72, the
 * ratio being the 24 hourly readings Aave returns per day on a short window.
 * Same defect as task 10's 3,489-vs-3,667, and the same remedy — one function
 * decides what gets written, and the dry run calls it.
 */
function input(
  productId: string,
  iso: string,
  base: number
): DailyBackfillInput {
  return {
    productId,
    date: new Date(iso),
    apy: { base, rewards: 0, fees: 0, net: base, rewardItems: [] },
    market: {
      supplyAssets: null,
      supplyAssetsUsd: null,
      utilizationRate: null,
      assetPriceUsd: null,
      borrowAssets: null,
      borrowAssetsUsd: null,
      collateralAssetsUsd: null,
      priceCollateralInLoanAsset: null,
    },
  }
}

const A = 'aave:v3:ethereum:reserve:0xaaa:supply'
const B = 'aave:v3:ethereum:reserve:0xbbb:borrow'

describe('selectDailyInserts', () => {
  it('collapses many readings of one day into the single row that will exist', () => {
    const selected = selectDailyInserts(
      [
        input(A, '2026-07-23T01:00:00Z', 1),
        input(A, '2026-07-23T12:00:00Z', 2),
        input(A, '2026-07-23T23:00:00Z', 3),
      ],
      new Set([A])
    )

    expect(selected).toHaveLength(1)
    expect(selected[0].apy.base).toBe(3)
  })

  it('drops products absent from the catalogue', () => {
    const selected = selectDailyInserts(
      [
        input(A, '2026-07-23T01:00:00Z', 1),
        input(B, '2026-07-23T01:00:00Z', 2),
      ],
      new Set([A])
    )

    expect(selected.map((r) => r.productId)).toEqual([A])
  })

  it('fails open on an empty catalogue rather than dropping everything', () => {
    // An empty `listed` set means the catalogue read failed, not that nothing
    // is listed. Dropping a whole backfill is worse than a few orphans, and
    // the write has always behaved this way — the dry run must agree.
    const selected = selectDailyInserts(
      [input(A, '2026-07-23T01:00:00Z', 1)],
      new Set()
    )

    expect(selected).toHaveLength(1)
  })
})
