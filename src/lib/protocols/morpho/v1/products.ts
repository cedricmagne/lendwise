import type { BorrowProduct, SupplyProduct } from '@/lib/db/types'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import type { FetchOpts } from '@/lib/protocols/core/types'
import type {
  ListSupplyProductsQuery,
  MarketsApyQuery,
} from '@/lib/protocols/morpho/v1/generated/graphql'
import {
  LIST_SUPPLY_PRODUCTS,
  MARKETS_APY,
} from '@/lib/protocols/morpho/v1/queries'

import { MORPHO_PROVIDER } from '../common/config'
import { MORPHO_V1_API_URL, MORPHO_V1_CHAINS } from './config'
import { morphoMarketWhere, morphoVaultWhere } from './listing'
import type { MetaMorphoSupplyMeta, MorphoBlueBorrowMeta } from './types'
import { buildProductId } from './utils'

/**
 * Fetch static pool metadata for all active Morpho Blue markets.
 * Returns SupplyPool and BorrowPool objects.
 *
 * One market → two objects (supply + borrow).
 * Called by the daily pools sync job.
 */
export async function fetchMorphoV1Products(
  opts?: FetchOpts
): Promise<(SupplyProduct | BorrowProduct)[]> {
  const client = createGraphQLClient(MORPHO_V1_API_URL)

  let chainIds = Object.keys(MORPHO_V1_CHAINS).map(Number)
  const filterChainIds = opts?.chainIds
  if (filterChainIds?.length) {
    chainIds = chainIds.filter((id) => filterChainIds.includes(id))
  }

  const products: (SupplyProduct | BorrowProduct)[] = []
  let borrowProductsCount = 0
  let vaultProductsCount = 0

  let skip = 0
  let hasMore = true
  while (hasMore) {
    const { data, error } = await client
      .query<MarketsApyQuery>(MARKETS_APY, {
        first: 100,
        skip,
        where: morphoMarketWhere(chainIds),
      })
      .toPromise()

    if (error) {
      console.error(
        '[products:morpho:markets] Failed to fetch markets:',
        error.message
      )
      break
    }

    if (!data?.markets?.items?.length) break

    const now = new Date()

    for (const market of data.markets.items) {
      const chain = {
        id: market.loanAsset.chain.id,
        name: market.loanAsset.chain.network.toLowerCase(),
      }

      const asset = {
        symbol: market.loanAsset.symbol,
        name: market.loanAsset.name,
        address: market.loanAsset.address,
        decimals: market.loanAsset.decimals,
      }

      const borrowId = buildProductId(
        market.loanAsset.chain.id,
        market.marketId,
        'borrow'
      )

      // ─── Borrow product ────────────────────────────────────────────────────────
      const collateral = market.collateralAsset
      const lltv =
        market.lltv != null
          ? Number(market.lltv) / 1e18 // lltv is a BigInt scaled by 1e18
          : 0

      const borrowProduct: BorrowProduct<MorphoBlueBorrowMeta> = {
        _id: borrowId,
        kind: 'borrow',
        protocol: {
          provider: MORPHO_PROVIDER,
          type: 'market',
          version: 'v1',
          name: 'morphoblue', // display name — kept stable despite unified `morpho:` id prefix
          subgraphUrl: MORPHO_V1_API_URL,
          chain,
          address: market.morphoBlue.address,
          meta: {
            id: market.marketId,
            lltv,
          },
        },
        asset,
        collaterals: collateral
          ? [
              {
                symbol: collateral.symbol,
                name: collateral.name,
                address: collateral.address,
                decimals: collateral.decimals,
                ltv: null, // Morpho only exposes lltv
                lltv,
                canBeCollateral: true,
              },
            ]
          : [],
        active: true,
        createdAt: now,
        updatedAt: now,
      }

      products.push(borrowProduct)
      borrowProductsCount++
    }

    const pageInfo = data.markets.pageInfo
    if (pageInfo && pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  skip = 0
  hasMore = true
  while (hasMore) {
    const { data, error } = await client
      .query<ListSupplyProductsQuery>(LIST_SUPPLY_PRODUCTS, {
        first: 100,
        skip,
        where: morphoVaultWhere(chainIds),
      })
      .toPromise()

    if (error) {
      console.error(
        '[products:morpho:vaults] Failed to fetch vaults:',
        error.message
      )
      break
    }

    if (!data?.vaults?.items?.length) break

    const now = new Date()
    for (const vault of data.vaults.items) {
      const chain = {
        id: vault.asset.chain.id,
        name: vault.asset.chain.network.toLowerCase(),
      }

      const asset = {
        symbol: vault.asset.symbol,
        name: vault.asset.name,
        address: vault.asset.address,
        decimals: vault.asset.decimals,
      }

      const curators = vault.state?.curators.map((e) => e.name) || []
      const supplyId = buildProductId(
        vault.asset.chain.id,
        vault.address,
        'supply'
      )

      // ─── Supply product ──────────────────────────────────────────────────────────
      const supplyProduct: SupplyProduct<MetaMorphoSupplyMeta> = {
        _id: supplyId,
        kind: 'supply',
        protocol: {
          provider: MORPHO_PROVIDER,
          version: 'v1',
          type: 'vault',
          name: `MorphoBlueV1${vault.asset.chain.network.replace(' ', '')}`,
          subgraphUrl: MORPHO_V1_API_URL,
          chain,
          address: vault.address,
          meta: {
            id: vault.address,
            address: vault.address,
            name: vault.name,
            symbol: vault.symbol,
            curators,
          },
        },
        asset,
        active: true,
        createdAt: now,
        updatedAt: now,
      }
      products.push(supplyProduct)
      vaultProductsCount++
    }

    const pageInfo = data.vaults.pageInfo
    if (pageInfo && pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  console.log(`[pools:morpho] Fetched ${products.length} product documents`)
  console.log(
    `[pools:morpho] Breakdown: ${borrowProductsCount} borrow markets + ${vaultProductsCount} vault supplies`
  )
  return products
}
