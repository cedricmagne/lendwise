import { cache } from 'react'

import { CHAIN_NAME_MAPPING } from '@/lib/protocols/utils'
import { aprToApyPerSecond, toNumber } from '@/lib/utils'
import { BorrowProduct } from '@/types'

import { getChainClients } from '.'
import { COMPOUND_CONFIG } from '../../config'
import { SLUG_MAPPING, buildProductId } from '../utils'
import { ListBorrowProductsQuery } from './generated/graphql'
import { LIST_BORROW_PRODUCTS } from './queries'

// CPU-heavy transformation memoized
const _formatBorrowProducts = cache(
  (
    markets: ListBorrowProductsQuery['markets'],
    chainName: string,
    chainId: number
  ): BorrowProduct[] => {
    const network = CHAIN_NAME_MAPPING[chainId]
    if (!network)
      throw new Error(
        `No slug registered for chainId ${chainId} — add it to chain-slugs.ts`
      )
    return markets.map((market) => {
      const token = market.configuration.baseToken.token
      const totalSupply = BigInt(market.accounting.totalBaseSupply)
      return {
        protocol: COMPOUND_CONFIG.compound_v3.id,
        network,
        poolName: token.name,
        poolId: market.id,
        poolAddress: market.id,
        poolChainId: chainId,
        assetAddress: token.address,
        assetName: token.name,
        assetSymbol: token.symbol,
        assetDecimals: token.decimals || 18,
        assetAmount: totalSupply.toString(),
        assetAmountUsd: toNumber(market.accounting.totalBaseSupplyUsd),
        liquidityAmount: String(
          BigInt(market.accounting.totalBaseSupply) -
            BigInt(market.accounting.totalBaseBorrow)
        ),
        liquidityAmountUsd:
          toNumber(market.accounting.totalBaseSupplyUsd) -
          toNumber(market.accounting.totalBaseBorrowUsd),
        collaterals: market.configuration.collateralTokens.map((ct) => ({
          address: ct.token.address,
          symbol: ct.token.symbol,
          name: ct.token.name,
          decimals: ct.token.decimals || 18,
          // Compound factors are already fractions (0–1).
          ltv: Number(ct.borrowCollateralFactor),
          lltv: Number(ct.liquidateCollateralFactor),
        })),
        apy: aprToApyPerSecond(toNumber(market.accounting.netBorrowApr)),
        productId: buildProductId(
          market.id,
          { id: chainId, name: chainName! },
          'borrow'
        ),
        link: `https://app.compound.finance/?market=${token.symbol.toLowerCase()}-${SLUG_MAPPING[chainId] ?? 'mainnet'}`,
      }
    })
  }
)

export async function getBorrowProducts(): Promise<BorrowProduct[]> {
  const chainClients = await getChainClients()
  const results = await Promise.allSettled(
    chainClients.map(async ({ client, chainName, chainId }) => {
      const { data, error } = await client
        .query<ListBorrowProductsQuery>(LIST_BORROW_PRODUCTS, {})
        .toPromise()

      if (error) {
        console.error('Compound V3 GraphQL fetch error:', error)
        if (error.message?.includes('Time-out') || error.networkError) {
          console.warn('Timeout → returning empty array')
          return []
        }
        throw error
      }

      return data?.markets
        ? _formatBorrowProducts(data.markets, chainName!, chainId)
        : []
    })
  )

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
}
