'use server'

import { cache } from 'react'

import { Address } from 'viem'

import { type ProtocolName } from '@/config/protocols-meta'
import { APP_ADAPTERS } from '@/config/protocols-server'
import type { MarketRate, TimeframeLabel } from '@/types'

/**
 * Parameters for loading market rates
 */
export interface LoadMarketRateParams {
  protocolId: string
  chainId: number
  poolId: string
  tokenId: Address
  interval: TimeframeLabel
  fromTimestamp: number
}

/**
 * Load market borrow rates for a specific pool and timeline
 * @param params - Parameters including timeline, fromTimestamp, and productId
 * @returns Array of market rates with timestamp and rate
 */
export const loadMarketBorrowHistoryRates = cache(async function loadMarketRate(
  params: LoadMarketRateParams
): Promise<MarketRate[]> {
  const { chainId, protocolId, interval, fromTimestamp, poolId, tokenId } =
    params

  try {
    const load = APP_ADAPTERS[protocolId as ProtocolName]
    if (!load) throw new Error(`No app adapter for protocol ${protocolId}`)

    const adapter = await load()

    const rates = await adapter.getMarketBorrowHistoryRates({
      chainId,
      poolId,
      tokenId,
      interval,
      fromTimestamp,
    })

    return rates
  } catch (err) {
    console.error('Error loading market rates:', err)
    return []
  }
})

/**
 * Load market supply rates for a specific pool and timeline
 * @param params - Parameters including timeline, fromTimestamp, and productId
 * @returns Array of market rates with timestamp and rate
 */
export const loadMarketSupplyHistoryRates = cache(async function loadMarketRate(
  params: LoadMarketRateParams
): Promise<MarketRate[]> {
  const { chainId, protocolId, interval, fromTimestamp, poolId, tokenId } =
    params

  try {
    const load = APP_ADAPTERS[protocolId as ProtocolName]
    if (!load) throw new Error(`No app adapter for protocol ${protocolId}`)

    const adapter = await load()

    const rates = await adapter.getMarketSupplyHistoryRates({
      chainId,
      poolId,
      interval,
      fromTimestamp,
      tokenId,
    })

    return rates
  } catch (err) {
    console.error('Error loading market rates:', err)
    return []
  }
})
