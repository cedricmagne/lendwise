import { cache } from 'react'

import {
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
} from '@/lib/protocols/core/toolkit'
import { BorrowProduct } from '@/types'

import { MORPHO_V1_CHAINS } from './config'
import { ListBorrowProductsQuery } from './generated/graphql'
import { client } from './positions'
import { LIST_BORROW_PRODUCTS } from './queries'
import { buildProductId } from './utils'

// CPU-heavy transformation memoized
const _formatBorrowProducts = cache(
  (markets: ListBorrowProductsQuery['markets']): BorrowProduct[] =>
    markets.items?.map((market): BorrowProduct => {
      const chainIdForMarket = market.morphoBlue.chain.id
      const networkForMarket =
        CHAIN_SLUG_MAP[chainIdForMarket as RegisteredChainId]
      if (!networkForMarket)
        throw new Error(
          `No slug registered for chainId ${chainIdForMarket} — add it to chain-slugs.ts`
        )
      const totalSupply = BigInt(market.state?.supplyAssets ?? 0)
      const totalBorrow = BigInt(market.state?.borrowAssets ?? 0)
      const available =
        totalSupply > totalBorrow ? totalSupply - totalBorrow : 0n
      const collateralSymbol = market.collateralAsset?.symbol ?? 'none'
      return {
        protocol: 'morpho_v1',
        network: networkForMarket,
        poolName: `${market.loanAsset.symbol}/${collateralSymbol}`,
        poolId: market.marketId,
        poolAddress: market.loanAsset.address,
        poolChainId: chainIdForMarket,
        assetAddress: market.loanAsset.address,
        assetName: market.loanAsset.name,
        assetSymbol: market.loanAsset.symbol,
        assetDecimals: market.loanAsset.decimals,
        assetAmount: totalSupply.toString(),
        assetAmountUsd: market.state?.supplyAssetsUsd ?? 0,
        liquidityAmount: available.toString(),
        liquidityAmountUsd: Math.max(
          0,
          (market.state?.supplyAssetsUsd ?? 0) -
            (market.state?.borrowAssetsUsd ?? 0)
        ),
        collaterals: market.collateralAsset
          ? [
              {
                address: market.collateralAsset.address,
                symbol: market.collateralAsset.symbol,
                name: market.collateralAsset.name,
                decimals: market.collateralAsset.decimals,
                // Morpho exposes only LLTV (BigInt scaled 1e18); no native max LTV.
                ltv: null,
                lltv: market.lltv != null ? Number(market.lltv) / 1e18 : null,
              },
            ]
          : [],
        apy: market.state?.netBorrowApy ?? 0,
        productId: buildProductId(
          market.morphoBlue.chain.id,
          market.marketId,
          'borrow'
        ),
        link: `https://app.morpho.org/${market.morphoBlue.chain.network.toLowerCase()}/market/${market.marketId}`,
      }
    }) || []
)

export async function getBorrowProducts(): Promise<BorrowProduct[]> {
  const allMarkets: BorrowProduct[] = []
  let skip = 0
  let hasMore = true

  try {
    while (hasMore) {
      const { data, error } = await client
        .query<ListBorrowProductsQuery>(LIST_BORROW_PRODUCTS, {
          first: 100,
          skip,
          // No TVL floor here — see supply-products.ts. The $100k is now a single
          // read-side rule in lib/display-eligibility, not a per-query one.
          where: {
            listed: true,
            chainId_in: Object.keys(MORPHO_V1_CHAINS).map((key) => Number(key)),
          },
        })
        .toPromise()

      if (error) {
        console.error(`Failed to fetch Morpho V1 borrowing markets:`, error)
        if (error.message?.includes('Time-out') || error.networkError) {
          console.warn(`Morpho V1 API timeout - returning empty markets`)
        }
        return allMarkets
      }

      if (!data || !data.markets || !data.markets.items) {
        break
      }

      allMarkets.push(..._formatBorrowProducts(data.markets))

      const pageInfo = data.markets.pageInfo
      if (pageInfo && pageInfo.countTotal > skip + pageInfo.count) {
        skip += pageInfo.count
      } else {
        hasMore = false
      }
    }

    return allMarkets
  } catch (err) {
    console.error('Unexpected error fetching Morpho V1 borrowing markets:', err)
    return []
  }
}
