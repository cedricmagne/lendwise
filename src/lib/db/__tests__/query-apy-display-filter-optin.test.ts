import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `queryApy` backs the time-series GraphQL fields (a single product's history
// across many hours/days), not a ranking. Unlike `queryLatestApy`, the
// display predicate here must be OPT-IN: applying it by default would punch
// undocumented holes in an otherwise-complete series (a healthy product that
// dipped under the TVL floor for a few hours would come back with exactly
// those hours missing — indistinguishable from a real pipeline gap). The SQL
// is under test, not the database — the Drizzle chain is stubbed up to the
// point the query resolves, same approach as `latest-for-table.test.ts`.
const rows = vi.hoisted(() => [] as unknown[])
const chain = vi.hoisted(() => {
  const self: Record<string, unknown> = {}
  for (const m of [
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'offset',
  ]) {
    self[m] = vi.fn(() => self)
  }
  self.then = (resolve: (v: unknown) => unknown) => resolve(rows)
  return self
})
vi.mock('@/lib/db/postgres', () => ({
  db: { select: vi.fn(() => chain) },
}))

const { queryApy } = await import('@/lib/db/repositories/apy')

const dialect = new PgDialect()

const page = {
  first: 100,
  skip: 0,
  orderBy: 'time' as const,
  orderDir: 'desc' as const,
}

function lastWhereSql(): string {
  const calls = (chain.where as ReturnType<typeof vi.fn>).mock.calls
  const arg = calls[calls.length - 1][0] as Parameters<
    typeof dialect.sqlToQuery
  >[0]
  return dialect.sqlToQuery(arg).sql
}

describe('queryApy — display filter is opt-in', () => {
  beforeEach(() => {
    for (const m of [
      'select',
      'from',
      'innerJoin',
      'where',
      'orderBy',
      'limit',
      'offset',
    ]) {
      ;(chain[m] as ReturnType<typeof vi.fn>).mockClear()
    }
  })

  it('applies no TVL floor when the caller passes neither bound — a complete series', async () => {
    await queryApy('hourly', { kind: 'supply' }, page)
    const sql = lastWhereSql()
    // `deposits` compiles to `COALESCE(last_supply_assets_usd, supply_assets_usd)`
    // only when `displayFilters()`'s conditions are pushed onto `where`.
    expect(sql).not.toContain('last_supply_assets_usd')
  })

  it('applies no extra rate bound when the caller passes neither bound — `apy_net` appears once, from the finiteApy NaN guard only', async () => {
    await queryApy('hourly', { kind: 'supply' }, page)
    const sql = lastWhereSql()
    expect(sql.match(/"apy_net"/g)?.length ?? 0).toBe(1)
  })

  it('applies the TVL floor when minTvlUsd is passed explicitly', async () => {
    await queryApy('hourly', { kind: 'supply', minTvlUsd: 500_000 }, page)
    const sql = lastWhereSql()
    expect(sql).toContain('last_supply_assets_usd')
  })

  it('applies the rate ceiling when maxAbsNetApy is passed explicitly — `apy_net` appears three times: the finiteApy guard plus the lte/gte bounds', async () => {
    await queryApy('hourly', { kind: 'supply', maxAbsNetApy: 5 }, page)
    const sql = lastWhereSql()
    expect(sql.match(/"apy_net"/g)?.length ?? 0).toBe(3)
  })
})
