import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MARKETS_ALL,
  MARKET_HOURLY_ACCOUNTING,
} from '@/lib/protocols/compound/v3/queries'

/**
 * Targeting tests for Compound's history adapter.
 *
 * Compound's snapshots are paginated per chain and cover every market on it, so
 * a targeted repair used to pay for all five chains and all their markets. Here
 * the adapter resolves which market ids matter from ONE cheap markets query,
 * then either narrows the snapshot filter to them or skips the chain entirely.
 */

const MARKET_A = '0xaaaa000000000000000000000000000000000001'
const MARKET_B = '0xbbbb000000000000000000000000000000000002'

const pid = (marketId: string, kind: 'supply' | 'borrow') =>
  `compoundcomet:v3:ethereum:market:${marketId}:${kind}`

function snapshot(marketId: string) {
  return {
    timestamp: '1753000000',
    market: {
      id: marketId,
      configuration: {
        symbol: 'USDC',
        baseToken: { lastPriceUsd: '1', token: { decimals: 6 } },
      },
    },
    accounting: {
      supplyApr: '0.05',
      netSupplyApr: '0.05',
      rewardSupplyApr: '0',
      borrowApr: '0.09',
      netBorrowApr: '0.09',
      rewardBorrowApr: '0',
      totalBaseSupply: '1000000',
      totalBaseSupplyUsd: '1',
      totalBaseBorrow: '500000',
      totalBaseBorrowUsd: '0.5',
      utilization: '0.5',
      collateralBalanceUsd: '0',
    },
  }
}

/**
 * @param snapshotMarkets markets the accounting entity actually has rows for.
 *   Compound's subgraph writes an hourly entry only when a market saw activity
 *   in the hour — measured 2026-07-26 at 23 entries over a 48-hour window, so
 *   16-24% of hours. A listed market with no row for the hour is the norm, not
 *   an anomaly, and the adapter must not report it as a missing market.
 * @param listingFails makes the markets query error, so the chain answers
 *   nothing for a reason that is neither of the above.
 */
function makeClient(
  opts: { snapshotMarkets?: string[]; listingFails?: boolean } = {}
) {
  const snapshotMarkets = opts.snapshotMarkets ?? [MARKET_A, MARKET_B]
  const calls: { doc: unknown; vars: Record<string, unknown> }[] = []

  const client = {
    query(doc: unknown, vars: Record<string, unknown>) {
      calls.push({ doc, vars })
      return {
        toPromise: async () => {
          if (doc === MARKETS_ALL) {
            if (opts.listingFails) {
              return { data: undefined, error: { message: 'subgraph down' } }
            }
            return {
              data: {
                markets: [MARKET_A, MARKET_B].map((id) => ({
                  id,
                  configuration: {
                    baseToken: {
                      token: {
                        symbol: 'USDC',
                        name: 'USD Coin',
                        decimals: 6,
                        address: '0xusdc',
                      },
                    },
                    collateralTokens: [],
                  },
                })),
              },
              error: undefined,
            }
          }
          if (doc === MARKET_HOURLY_ACCOUNTING) {
            const filter = vars.where as { market_in?: string[] } | undefined
            const ids = (filter?.market_in ?? [MARKET_A, MARKET_B]).filter(
              (id) => snapshotMarkets.includes(id)
            )
            // Page 2 must come back empty or fetchAllSnapshots keeps paging.
            const first = (vars.skip as number) > 0
            return {
              data: {
                hourlyMarketAccountings: first ? [] : ids.map(snapshot),
              },
              error: undefined,
            }
          }
          return { data: undefined, error: { message: 'unexpected query' } }
        },
      }
    },
  }

  return { client, calls }
}

let current = makeClient()

vi.mock('@/lib/protocols/core/toolkit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/protocols/core/toolkit')>()
  return { ...actual, createGraphQLClient: () => current.client }
})

const snapshotCalls = () =>
  current.calls.filter((c) => c.doc === MARKET_HOURLY_ACCOUNTING)

async function run(params: Record<string, unknown>) {
  const { getCompoundApyHistory } =
    await import('@/lib/protocols/compound/v3/apy-history')
  return getCompoundApyHistory({
    startTimestamp: 1_752_900_000,
    endTimestamp: 1_753_100_000,
    interval: 'HOUR',
    chainIds: [1],
    onProgress: () => {},
    ...params,
  } as Parameters<typeof getCompoundApyHistory>[0])
}

