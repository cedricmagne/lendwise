import { type Address } from 'viem'

import { toNumber } from '@/lib/utils'
import {
  BorrowPosition,
  MarketRate,
  ProtocolName,
  SupplyPosition,
  TimeframeLabel,
} from '@/types'

import {
  type BaseChainClient,
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
  createChainRegistry,
  createGraphQLClient,
} from '../../core/toolkit'
import { COMPOUND_V3_CHAINS } from './config'
import type {
  Account_Filter,
  // MarketDailyBorrowRatesQuery,
  // MarketDailySupplyRatesQuery,
  // MarketHourlyBorrowRatesQuery,
  // MarketHourlySupplyRatesQuery,
  UserBorrowPositionsQuery,
  UserSupplyPositionsQuery,
} from './generated/graphql'
import {
  // MARKET_DAILY_BORROW_RATES,
  // MARKET_DAILY_LEND_RATES,
  // MARKET_HOURLY_BORROW_RATES,
  // MARKET_HOURLY_LEND_RATES,
  USER_BORROW_POSITIONS,
  USER_SUPPLY_POSITIONS,
} from './queries'
import { BASE_INDEX_SCALE, SLUG_MAPPING } from './utils'

/** Registry key = protocol_name in DB. */
const PROTOCOL_ID: ProtocolName = 'compound_v3'

// ============================================================================
// Types
// ============================================================================

/**
 * Type for chain-specific queries.
 * Allows overriding default queries for chains with different schemas.
 */
export type ChainQueries = {
  USER_SUPPLY_POSITIONS: typeof USER_SUPPLY_POSITIONS
  USER_BORROW_POSITIONS: typeof USER_BORROW_POSITIONS
}

/**
 * Type for chain-specific data transformers.
 * Allows chains with different schemas to provide custom transformation logic.
 */
export type ChainTransformers = {
  getUserSupplyPositions?: (
    data: unknown,
    protocolId: string
  ) => SupplyPosition[]
  getUserBorrowPositions?: (
    data: unknown,
    protocolId: string
  ) => BorrowPosition[]
  getMarketBorrowHistoryRates?: (
    data: unknown,
    protocolId: string
  ) => MarketRate[]
  getMarketSupplyHistoryRates?: (
    data: unknown,
    protocolId: string
  ) => MarketRate[]
}

/**
 * Compound V3 chain client configuration type.
 */
export type ChainClient = BaseChainClient<ChainQueries, ChainTransformers>

// ============================================================================
// Chain Registry
// ============================================================================

/**
 * Chain registry for Compound V3 onchain adapter.
 * Manages multi-chain subgraph clients with lazy initialization.
 */
const chainRegistry = createChainRegistry<ChainClient>(
  () => COMPOUND_V3_CHAINS,
  { protocolName: 'Compound V3' }
)

/**
 * Chain importer for dynamic imports relative to this folder.
 */
const chainImporter = (path: string) => import(`./${path}`)

/**
 * Register a chain client. Called by each chain folder during initialization.
 */
export const registerChain = chainRegistry.registerChain

/**
 * Get all registered chain clients.
 */
export const getChainClients = () =>
  chainRegistry.getChainClients(chainImporter)

/**
 * Get a specific chain client by chain ID.
 */
const _getChainClient = (chainId: number) =>
  chainRegistry.getChainClient(chainId, chainImporter)

/**
 * Re-export createSubgraphClient as createChainClient for backward compatibility
 * with existing chain folder implementations.
 */
export { createGraphQLClient as createChainClient }

