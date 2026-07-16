import { cache } from 'react'

import type { Address } from 'viem'

import { MarketRate, TimeframeLabel } from '@/types'

import {
  MarketBorrowHistoryRatesQuery,
  MarketSupplyHistoryRatesQuery,
  TimeWindow,
} from './generated/graphql'
import { client } from './positions'
import { MARKET_BORROW_HISTORY, MARKET_SUPPLY_HISTORY } from './queries'

const TIMEFRAME_MAP: Record<TimeframeLabel, TimeWindow> = {
  '24h': TimeWindow.LastDay,
  '7d': TimeWindow.LastWeek,
  '1M': TimeWindow.LastMonth,
  '3M': TimeWindow.LastSixMonths,
  '1Y': TimeWindow.LastYear,
  Max: TimeWindow.LastYear,
}

const _formatMarketBorrowHistoryRates = cache(
  (data: MarketBorrowHistoryRatesQuery['borrowAPYHistory']): MarketRate[] =>
    data.reverse().map((item) => ({
      timestamp: Math.floor(new Date(item.date).getTime() / 1000),
      rate: item.avgRate.value,
    }))
)

export async function getMarketBorrowHistoryRates({
  poolId,
  chainId,
  tokenId,
  interval,
}: {
  poolId: string
  chainId: number
  tokenId: Address
  interval: TimeframeLabel
}): Promise<MarketRate[]> {
  const { data, error } = await client
    .query<MarketBorrowHistoryRatesQuery>(MARKET_BORROW_HISTORY, {
      request: {
        chainId,
        market: poolId,
        underlyingToken: tokenId,
        window: TIMEFRAME_MAP[interval],
      },
    })
    .toPromise()

  if (error) {
    console.error(`Failed to fetch Aave V3 borrow rates:`, error)
    if (error.message?.includes('Time-out') || error.networkError) {
      console.warn(`Aave V3 API timeout - returning empty rates`)
      return []
    }
    throw error
  }

  return data?.borrowAPYHistory
    ? _formatMarketBorrowHistoryRates(data.borrowAPYHistory)
    : []
}

const _formatMarketSupplyHistoryRates = cache(
  (data: MarketSupplyHistoryRatesQuery['supplyAPYHistory']): MarketRate[] =>
    data.reverse().map((item) => ({
      timestamp: Math.floor(new Date(item.date).getTime() / 1000),
      rate: item.avgRate.value,
    }))
)

export async function getMarketSupplyHistoryRates({
  poolId,
  chainId,
  tokenId,
  interval,
}: {
  poolId: string
  chainId: number
  tokenId: Address
  interval: TimeframeLabel
}): Promise<MarketRate[]> {
  const { data, error } = await client
    .query<MarketSupplyHistoryRatesQuery>(MARKET_SUPPLY_HISTORY, {
      request: {
        chainId,
        market: poolId,
        underlyingToken: tokenId,
        window: TIMEFRAME_MAP[interval],
      },
    })
    .toPromise()

  if (error) {
    console.error(`Failed to fetch Aave V3 borrow rates:`, error)
    if (error.message?.includes('Time-out') || error.networkError) {
      console.warn(`Aave V3 API timeout - returning empty rates`)
    }
    return []
  }

  return data?.supplyAPYHistory
    ? _formatMarketSupplyHistoryRates(data.supplyAPYHistory)
    : []
}
