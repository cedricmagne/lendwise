import type { Address } from 'viem'

import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import { toNumber } from '@/lib/utils'
import { BorrowPosition, SupplyPosition } from '@/types'

import { AAVE_V3_API_URL, AAVE_V3_CHAINS } from './config'
import {
  MarketsQuery,
  UserBorrowPositionsQuery,
  UserMarketHealthFactorQuery,
  UserSupplyCollateralsQuery,
  UserSupplyPositionsQuery,
} from './generated/graphql'
import {
  ALL_MARKETS,
  USER_BORROW_POSITIONS,
  USER_LEND_COLLATERALS,
  USER_MARKET_HEALTH_FACTOR,
  USER_SUPPLY_POSITIONS,
} from './queries'
import { getNetworkName } from './utils'

export const client = createGraphQLClient(AAVE_V3_API_URL)

async function getMarketsParams(chainIds?: string[]) {
  const markets = await getAllAvailableMarkets(chainIds)
  return markets.map((market) => ({
    chainId: market.chain.chainId,
    address: market.address,
  }))
}

async function getAllAvailableMarkets(chainIds?: string[]) {
  const { data, error } = await client
    .query<MarketsQuery>(ALL_MARKETS, {
      request: {
        chainIds: chainIds ?? Object.keys(AAVE_V3_CHAINS),
      },
    })
    .toPromise()

  if (error) {
    console.error('Failed to fetch Aave V3 markets:', error.message)
    // Check if it's a timeout error
    if (error.message?.includes('Time-out') || error.networkError) {
      console.warn('Aave V3 API timeout - returning empty markets')
    }
    return []
  }

  if (!data || !data.markets) {
    return []
  }

  return data.markets
}

export async function getUserSupplyPositions({
  addresses,
}: {
  addresses: Address[]
}): Promise<SupplyPosition[]> {
  if (!addresses || addresses.length === 0) {
    return []
  }

  try {
    const marketsParams = await getMarketsParams()
    const supplyingPositionsResults = await Promise.all(
      addresses.map(async (address) => {
        const { data, error } = await client
          .query<UserSupplyPositionsQuery>(USER_SUPPLY_POSITIONS, {
            request: {
              collateralsOnly: false,
              user: address,
              markets: marketsParams,
              orderBy: {
                apy: 'DESC',
              },
            },
          })
          .toPromise()

        if (error) {
          console.error('Failed to fetch Aave V3 positions:', error.message)
          // Check if it's a timeout error
          if (error.message?.includes('Time-out') || error.networkError) {
            console.warn('Aave V3 API timeout - returning empty positions')
          }
          return []
        }

        if (!data || !data.userSupplies) {
          return []
        }

        return data.userSupplies
          .filter((position) => {
            // Only include supply positions (positive balance)
            const balance = BigInt(position.balance.amount.raw)
            return balance > 0n
          })
          .map((position): SupplyPosition => ({
            id: address,
            protocol: 'aave_v3',
            network: position.market.chain.name.toLowerCase(),
            userAddress: address.toLowerCase() as Address,
            poolName: position.market.name,
            poolAddress: position.market.address,
            poolId: position.market.address,
            poolChainId: position.market.chain.chainId,
            assetAddress: position.currency.address,
            assetName: position.currency.name,
            assetSymbol: position.currency.symbol,
            assetDecimals: position.currency.decimals,
            assetAmount: position.balance.amount.raw.toString(),
            assetAmountUsd: toNumber(position.balance.usd),
            assetLiveAmountUsd: toNumber(position.balance.usd),
            apy: toNumber(position.apy.formatted),
            link: `https://app.aave.com/reserve-overview/?underlyingAsset=${position.currency.address.toLowerCase()}&marketName=proto_${position.market.chain.name.toLowerCase()}_v3`,
          }))
      })
    )

    return supplyingPositionsResults.flat()
  } catch (err) {
    console.error('Unexpected error fetching Aave V3 positions:', err)
    return []
  }
}

