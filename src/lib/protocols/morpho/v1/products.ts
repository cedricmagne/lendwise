import type { BorrowProduct, SupplyProduct } from '@/lib/db/types'
import { MORPHO_CONFIG } from '@/lib/protocols/morpho/config'
import type {
  ListSupplyProductsQuery,
  MarketsApyQuery,
} from '@/lib/protocols/morpho/v1/offchain/generated/graphql'
import {
  LIST_SUPPLY_PRODUCTS,
  MARKETS_APY,
} from '@/lib/protocols/morpho/v1/offchain/queries'
import { createGraphQLClient } from '@/lib/protocols/shared'

import { morphoMarketWhere, morphoVaultWhere } from './listing'
import { buildProductId } from './utils'

/**
 * Fetch static pool metadata for all active Morpho Blue markets.
 * Returns SupplyPool and BorrowPool documents ready for MongoDB upsert.
 *
 * One market → two documents (supply + borrow).
 * Called by the daily pools sync job.
 */
export async function fetchMorphoV1Products(
  chainFilter?: string
): Promise<(SupplyProduct | BorrowProduct)[]> {
  const config = MORPHO_CONFIG.morpho_v1
  const client = createGraphQLClient(config.offchainApiUrl || '')

  let chainIds = Object.keys(config.chains).map(Number)

  if (chainFilter) {
    const found = Object.entries(config.chains).find(
      ([, c]) => c.name.toLowerCase() === chainFilter.toLowerCase()
    )
    if (!found) {
      console.warn(
        `[pools:morpho] Chain filter '${chainFilter}' not found in config`
      )
      return []
    }
    chainIds = [Number(found[0])]
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

      const borrowProduct: BorrowProduct = {
        _id: borrowId,
        kind: 'borrow',
        protocol: {
          provider: 'morpho',
          type: 'market',
          version: 'v1',
          name: 'morphoblue', // display name — kept stable despite unified `morpho:` id prefix
          subgraphUrl: config.offchainApiUrl || '',
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
      const supplyProduct: SupplyProduct = {
        _id: supplyId,
        kind: 'supply',
        protocol: {
          provider: 'morpho',
          version: 'v1',
          type: 'vault',
          name: `MorphoBlueV1${vault.asset.chain.network.replace(' ', '')}`,
          subgraphUrl: config.offchainApiUrl || '',
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
