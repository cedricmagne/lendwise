import type { Client } from '@urql/core'

import type { BorrowPosition, MarketRate, SupplyPosition } from '@/types'

/**
 * Base chain client configuration type.
 * Protocols can extend this with their own query and transformer types.
 */
export type BaseChainClient<TQueries = unknown, TTransformers = unknown> = {
  client: Client
  chainId: number
  chainName?: string
  queries?: TQueries
  transformers?: TTransformers
}

/**
 * Chain configuration from protocol config.
 */
export type ChainConfig = {
  id: number
  name: string
  custom?: {
    clientPath?: string
    subgraphUrl?: string
  }
}

/**
 * Base transformer types that protocols can use or extend.
 */
export type BaseChainTransformers = {
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
