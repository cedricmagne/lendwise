import { beforeEach, describe, expect, it, vi } from 'vitest'

// The statement is what is under test, not the database. Stub the client and
// inspect the SQL it is handed.
const execute = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db/postgres', () => ({ db: { execute } }))

const { patchDailyMarketState } = await import('@/lib/db/repositories/apy')

/**
 * The generated statement, reassembled and whitespace-collapsed.
 *
 * Drizzle nests a `sql.raw()` fragment as its own chunk tree, so a predicate
 * built from raw column names is split across objects and no regex reads it
 * off the raw JSON. Walking the chunks puts the statement back together;
 * bound parameters are values rather than chunks and drop out, which is what
 * we want — the shape is under test, not the data.
 */
function issuedSql(): string {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { value, queryChunks } = node as {
      value?: unknown
      queryChunks?: unknown
    }
    if (Array.isArray(value)) return void out.push(value.join(''))
    if (queryChunks) walk(queryChunks)
  }
  walk(execute.mock.calls[0][0])
  return out.join('').replace(/\s+/g, ' ')
}

const patches = [
  {
    productId: 'aave:v3:ethereum:reserve:0xaaa:supply',
    date: new Date('2026-07-23T00:00:00Z'),
    supplyAssets: 10,
    supplyAssetsUsd: 20,
    utilizationRate: 0.5,
    assetPriceUsd: 2,
    borrowAssets: null,
    borrowAssetsUsd: null,
  },
]

/**
 * The dry run announced 3,024 patches and the write changed 0, then announced
 * 791 and changed 2. The displayed count was of CANDIDATE rows — those
 * carrying market state — while the UPDATE deliberately restricts itself to
 * rows where a NULL actually gets filled, so that `rowCount` means something.
 * A count that does not predict the write is the defect task 10 named, so the
 * dry run must ask the database the very same question.
 */
describe('patchDailyMarketState — dry run', () => {
  beforeEach(() => {
    execute.mockReset()
    execute.mockResolvedValue({ rowCount: 0, rows: [{ count: '2' }] })
  })

  it('counts instead of writing', async () => {
    await patchDailyMarketState(patches, { dryRun: true })

    const sql = issuedSql()
    expect(sql).toMatch(/SELECT\s+count\(\*\)/i)
    expect(sql).not.toMatch(/UPDATE\s+apy_daily/i)
    expect(sql).not.toMatch(/\bSET\b/i)
  })

  it('reports the number of rows the write would change', async () => {
    const counted = await patchDailyMarketState(patches, { dryRun: true })

    expect(counted).toBe(2)
  })

  it('applies the same fill-only predicate as the write', async () => {
    // Fill-only means: the column is NULL on the row and the patch has a value.
    // Both runs must carry that clause, or the count is of something else.
    await patchDailyMarketState(patches, { dryRun: true })

    expect(issuedSql()).toMatch(
      /d\.supply_assets IS NULL AND v\.supply_assets IS NOT NULL/
    )
  })

  it('applies the same overwrite predicate as the write when asked', async () => {
    await patchDailyMarketState(patches, { dryRun: true, overwrite: true })

    expect(issuedSql()).toMatch(
      /v\.supply_assets IS NOT NULL AND d\.supply_assets IS DISTINCT FROM v\.supply_assets/
    )
  })
})
