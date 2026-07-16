import { cache } from 'react'

import { toNumber } from '@/lib/utils'
import { BorrowProduct } from '@/types'

import { AAVE_V3_CHAINS } from './config'
import { ListBorrowProductsQuery } from './generated/graphql'
import { listsBorrow } from './listing'
import { client } from './positions'
import { LIST_BORROW_PRODUCTS } from './queries'
import { buildProductNetworkSlug, getNetworkName } from './utils'

// CPU-heavy transformation memoized
const _formatBorrowProducts = cache(
  (markets: ListBorrowProductsQuery['markets']): BorrowProduct[] =>
    markets.flatMap((market) => {
      const collateralReserves = market.reserves
        .filter((r) => r.supplyInfo?.canBeCollateral === true)
        .map((r) => ({
          address: r.underlyingToken.address,
          symbol: r.underlyingToken.symbol,
          name: r.underlyingToken.name,
          decimals: r.underlyingToken.decimals,
          // PercentValue.value is already a fraction (0–1), like apy.
          ltv: Number(r.supplyInfo?.maxLTV?.value ?? 0),
          lltv: Number(r.supplyInfo?.liquidationThreshold?.value ?? 0),
        }))

      return (
        market.reserves
          // The shared listing rule. This used `!== 'DISABLED'`, which is NOT the
          // same predicate the catalogue used (`=== 'ENABLED'`): the enum has a third
          // value, USER_EMODE_DISABLED_BORROW, that a `!==` test lets through. The
          // /borrow page could therefore list a market the pipeline never collects.
          .filter(listsBorrow)
          .map((reserve): BorrowProduct => {
            return {
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
              assetAmount: reserve.size.amount.raw.toString(),
              assetAmountUsd: toNumber(reserve.size.usd),
              liquidityAmount: String(
                (reserve.supplyInfo.total.raw ?? 0) -
                  (reserve.borrowInfo?.total?.amount?.raw ?? 0)
              ),
              liquidityAmountUsd:
                toNumber(reserve.size.usd) -
                toNumber(reserve.borrowInfo?.total?.usd ?? 0),
              collaterals: collateralReserves,
              apy: toNumber(reserve.borrowInfo?.apy.value),
              productId: `aave:v3:${buildProductNetworkSlug(market.name)}:reserve:${reserve.underlyingToken.address.toLowerCase()}:borrow`,
              link: `https://app.aave.com/reserve-overview/?underlyingAsset=${reserve.underlyingToken.address.toLowerCase()}&marketName=proto_${market.chain.name.toLowerCase()}_v3`,
            }
          })
      )
    })
)

export async function getBorrowProducts(): Promise<BorrowProduct[]> {
  const { data, error } = await client
    .query<ListBorrowProductsQuery>(LIST_BORROW_PRODUCTS, {
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

  return data?.markets ? _formatBorrowProducts(data.markets) : []
}
