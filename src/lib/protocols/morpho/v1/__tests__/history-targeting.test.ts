import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MARKETS_APY,
  MARKET_BORROW_HISTORY,
  VAULTS_APY,
  VAULT_SUPPLY_HISTORY,
} from '@/lib/protocols/morpho/v1/queries'

/**
 * Targeting tests for Morpho's history adapter.
 *
 * The point under test is NOT that the right numbers come back — it is that a
 * caller who names three products does not pay for the whole catalogue, and that
 * a product it could not answer for is reported rather than silently absent.
 * Both were missing on 2026-07-24: the fan-out cost the full catalogue every
 * time, and a market that had dipped under the ingestion floor was unreachable
 * because the refetch re-applied today's listing predicate to a past hour.
 */

// Two vaults and two markets on Ethereum. Addresses are the on-chain keys the
// adapter turns into productIds; only ONE of each is requested below.
const VAULT_A = '0xaaaa000000000000000000000000000000000001'
const VAULT_B = '0xbbbb000000000000000000000000000000000002'
const MARKET_A =
  '0xcccc000000000000000000000000000000000000000000000000000000000003'
const MARKET_B =
  '0xdddd000000000000000000000000000000000000000000000000000000000004'

const ETH_CHAIN = { id: 1, network: 'ethereum' }

function vaultItem(address: string) {
  return {
    address,
    asset: { symbol: 'USDC', decimals: 6, chain: ETH_CHAIN },
  }
}

function marketItem(marketId: string) {
  return {
    id: marketId,
    marketId,
    loanAsset: { symbol: 'USDC', decimals: 6, chain: ETH_CHAIN },
  }
}

const series = [{ x: 1_753_000_000, y: 0.05 }]

/** Records every query the adapter issues, and answers with canned data. */
function makeClient() {
  const calls: { doc: unknown; vars: Record<string, unknown> }[] = []

  const client = {
    query(doc: unknown, vars: Record<string, unknown>) {
      calls.push({ doc, vars })
      return {
        toPromise: async () => {
          if (doc === VAULTS_APY) {
            return {
              data: {
                vaults: {
                  items: [vaultItem(VAULT_A), vaultItem(VAULT_B)],
                  pageInfo: { countTotal: 2, limit: 100, skip: 0 },
                },
              },
              error: undefined,
            }
          }
          if (doc === MARKETS_APY) {
            return {
              data: {
                markets: {
                  items: [marketItem(MARKET_A), marketItem(MARKET_B)],
                  pageInfo: { countTotal: 2, limit: 100, skip: 0 },
                },
              },
              error: undefined,
            }
          }
          if (doc === VAULT_SUPPLY_HISTORY) {
            return {
              data: {
                vaultByAddress: {
                  historicalState: {
                    apy: series,
                    netApy: series,
                    fee: [],
                    totalAssetsUsd: [],
                    totalAssets: [],
                  },
                },
              },
              error: undefined,
            }
          }
          if (doc === MARKET_BORROW_HISTORY) {
            return {
              data: {
                marketById: {
                  historicalState: { borrowApy: series, netBorrowApy: series },
                },
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
  return {
    ...actual,
    createGraphQLClient: () => current.client,
  }
})

const historyCalls = () =>
  current.calls.filter(
    (c) => c.doc === VAULT_SUPPLY_HISTORY || c.doc === MARKET_BORROW_HISTORY
  )

const listingCalls = () =>
  current.calls.filter((c) => c.doc === VAULTS_APY || c.doc === MARKETS_APY)

async function run(params: Record<string, unknown>) {
  const { getMorphoApyHistory } =
    await import('@/lib/protocols/morpho/v1/apy-history')
  return getMorphoApyHistory({
    startTimestamp: 1_752_900_000,
    endTimestamp: 1_753_100_000,
    interval: 'HOUR',
    onProgress: () => {},
    ...params,
  } as Parameters<typeof getMorphoApyHistory>[0])
}

beforeEach(() => {
  current = makeClient()
})

describe('getMorphoApyHistory — productIds targeting', () => {
  it('fans out only over the requested products', async () => {
    await run({
      productIds: [
        `morpho:v1:ethereum:vault:${VAULT_A}:supply`,
        `morpho:v1:ethereum:market:${MARKET_A}:borrow`,
      ],
    })

    expect(historyCalls()).toHaveLength(2)

    const addresses = historyCalls().map(
      (c) => c.vars.address ?? c.vars.marketId
    )
    expect(addresses).toContain(VAULT_A)
    expect(addresses).toContain(MARKET_A)
    expect(addresses).not.toContain(VAULT_B)
    expect(addresses).not.toContain(MARKET_B)
  })

  it('drops the ingestion floors so a product under them stays reachable', async () => {
    await run({
      productIds: [`morpho:v1:ethereum:market:${MARKET_A}:borrow`],
    })

    for (const call of listingCalls()) {
      const where = call.vars.where as Record<string, unknown>
      expect(where).not.toHaveProperty('borrowAssetsUsd_gte')
    }
  })

  it('reaches a DELISTED market through its catalogue row', async () => {
    // Not in the listing the mock returns — only reachable by its own key.
    const DELISTED =
      '0xeeee000000000000000000000000000000000000000000000000000000000009'

    const result = await run({
      targets: [
        {
          productId: `morpho:v1:ethereum:market:${DELISTED}:borrow`,
          chainId: 1,
          kind: 'borrow',
          meta: { id: DELISTED },
        },
      ],
    })

    const { points, failures } = result as {
      points: { productId: string }[]
      failures: unknown[]
    }
    expect(failures).toHaveLength(0)
    expect(points.map((p) => p.productId)).toContain(
      `morpho:v1:ethereum:market:${DELISTED}:borrow`
    )
  })

  it('reports a requested product the catalogue does not carry', async () => {
    const result = await run({
      productIds: [
        `morpho:v1:ethereum:vault:${VAULT_A}:supply`,
        'morpho:v1:ethereum:vault:0x9999999999999999999999999999999999999999:supply',
      ],
    })

    expect('failures' in result).toBe(true)
    const { failures } = result as { failures: { productId: string }[] }
    expect(failures.map((f) => f.productId)).toEqual([
      'morpho:v1:ethereum:vault:0x9999999999999999999999999999999999999999:supply',
    ])
  })

  it('without productIds, fans out over the whole catalogue and keeps the floors', async () => {
    await run({})

    expect(historyCalls()).toHaveLength(4)

    const marketListing = listingCalls().find((c) => c.doc === MARKETS_APY)
    expect(marketListing?.vars.where).toHaveProperty(
      'borrowAssetsUsd_gte',
      10_000
    )
  })
})
