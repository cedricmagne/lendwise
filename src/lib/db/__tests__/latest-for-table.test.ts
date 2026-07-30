import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The SQL is under test, not the database. The Drizzle chain is stubbed up to
// the point the query resolves; that's the query we inspect.
//
// The brief's stub only covers the outer query: `latestForTable` first builds
// the `latest` CTE via `db.selectDistinctOn(...)` and the `daily` CTE via
// `db.select(...).groupBy(...)`, then references `latest.productId` /
// `latest.apyNet` / `daily.productId` (the CTEs' columns) for the JOINs and
// the sort — the same way `queryLatestApy` already does. Without stubbed
// `db.select` / `db.selectDistinctOn` and without a "columns" object returned
// by `.as()`, building the query throws before ever reaching the assertions.
// So the stub is extended to cover the real call path, rather than weakening
// the assertions. `limit` is in the list for the same reason as the other
// methods: if `latestForTable` ever started paginating, calling
// `.limit(...)` on a stub that doesn't know it would throw a `TypeError`
// before the assertion even ran — the method's presence is what lets us then
// honestly verify it was never called.
const rows = vi.hoisted(() => [] as unknown[])
const chain = vi.hoisted(() => {
  const self: Record<string, unknown> = {}
  for (const m of [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'where',
    'groupBy',
    'orderBy',
    'selectDistinctOn',
    'limit',
  ]) {
    self[m] = vi.fn(() => self)
  }
  self.then = (resolve: (v: unknown) => unknown) => resolve(rows)
  return self
})
// Columns exposed by the `latest` / `daily` CTEs — dereferenced by
// `latestForTable` (`latest.productId`, `latest.apyNet`, `daily.productId`,
// …) before the query even runs. Both CTEs share this stub since `$with`
// resolves the same way regardless of name.
const cteColumns = vi.hoisted(() => ({
  productId: {},
  hour: {},
  apyNet: {},
  apyRewards: {},
  supplyAssets: {},
  supplyAssetsUsd: {},
  borrowAssets: {},
  borrowAssetsUsd: {},
  collateralAssetsUsd: {},
  utilizationRate: {},
  assetPriceUsd: {},
  avg7: {},
  n7: {},
  avg30: {},
  n30: {},
  avg365: {},
  n365: {},
  rew7: {},
  rew30: {},
  rew365: {},
}))
vi.mock('@/lib/db/postgres', () => ({
  db: {
    select: vi.fn(() => chain),
    selectDistinctOn: vi.fn(() => chain),
    with: vi.fn(() => chain),
    $with: vi.fn(() => ({ as: vi.fn(() => cteColumns) })),
  },
}))

const { latestForTable } = await import('@/lib/db/repositories/apy')

// Renders the captured `SQL` tree into real text (identifiers included),
// without a connection: `PgDialect` is the compiler, not a client. This is
// what lets us verify a given fragment (here `product_display_flags` /
// `NOT EXISTS`) genuinely appears in the predicate, rather than trusting a
// plain `toHaveBeenCalled()` that never looks at the argument.
const dialect = new PgDialect()

describe('latestForTable', () => {
  beforeEach(() => {
    for (const m of [
      'select',
      'from',
      'innerJoin',
      'leftJoin',
      'where',
      'groupBy',
      'orderBy',
      'selectDistinctOn',
      'limit',
    ]) {
      ;(chain[m] as ReturnType<typeof vi.fn>).mockClear()
    }
  })

  it('joins products — a displayed row exists in the catalogue by construction, filtered by the same predicate as queryApy/queryLatestApy', async () => {
    await latestForTable('supply')
    expect(chain.innerJoin).toHaveBeenCalled()

    // `latestForTable`'s file docstring claims its predicate comes from
    // `productConds()`, the same one `queryApy` and `queryLatestApy` apply —
    // in particular `displayEligible()`, the NOT EXISTS on
    // `product_display_flags`. Verified here rather than settling for the
    // `innerJoin` call, which would pass even if `.where(...)` had been
    // emptied of its predicate.
    //
    // `chain.where` receives three calls: the `daily` CTE's (the 365-day
    // window), the `latest` CTE's (the `finiteApy` / time-window filter),
    // then the outer query's (`productConds`), which share the same stub —
    // hence the last call, not the first.
    const whereCalls = (chain.where as ReturnType<typeof vi.fn>).mock.calls
    const whereArg = whereCalls[whereCalls.length - 1][0] as Parameters<
      typeof dialect.sqlToQuery
    >[0]
    const { sql } = dialect.sqlToQuery(whereArg)
    expect(sql).toContain('product_display_flags')
    expect(sql).toContain('NOT EXISTS')
  })

  it('applies no LIMIT — a table is not an API page', async () => {
    await latestForTable('supply')
    expect(chain.limit).not.toHaveBeenCalled()
  })
})
