import type { BorrowProduct, SupplyProduct } from '@/lib/db/types'
import type { MarketsAllQuery } from '@/lib/protocols/compound/v3/generated/graphql'
import { MARKETS_ALL } from '@/lib/protocols/compound/v3/queries'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import type { FetchOpts } from '@/lib/protocols/core/types'

import { COMPOUND_PROVIDER } from '../common/config'
import { COMPOUND_V3_CHAINS } from './config'
import type { CompoundMarketMeta } from './types'
import { buildProductId } from './utils'

/**
 * Fetch static pool metadata for all active Compound v3 markets.
 * Returns SupplyPool and BorrowPool objects.
 *
 * One market → two objects (supply + borrow).
 * Borrow pool collaterals are built from the market itself (Compound V3 is single-collateral).
 *
 * Uses Compound V3 subgraph to fetch market data.
 */
export async function fetchCompoundV3Products(
  opts?: FetchOpts
): Promise<(SupplyProduct | BorrowProduct)[]> {
  let chainIds = Object.keys(COMPOUND_V3_CHAINS).map(Number)
  const filterChainIds = opts?.chainIds
  if (filterChainIds?.length) {
    chainIds = chainIds.filter((id) => filterChainIds.includes(id))
  }

  const products: (SupplyProduct | BorrowProduct)[] = []
  const now = new Date()

  // Fetch markets for each chain separately since Compound uses separate subgraphs per chain
  for (const chainId of chainIds) {
    const chainConfig = COMPOUND_V3_CHAINS[chainId]
    if (!chainConfig?.custom.subgraphUrl) {
      console.warn(`[products:compound] No subgraph URL for chain ${chainId}`)
      continue
    }

    // Create GraphQL client with proper API key for TheGraph
    const chainClient = createGraphQLClient(
      chainConfig.custom.subgraphUrl,
      process.env.THEGRAPH_API_KEY
    )

    const { data, error } = await chainClient
      .query<MarketsAllQuery>(MARKETS_ALL, {})
      .toPromise()

    if (error) {
      console.error(
        `[products:compound] Failed to fetch markets for chain ${chainId}:`,
        error.message
      )
      continue
    }

    if (!data?.markets?.length) continue

    const chain = {
      id: chainId,
      name: chainConfig.name.toLowerCase(),
    }

    for (const market of data.markets) {
      const asset = {
        symbol: market.configuration.baseToken.token.symbol,
        name: market.configuration.baseToken.token.name,
        address: market.configuration.baseToken.token.address,
        decimals: market.configuration.baseToken.token.decimals || 18,
      }

      const supplyId = buildProductId(market.id, chain, 'supply')
      const borrowId = buildProductId(market.id, chain, 'borrow')
      const name =
        `CompoundV3${chainConfig.name}${market.configuration.baseToken.token.symbol}`.replaceAll(
          ' ',
          ''
        )

      // ─── Supply product ─────────────────────────────────────────────────────────────────────────

      const supplyProduct: SupplyProduct<CompoundMarketMeta> = {
        _id: supplyId,
        kind: 'supply',
        protocol: {
          provider: COMPOUND_PROVIDER,
          type: 'market',
          version: 'v3',
          name,
          subgraphUrl: chainConfig.custom.subgraphUrl ?? '',
          chain,
          address: market.id,
          meta: {
            cToken: market.id, // In Compound V3, the market contract is the equivalent of cToken
            reserveFactor: 0,
          },
        },
        asset,
        active: true,
        createdAt: now,
        updatedAt: now,
      }

      products.push(supplyProduct)

      // ─── Borrow product ─────────────────────────────────────────────────────────────────────────
      const borrowProduct: BorrowProduct<CompoundMarketMeta> = {
        _id: borrowId,
        kind: 'borrow',
        protocol: {
          provider: COMPOUND_PROVIDER,
          type: 'market',
          version: 'v3',
          name,
          subgraphUrl: chainConfig.custom.subgraphUrl ?? '',
          chain,
          address: market.id,
          meta: {
            cToken: market.id,
            reserveFactor: 0, // Default to 0 since reserveFactor not available
          },
        },
        asset,
        collaterals: market.configuration.collateralTokens.map((r) => ({
          symbol: r.token.symbol,
          name: r.token.name,
          address: r.token.address,
          decimals: r.token.decimals || 18,
          ltv: Number(r.borrowCollateralFactor),
          lltv: Number(r.liquidateCollateralFactor),
          canBeCollateral: true,
        })),
        active: true,
        createdAt: now,
        updatedAt: now,
      }

      products.push(borrowProduct)
    }
  }

  console.log(
    `[products:compound] Fetched ${products.length} product documents`
  )
  console.log(
    `[products:compound] Breakdown: ${products.filter((p) => p.kind === 'borrow').length} borrow markets + ${products.filter((p) => p.kind === 'supply').length} supply markets`
  )
  return products
}
