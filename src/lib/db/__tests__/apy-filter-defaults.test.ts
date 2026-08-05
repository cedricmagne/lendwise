import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/postgres', () => ({ db: { execute: vi.fn() } }))

const { displayFilters } = await import('@/lib/db/repositories/apy')

/**
 * The API's contract after the flags table is gone: say nothing and you get the
 * same set the tables show on first load; pass 0 and you get everything.
 *
 * `0` DISABLES the filter rather than being compared against, and that is not
 * cosmetic: `supply_assets_usd >= 0` still drops every row whose TVL is NULL,
 * so "give me everything" would silently keep hiding the markets we know least
 * about.
 */
describe('displayFilters', () => {
  it('applies the defaults when the caller asks for nothing', () => {
    expect(displayFilters({ kind: 'supply' })).toEqual([
      expect.objectContaining({ field: 'deposits', op: 'gte', value: 100_000 }),
      expect.objectContaining({ field: 'netApy', op: 'lte', value: 10 }),
      expect.objectContaining({ field: 'netApy', op: 'gte', value: -10 }),
    ])
  })

  it('honours an explicit floor', () => {
    const f = displayFilters({ kind: 'supply', minTvlUsd: 1_000_000 })
    expect(f).toContainEqual(
      expect.objectContaining({
        field: 'deposits',
        op: 'gte',
        value: 1_000_000,
      })
    )
  })

  it('drops the floor entirely on 0 — including rows with an unknown TVL', () => {
    const f = displayFilters({ kind: 'supply', minTvlUsd: 0 })
    expect(f.some((x) => x.field === 'deposits')).toBe(false)
  })

  it('drops both rate bounds on 0', () => {
    const f = displayFilters({ kind: 'supply', maxAbsNetApy: 0 })
    expect(f.some((x) => x.field === 'netApy')).toBe(false)
  })

  it('returns an empty list when both are zeroed — the raw table', () => {
    expect(
      displayFilters({ kind: 'borrow', minTvlUsd: 0, maxAbsNetApy: 0 })
    ).toEqual([])
  })
})
