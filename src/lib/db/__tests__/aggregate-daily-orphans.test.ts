import { beforeEach, describe, expect, it, vi } from 'vitest'

// The statement is what is under test, not the database. Stub the client and
// inspect the SQL it is handed.
const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/postgres', () => ({ db: { execute } }))

const { aggregateDaily } = await import('@/lib/db/repositories/apy')

/** The generated SQL, whitespace-collapsed. */
function issuedSql(): string {
  return JSON.stringify(execute.mock.calls[0][0]).replace(/\\n\s*/g, ' ')
}

describe('aggregateDaily — orphan guard', () => {
  beforeEach(() => {
    execute.mockReset()
    execute.mockResolvedValue({ rowCount: 0, rows: [] })
  })

  it('joins products, so an hourly row with no catalogue entry yields no daily row', async () => {
    // 110,388 orphan hourly rows survive from an Aave listing-predicate drift.
    // Without this join, every re-aggregation of a past day minted fresh orphan
    // daily rows — 1,739 in one maintenance run.
    await aggregateDaily(
      new Date('2026-07-20T00:00:00Z'),
      new Date('2026-07-21T00:00:00Z'),
      new Date()
    )

    expect(issuedSql()).toMatch(
      /JOIN\s+products\s+p\s+ON\s+p\.id\s*=\s*h\.product_id/
    )
  })

  it('guards on existence, not on active — a delisted pool keeps aggregating', async () => {
    await aggregateDaily(
      new Date('2026-07-20T00:00:00Z'),
      new Date('2026-07-21T00:00:00Z'),
      new Date()
    )

    // `p.active` must NOT appear: a pool delisted yesterday still owes us its
    // final hours. Only a product that never existed is dropped.
    expect(issuedSql()).not.toMatch(/p\.active/)
  })
})
