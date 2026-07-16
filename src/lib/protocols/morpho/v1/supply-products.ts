import {
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
} from '@/lib/protocols/core/toolkit'
import { generateSlug } from '@/lib/utils'
import { SupplyProduct } from '@/types'

import { MORPHO_V1_CHAINS } from './config'
import { ListSupplyProductsQuery } from './generated/graphql'
import { client } from './positions'
import { LIST_SUPPLY_PRODUCTS } from './queries'
import { buildProductId } from './utils'

export async function getSupplyProducts(): Promise<SupplyProduct[]> {
  const allMarkets: SupplyProduct[] = []
  let skip = 0
  let hasMore = true

  try {
    while (hasMore) {
      const { data, error } = await client
        .query<ListSupplyProductsQuery>(LIST_SUPPLY_PRODUCTS, {
          first: 100,
          skip,
          // No TVL floor here. It used to be `totalAssetsUsd_gte: 100000` — a
          // DISPLAY rule buried in a fetch, which meant this page and the public
          // API applied different ones and disagreed about which pools exist. The
          // floor now lives in lib/display-eligibility, applied on the read side,
          // to every surface at once.
          where: {
            listed: true,
            chainId_in: Object.keys(MORPHO_V1_CHAINS).map((key) => Number(key)),
          },
        })
        .toPromise()

      if (error) {
        console.error(`Failed to fetch Morpho V1 supplying markets:`, error)
        if (error.message?.includes('Time-out') || error.networkError) {
          console.warn(`Morpho V1 API timeout - returning empty markets`)
        }
        return allMarkets // Return what we have so far
      }

      if (!data || !data.vaults || !data.vaults.items) {
        break
      }

      const markets = data.vaults.items.map((vault): SupplyProduct => {
        const network =
          CHAIN_SLUG_MAP[vault.asset.chain.id as RegisteredChainId]
        if (!network)
          throw new Error(
            `No slug registered for chainId ${vault.asset.chain.id} — add it to chain-slugs.ts`
          )
        return {
          protocol: 'morpho_v1',
          network,
          poolName: vault.name,
          poolId: vault.address,
          poolAddress: vault.address,
          poolChainId: vault.asset.chain.id,
          assetAddress: vault.asset.address,
          assetName: vault.asset.name,
          assetSymbol: vault.asset.symbol,
          assetDecimals: vault.asset.decimals,
          assetAmount: (vault.state?.totalAssets ?? 0).toString(),
          assetAmountUsd: vault.state?.totalAssetsUsd ?? 0,
          assetPriceUsd: vault.asset.price?.usd ?? 0,
          liquidityAmount: (vault.liquidity?.underlying ?? 0).toString(),
          liquidityAmountUsd: vault.liquidity?.usd ?? 0,
          apy: vault?.state?.avgNetApy ?? 0,
          productId: buildProductId(
            vault.asset.chain.id,
            vault.address,
            'supply'
          ),
          link: `https://app.morpho.org/${vault.asset.chain.network.toLowerCase()}/vault/${vault.address}/${generateSlug(vault.name)}`,
        }
      })

      allMarkets.push(...markets)

      const pageInfo = data.vaults.pageInfo
      if (pageInfo && pageInfo.countTotal > skip + pageInfo.count) {
        skip += pageInfo.count
      } else {
        hasMore = false
      }
    }

    return allMarkets
  } catch (err) {
    console.error('Unexpected error fetching Morpho V1 supplying markets:', err)
    return []
  }
}