function calculateHealthFactor(
  position: NonNullable<UserBorrowPositionsQuery>['accounts'][number]['positions'][number]
): number {
  const borrowBalanceUsd = Math.abs(position.accounting.baseBalanceUsd)

  // AAVE-style calculation: Σ(collateral_balance_usd × liquidationThreshold) / Σ(borrow_balance_usd)
  const collateralValueUsd =
    position.accounting.collateralBalances?.reduce(
      (
        total: number,
        collateral: NonNullable<UserBorrowPositionsQuery>['accounts'][number]['positions'][number]['accounting']['collateralBalances'][number]
      ) => {
        const collateralBalance = parseFloat(collateral.balanceUsd || '0')
        // Compound V3 uses liquidationFactor, AAVE uses liquidationThreshold - same concept
        const liquidationThreshold = parseFloat(
          collateral.collateralToken.liquidationFactor
        )
        return total + collateralBalance * liquidationThreshold
      },
      0
    ) || 0

  if (borrowBalanceUsd === 0) return Infinity // Pas d'emprunt = HF infini

  return collateralValueUsd / borrowBalanceUsd
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
    // Fetch positions from all registered chains in parallel
    const chainClients = await getChainClients()
    const results = await Promise.allSettled(
      chainClients.map(
        async ({ client, chainName, chainId, queries, transformers }) => {
          // Use chain-specific query if available, otherwise use default
          const query = queries?.USER_SUPPLY_POSITIONS || USER_SUPPLY_POSITIONS

          const { data, error } = await client
            .query<UserSupplyPositionsQuery, { where: Account_Filter }>(query, {
              where: { address_in: addresses },
            })
            .toPromise()

          if (error) {
            console.error(
              `Failed to fetch ${chainName} Compound V3 positions:`,
              error
            )
            // Check if it's a timeout error
            if (error.message?.includes('Time-out') || error.networkError) {
              console.warn(
                `${chainName} Compound V3 API timeout - returning empty positions`
              )
            }
            return [] // Return what we have so far
          }

          // Use custom transformer if provided, otherwise use default logic
          if (transformers?.getUserSupplyPositions && data) {
            return transformers.getUserSupplyPositions(data, 'compound_v3')
          }

          /**
           * If we want to calculate the live balance, we need to use the baseSupplyIndex and basePrincipal
           * from the position and calculate the live balance using the formula:
           */
          // Default transformation logic (Spencer Paperclips Labs schema)
          return (
            data?.accounts?.flatMap((account) => {
              if (!account.positions) return []
              return account.positions.map((position) => {
                const token = position.market.configuration.baseToken.token
                const positionAccounting = position.accounting
                const marketAccounting = position.market.accounting

                return {
                  id: positionAccounting.id,
                  protocol: PROTOCOL_ID,
                  network:
                    CHAIN_SLUG_MAP[chainId as RegisteredChainId] ||
                    chainName!.toLowerCase(),
                  userAddress: account.address.toLowerCase(),
                  poolName: token.name,
                  poolAddress: position.market.id,
                  poolId: position.market.id,
                  poolChainId: chainId,
                  assetAddress: token.address as Address,
                  assetName: token.name,
                  assetSymbol: token.symbol,
                  assetDecimals: token.decimals || 18,
                  assetAmount: positionAccounting.baseBalance ?? 0,
                  assetAmountUsd: parseFloat(
                    positionAccounting.baseBalanceUsd ?? '0'
                  ),
                  assetLiveAmountUsd:
                    (Math.abs(positionAccounting.basePrincipal) *
                      marketAccounting.baseSupplyIndex) /
                    BASE_INDEX_SCALE /
                    10 ** (token.decimals || 18),
                  apy: toNumber(position.market.accounting.netSupplyApr),
                  link: `https://app.compound.finance/?market=${token.symbol.toLowerCase()}-${CHAIN_SLUG_MAP[chainId as RegisteredChainId] ? SLUG_MAPPING[chainId] : 'mainnet'}`,
                }
              })
            }) ?? []
          )
        }
      )
    )

    // Aggregate results from all chains
    const allPositions = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    )

    return allPositions
  } catch (err) {
    console.error('Unexpected error fetching Compound V3 positions:', err)
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
    // Fetch positions from all registered chains in parallel
    const chainClients = await getChainClients()
    const results = await Promise.allSettled(
      chainClients.map(
        async ({ client, chainName, chainId, queries, transformers }) => {
          // Use chain-specific query if available, otherwise use default
          const query = queries?.USER_BORROW_POSITIONS || USER_BORROW_POSITIONS

          const { data, error } = await client
            .query<UserBorrowPositionsQuery, { where: Account_Filter }>(query, {
              where: { address_in: addresses },
            })
            .toPromise()

          if (error) {
            console.error(
              `Failed to fetch ${chainName} Compound V3 positions:`,
              error
            )
            // Check if it's a timeout error
            if (error.message?.includes('Time-out') || error.networkError) {
              console.warn(
                `${chainName} Compound V3 API timeout - returning empty positions`
              )
            }
            return [] // Return what we have so far
          }

          // Use custom transformer if provided, otherwise use default logic
          if (transformers?.getUserBorrowPositions && data) {
            return transformers.getUserBorrowPositions(data, 'compound_v3')
          }

          // Default transformation logic (Messari schema)
          return (
            data?.accounts?.flatMap((account) => {
              if (!account.positions) return []
              return account.positions.map((position) => {
                const token = position.market.configuration.baseToken.token
                const positionAccounting = position.accounting
                const marketAccounting = position.market.accounting

                const collaterals: BorrowPosition['collaterals'] =
                  positionAccounting.collateralBalances
                    .map((collateral) => {
                      if (!Number(collateral.balance)) return null
                      return {
                        name: collateral.collateralToken.token.name,
                        symbol: collateral.collateralToken.token.symbol,
                        decimals:
                          collateral.collateralToken.token.decimals || 18,
                        address: collateral.collateralToken.token.address,
                        amount: collateral.balance,
                        amountUsd: toNumber(collateral.balanceUsd),
                      }
                    })
                    .filter((c) => c !== null)

                return {
                  id: positionAccounting.id,
                  protocol: PROTOCOL_ID,
                  healthFactor: calculateHealthFactor(position),
                  userAddress: account.address.toLowerCase(),
                  poolId: position.market.id,
                  poolName: token.name,
                  poolAddress: position.market.id,
                  poolChainId: chainId,
                  network:
                    CHAIN_SLUG_MAP[chainId as RegisteredChainId] ||
                    chainName!.toLowerCase(),
                  loanAssetAddress: token.address,
                  loanAssetName: token.name,
                  loanAssetSymbol: token.symbol,
                  loanAssetDecimals: token.decimals || 18,
                  loanAssetAmount:
                    Math.abs(positionAccounting.baseBalance) /
                    10 ** (token.decimals || 18),
                  loanAssetAmountUsd: Math.abs(
                    positionAccounting.baseBalanceUsd
                  ),
                  loanLiveAssetAmountUsd:
                    (Math.abs(positionAccounting.basePrincipal) *
                      marketAccounting.baseBorrowIndex) /
                    BASE_INDEX_SCALE /
                    10 ** (token.decimals || 18),
                  loanTimestamp: position.creationBlockNumber,
                  collaterals,
                  apy: parseFloat(
                    (position.market.accounting.netBorrowApr * 100).toFixed(2)
                  ),
                  link: `https://app.compound.finance/?market=${token.symbol.toLowerCase()}-${CHAIN_SLUG_MAP[chainId as RegisteredChainId] ? CHAIN_SLUG_MAP[chainId as RegisteredChainId] : 'mainnet'}`,
                }
              })
            }) ?? []
          )
        }
      )
    )

    // Aggregate results from all chains
    const allPositions = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    )

    return allPositions
  } catch (err) {
    console.error('Unexpected error fetching Compound V3 positions:', err)
    return []
  }
}

