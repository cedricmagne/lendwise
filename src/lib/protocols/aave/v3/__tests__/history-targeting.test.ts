import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APY_HISTORY,
  MARKETS_WITH_TOKENS,
} from '@/lib/protocols/aave/v3/queries'

/**
 * Targeting tests for Aave's history adapter.
 *
 * Aave lists its reserves in ONE cheap query, then fans out over every reserve.
 * That fan-out is what earned `Too Many Requests` on 2026-07-24: repairing 216
 * reserves fetched all ~1000, and the API cut off the tail of the batch —
 * silently, since a per-reserve failure was a `log()` and a `return null`. The
 * reserves at the end of the list (metis, celo, scroll, ink, plasma) got no
 * refetch at all and were filled by copying neighbouring hours.
 *
 * One reserve carries BOTH sides: a single APY_HISTORY query returns supply and
 * borrow together, so asking for either side must fetch the reserve exactly once.
 */

const TOKEN_A = '0xaaaa000000000000000000000000000000000001'
const TOKEN_B = '0xbbbb000000000000000000000000000000000002'
const TOKEN_C = '0xcccc000000000000000000000000000000000000003'

const MARKET = {
  address: '0xmarket',
  name: 'AaveV3Ethereum',
  chain: { name: 'Ethereum', chainId: 1 },
}

const DATE = '2026-07-20T00:00:00.000Z'

function makeClient() {
  const calls: { doc: unknown; vars: Record<string, unknown> }[] = []

  const client = {
    query(doc: unknown, vars: Record<string, unknown>) {
      calls.push({ doc, vars })
      return {
        toPromise: async () => {
          if (doc === MARKETS_WITH_TOKENS) {
            return {
              data: {
                markets: [
                  {
                    ...MARKET,
                    reserves: [TOKEN_A, TOKEN_B, TOKEN_C].map((address) => ({
                      underlyingToken: { address, symbol: 'TKN' },
                    })),
                  },
                ],
              },
              error: undefined,
            }
          }
          if (doc === APY_HISTORY) {
            return {
              data: {
                supplyAPYHistory: [{ date: DATE, avgRate: { value: 0.05 } }],
                borrowAPYHistory: [{ date: DATE, avgRate: { value: 0.09 } }],
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

const historyCalls = () => current.calls.filter((c) => c.doc === APY_HISTORY)

const fetchedTokens = () =>
  historyCalls().map(
    (c) =>
      (c.vars.supplyRequest as { underlyingToken: string } | undefined)
        ?.underlyingToken
  )

const pid = (token: string, kind: 'supply' | 'borrow') =>
  `aave:v3:ethereum:reserve:${token}:${kind}`

async function run(params: Record<string, unknown>) {
  const { getAaveApyHistory } =
    await import('@/lib/protocols/aave/v3/apy-history')
  // interval HOUR keeps the subgraph market-state merge out of the way; it is
  // gated on DAY and tested separately in market-merge.test.ts.
  return getAaveApyHistory({
    startTimestamp: Math.floor(Date.parse(DATE) / 1000) - 86_400,
    endTimestamp: Math.floor(Date.parse(DATE) / 1000) + 86_400,
    interval: 'HOUR',
    onProgress: () => {},
    ...params,
  } as Parameters<typeof getAaveApyHistory>[0])
}

beforeEach(() => {
  current = makeClient()
})

describe('getAaveApyHistory — productIds targeting', () => {
  it('fetches only the reserves whose products were requested', async () => {
    await run({ productIds: [pid(TOKEN_A, 'supply')] })

    expect(historyCalls()).toHaveLength(1)
    expect(fetchedTokens()).toEqual([TOKEN_A])
  })

  it('fetches a reserve once when both its sides are requested', async () => {
    await run({
      productIds: [pid(TOKEN_A, 'supply'), pid(TOKEN_A, 'borrow')],
    })

    expect(historyCalls()).toHaveLength(1)
  })

  it('does not return the other side of a reserve fetched for one side', async () => {
    const result = await run({ productIds: [pid(TOKEN_A, 'supply')] })
    const { points } = result as { points: { productId: string }[] }

    expect([...new Set(points.map((p) => p.productId))]).toEqual([
      pid(TOKEN_A, 'supply'),
    ])
  })

  it('reaches a reserve requested by its borrow side alone', async () => {
    await run({ productIds: [pid(TOKEN_B, 'borrow')] })

    expect(fetchedTokens()).toEqual([TOKEN_B])
  })

  it('reports a requested product no market carries', async () => {
    const result = await run({
      productIds: [pid(TOKEN_A, 'supply'), pid('0xdead', 'supply')],
    })

    const { failures } = result as { failures: { productId: string }[] }
    expect(failures.map((f) => f.productId)).toEqual([pid('0xdead', 'supply')])
  })

  it('without productIds, fans out over every reserve', async () => {
    await run({})

    expect(historyCalls()).toHaveLength(3)
  })
})