export async function getUserBorrowPositions({
  addresses,
}: {
  addresses: Address[]
}): Promise<BorrowPosition[]> {
  if (!addresses || addresses.length === 0) {
    return []
  }
  try {
    const marketsParams = await getMarketsParams()
    const borrowPositionsResults = await Promise.all(
      addresses.map(async (address) => {
        const healthFactorKeys = new Set<string>()
        const healthFactorMapParams = new Map<string, number>()

        const { data, error } = await client
          .query<UserBorrowPositionsQuery>(USER_BORROW_POSITIONS, {
            request: {
              user: address,
              markets: marketsParams,
              orderBy: {
                apy: 'DESC',
              },
            },
          })
          .toPromise()

        if (error) {
          console.error('Failed to fetch Aave V3 positions:', error.message)
          if (error.message?.includes('Time-out') || error.networkError) {
            console.warn('Aave V3 API timeout - returning empty positions')
          }
          return []
        }

        if (!data || !data.userBorrows || !data.userBorrows.length) {
          return []
        }

        data.userBorrows.forEach((position) => {
          healthFactorKeys.add(
            `${address}-${position.market.address}-${position.market.chain.chainId}`
          )
        })

        await Promise.all(
          Array.from(healthFactorKeys).map(async (key) => {
            if (healthFactorMapParams.has(key)) {
              return
            }
            const [user, market, chainId] = key.split('-')
            const request = {
              user: user.toLowerCase(),
              chainId: Number(chainId),
              market: market.toLowerCase(),
            }
            const { data, error } = await client
              .query<UserMarketHealthFactorQuery>(USER_MARKET_HEALTH_FACTOR, {
                request,
              })
              .toPromise()

            if (error) {
              console.error(
                'Failed to fetch health factor for request:',
                request,
                error.message
              )
              if (error.message?.includes('Time-out') || error.networkError) {
                console.warn('Aave V3 API timeout - returning empty positions')
              }
              return
            }

            healthFactorMapParams.set(
              key,
              data?.userMarketState?.healthFactor ?? 0
            )
          })
        )

        const { data: collateralsData, error: collateralsError } = await client
          .query<UserSupplyCollateralsQuery>(USER_LEND_COLLATERALS, {
            request: {
              collateralsOnly: true,
              user: address,
              markets: await getMarketsParams(
                data?.userBorrows.map(
                  (position) => position.market.chain.chainId
                )
              ),
              orderBy: {
                apy: 'DESC',
              },
            },
          })
          .toPromise()

        if (collateralsError) {
          console.error(
            'Failed to fetch Aave V3 positions:',
            collateralsError.message
          )
          if (
            collateralsError.message?.includes('Time-out') ||
            collateralsError.networkError
          ) {
            console.warn('Aave V3 API timeout - returning empty positions')
          }
          return []
        }

        const markets_collaterals: Record<
          string,
          BorrowPosition['collaterals']
        > = {}
        const seen_collaterals = new Set<string>()

        collateralsData?.userSupplies?.forEach((position) => {
          const marketKey = `${position.market.chain.chainId}-${position.market.address}`
          const collateralKey = `${marketKey}-${position.currency.address}-${position.currency.symbol}`

          if (!position.isCollateral) {
            return
          }

          if (seen_collaterals.has(collateralKey)) {
            return
          }
          seen_collaterals.add(collateralKey)

          if (!markets_collaterals[marketKey]) {
            markets_collaterals[marketKey] = []
          }

          markets_collaterals[marketKey].push({
            address: position.currency.address,
            name: position.currency.name,
            symbol: position.currency.symbol,
            decimals: position.currency.decimals,
            amount: Number(position.balance.amount.value),
            amountUsd: Number(position.balance.usd),
          })
        })

        return data.userBorrows.map((position): BorrowPosition => ({
          id: address,
          protocol: 'aave_v3',
          network: getNetworkName(position.market.chain.name),
          healthFactor:
            healthFactorMapParams.get(
              `${address}-${position.market.address}-${position.market.chain.chainId}`
            ) ?? 0,
          userAddress: address.toLowerCase() as Address,
          poolId: position.market.address,
          poolName: position.market.name,
          poolAddress: position.market.address,
          poolChainId: position.market.chain.chainId,
          loanAssetAddress: position.currency.address,
          loanAssetName: position.currency.name,
          loanAssetSymbol: position.currency.symbol,
          loanAssetDecimals: position.currency.decimals,
          loanAssetAmount: position.debt.amount.value,
          loanAssetAmountUsd: toNumber(position.debt.usd),
          loanLiveAssetAmountUsd: toNumber(position.debt.usd),
          loanTimestamp: 0,
          collaterals:
            markets_collaterals[
              `${position.market.chain.chainId}-${position.market.address}`
            ],
          apy: toNumber(position.apy.formatted),
          link: `https://app.aave.com/reserve-overview/?underlyingAsset=${position.currency.address.toLowerCase()}&marketName=proto_${position.market.chain.name.toLowerCase()}_v3`,
        }))
      })
    )
    return borrowPositionsResults.flat()
  } catch (err) {
    console.error('Unexpected error fetching Aave V3 positions:', err)
    return []
  }
}