export async function getMarketBorrowHistoryRates({
  chainId,
  poolId,
  interval,
  fromTimestamp,
}: {
  chainId: number
  poolId: string
  interval: TimeframeLabel
  fromTimestamp: number
}): Promise<MarketRate[]> {
  if (!chainId || !poolId || !interval || !fromTimestamp) {
    return []
  }

  try {
    return []
    // const chainClient = await getChainClient(chainId)
    // if (!chainClient) {
    //   return []
    // }
    // const { chainName, client } = chainClient

    // const isDaily = true
    // const query = isDaily
    //   ? MARKET_DAILY_BORROW_RATES
    //   : MARKET_HOURLY_BORROW_RATES

    // const { data, error } = await client
    //   .query<MarketDailyBorrowRatesQuery | MarketHourlyBorrowRatesQuery>(
    //     query,
    //     {
    //       where: { market: poolId, timestamp_gte: fromTimestamp },
    //     }
    //   )
    //   .toPromise()

    // if (error) {
    //   console.error(
    //     `Failed to fetch ${chainName} Compound V3 ${isDaily ? 'daily' : 'hourly'} borrow rates:`,
    //     error
    //   )
    //   if (error.message?.includes('Time-out') || error.networkError) {
    //     console.warn(
    //       `${chainName} Compound V3 API timeout - returning empty rates`
    //     )
    //   }
    //   return []
    // }

    // const snapshots = isDaily
    //   ? (data as MarketDailyBorrowRatesQuery)?.marketDailySnapshots
    //   : (data as MarketHourlyBorrowRatesQuery)?.marketHourlySnapshots

    // return (
    //   snapshots?.map((snapshot) => ({
    //     timestamp: Number(snapshot.timestamp),
    //     rate: Number(snapshot.rates?.[0].rate ?? '0'),
    //   })) ?? []
    // )
  } catch (err) {
    console.error(
      'Unexpected error fetching Compound V3 market borrow rates:',
      err
    )
    return []
  }
}

export async function getMarketSupplyHistoryRates({
  chainId,
  poolId,
  interval,
  fromTimestamp,
}: {
  chainId: number
  poolId: string
  interval: TimeframeLabel
  fromTimestamp: number
}): Promise<MarketRate[]> {
  if (!chainId || !poolId || !interval || !fromTimestamp) {
    return []
  }

  try {
    return []
    // const chainClient = await getChainClient(chainId)
    // if (!chainClient) {
    //   return []
    // }
    // const { chainName, client } = chainClient

    // const isDaily = true
    // const query = isDaily ? MARKET_DAILY_LEND_RATES : MARKET_HOURLY_LEND_RATES

    // const { data, error } = await client
    //   .query<MarketDailySupplyRatesQuery | MarketHourlySupplyRatesQuery>(
    //     query,
    //     {
    //       where: { market: poolId, timestamp_gte: fromTimestamp },
    //     }
    //   )
    //   .toPromise()

    // if (error) {
    //   console.error(
    //     `Failed to fetch ${chainName} Compound V3 ${isDaily ? 'daily' : 'hourly'} supply rates:`,
    //     error
    //   )
    //   if (error.message?.includes('Time-out') || error.networkError) {
    //     console.warn(
    //       `${chainName} Compound V3 API timeout - returning empty rates`
    //     )
    //   }
    //   return []
    // }

    // const snapshots = isDaily
    //   ? (data as MarketDailySupplyRatesQuery)?.marketDailySnapshots
    //   : (data as MarketHourlySupplyRatesQuery)?.marketHourlySnapshots

    // return (
    //   snapshots?.map((snapshot) => ({
    //     timestamp: Number(snapshot.timestamp),
    //     rate: Number(snapshot.rates?.[0].rate ?? '0'),
    //   })) ?? []
    // )
  } catch (err) {
    console.error(
      'Unexpected error fetching Compound V3 market supply rates:',
      err
    )
    return []
  }
}