beforeEach(() => {
  current = makeClient()
})

describe('getCompoundApyHistory — productIds targeting', () => {
  it('narrows the snapshot filter to the requested markets', async () => {
    await run({ productIds: [pid(MARKET_A, 'supply')] })

    expect(snapshotCalls().length).toBeGreaterThan(0)
    const where = snapshotCalls()[0].vars.where as { market_in?: string[] }
    expect(where.market_in).toEqual([MARKET_A])
  })

  it('returns points only for the requested products', async () => {
    const result = await run({ productIds: [pid(MARKET_A, 'supply')] })
    const { points } = result as { points: { productId: string }[] }

    expect(points.map((p) => p.productId)).toEqual([pid(MARKET_A, 'supply')])
  })

  it('skips the snapshot query entirely when no market on the chain matches', async () => {
    await run({ productIds: [pid('0xdead', 'supply')] })

    expect(snapshotCalls()).toHaveLength(0)
  })

  it('reports a requested product no market carries', async () => {
    const result = await run({ productIds: [pid('0xdead', 'supply')] })
    const { failures } = result as { failures: { productId: string }[] }

    expect(failures.map((f) => f.productId)).toEqual([pid('0xdead', 'supply')])
  })

  it('without productIds, queries snapshots unfiltered', async () => {
    await run({})

    expect(snapshotCalls().length).toBeGreaterThan(0)
    const where = snapshotCalls()[0].vars.where as { market_in?: string[] }
    expect(where.market_in).toBeUndefined()
  })
})

/**
 * Three ways a requested product goes unanswered, and they are not the same
 * incident. Reporting all three as "no Compound market carries it" sent an
 * on-call reader after a delisting that had not happened: on the night of
 * 2026-07-26 the nine markets so reported were active, catalogued and
 * collected normally, and only the HOUR was missing upstream.
 */
describe('getCompoundApyHistory — why a product went unanswered', () => {
  const reasonFor = (result: unknown, productId: string): string | undefined =>
    (
      result as { failures: { productId: string; reason: string }[] }
    ).failures.find((f) => f.productId === productId)?.reason

  it('says the snapshot is missing when the market itself is listed', async () => {
    current = makeClient({ snapshotMarkets: [] })

    const result = await run({ productIds: [pid(MARKET_A, 'supply')] })

    expect(reasonFor(result, pid(MARKET_A, 'supply'))).toMatch(/snapshot/i)
  })

  it('does not blame the market when the market is listed', async () => {
    current = makeClient({ snapshotMarkets: [] })

    const result = await run({ productIds: [pid(MARKET_A, 'supply')] })

    expect(reasonFor(result, pid(MARKET_A, 'supply'))).not.toMatch(
      /no Compound market carries it/i
    )
  })

  it('still blames the market when no listing knows it', async () => {
    const result = await run({ productIds: [pid('0xdead', 'supply')] })

    expect(reasonFor(result, pid('0xdead', 'supply'))).toMatch(
      /no Compound market carries it/i
    )
  })

  it('names the upstream failure rather than inventing a missing market', async () => {
    // The listing query is what failed, so we cannot know whether Compound
    // carries the product. Claiming it does not would be a guess presented as
    // a finding.
    current = makeClient({ listingFails: true })

    const result = await run({ productIds: [pid(MARKET_A, 'supply')] })

    expect(reasonFor(result, pid(MARKET_A, 'supply'))).toMatch(/cannot tell/i)
  })

  it('does not pass a broken chain off as a missing snapshot', async () => {
    // The listing answered, so the market IS known — but the fetch that
    // followed blew up, and "listed, no snapshot" would read as a quiet
    // upstream gap rather than an outage. A chain that failed knows nothing
    // reportable about its products.
    current = makeClient({ snapshotMarkets: [] })
    const boom = current.client.query
    current.client.query = (doc: unknown, vars: Record<string, unknown>) => {
      if (doc === MARKET_HOURLY_ACCOUNTING) throw new Error('gateway timeout')
      return boom.call(current.client, doc, vars)
    }

    const result = await run({ productIds: [pid(MARKET_A, 'supply')] })

    expect(reasonFor(result, pid(MARKET_A, 'supply'))).toMatch(/cannot tell/i)
  })
})
