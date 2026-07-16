import { cache } from 'react'

import { toNumber } from '@/lib/utils'
import { SupplyProduct } from '@/types'

import { AAVE_V3_CHAINS } from './config'
import { ListSupplyProductsQuery } from './generated/graphql'
import { client } from './positions'
import { LIST_SUPPLY_PRODUCTS } from './queries'
import { buildProductNetworkSlug, getNetworkName } from './utils'

// CPU-heavy transformation memoized
const _formatSupplyProducts = cache(
  (markets: ListSupplyProductsQuery['markets']): SupplyProduct[] =>
    markets.flatMap((market) =>
      market.reserves.map(
        (reserve): SupplyProduct => ({
          protocol: 'aave_v3',
          network: getNetworkName(market.name),
          poolName: reserve.underlyingToken.name,
          poolId: market.address,
          poolAddress: market.address,
          poolChainId: market.chain.chainId,
          assetAddress: reserve.underlyingToken.address,
          assetName: reserve.underlyingToken.name,
          assetSymbol: reserve.underlyingToken.symbol,
          assetDecimals: reserve.underlyingToken.decimals,
          assetAmount: String(reserve.supplyInfo.total.raw ?? 0),
          assetAmountUsd: toNumber(reserve.size.usd),
          liquidityAmount: String(
            (reserve.supplyInfo.total.raw ?? 0) -
              (reserve.borrowInfo?.total?.amount?.raw ?? 0)
          ),
          liquidityAmountUsd:
            toNumber(reserve.size.usd) -
            toNumber(reserve.borrowInfo?.total?.usd ?? 0),
          apy: toNumber(reserve.supplyInfo.apy.value),
          productId: `aave:v3:${buildProductNetworkSlug(market.name)}:reserve:${reserve.underlyingToken.address.toLowerCase()}:supply`,
          link: `https://app.aave.com/reserve-overview/?underlyingAsset=${reserve.underlyingToken.address.toLowerCase()}&marketName=proto_${market.chain.name.toLowerCase()}_v3`,
        })
      )
    )
)

export async function getSupplyProducts(): Promise<SupplyProduct[]> {
  const { data, error } = await client
    .query<ListSupplyProductsQuery>(LIST_SUPPLY_PRODUCTS, {
      request: {
        chainIds: Object.keys(AAVE_V3_CHAINS).map(Number),
      },
    })
    .toPromise()

  if (error) {
    console.error('Aave V3 GraphQL fetch error:', error)
    if (error.message?.includes('Time-out') || error.networkError) {
      console.warn('Timeout → returning empty array')
      return []
    }
    throw error
  }

  return data?.markets ? _formatSupplyProducts(data.markets) : []
}
