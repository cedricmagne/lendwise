import type { Address } from 'viem'

import type {
  ApyBreakdown,
  BorrowMarketState,
  BorrowProduct,
  SpotPayload,
  SupplyMarketState,
  SupplyProduct,
} from '@/lib/db/types'
import type {
  BorrowPosition,
  MarketRate,
  SupplyPosition,
  TimeframeLabel,
  BorrowProduct as UiBorrowProduct,
  SupplyProduct as UiSupplyProduct,
} from '@/types'

/** Minimal chain config. Adapter-specific extras allowed. */
export interface AdapterChain {
  /** Canonical productId slug — must match CHAIN_SLUG_MAP. */
  slug: string
  /** Adapter-owned extras (subgraphUrl, marketName, …). */
  [key: string]: unknown
}

export interface FetchOpts {
  /** Filter by canonical chain_id. Replaces the old name-matching chainFilter. */
  chainIds?: number[]
}

export interface HistoryParams {
  startTimestamp: number // unix seconds
  endTimestamp: number // unix seconds
  interval: 'HOUR' | 'DAY'
  chainIds?: number[]
  onProgress?: (msg: string) => void
}

/** Moved from aave/v3/apy-history.ts — contract type, not an Aave detail. */
export type HistoryDataPoint = {
  timestamp: Date
  productId: string
  kind: 'supply' | 'borrow'
  apy: ApyBreakdown
  market: SupplyMarketState | BorrowMarketState
}

/**
 * The floors applied AT INGESTION — in the protocol's own query, so a pool below
 * them is never even fetched.
 *
 * These are the only filters allowed in a `where` clause, and they exist for one
 * purpose: not collecting literal dust. Keep them LOW.
 *
 * They are the single irreversible decision in the pipeline. A pool we do not
 * collect has no history, and can never be given one: a market sitting at $80k that
 * grows to $500k next quarter arrives with no 30-day mean, no 180-day stddev, and
 * nothing the MCP can say about whether it is stable. Raising a floor here throws
 * away a future you cannot buy back.
 *
 * Everything else — "is this market big enough to show?", "is this rate absurd?" —
 * is decided on the READ side, in `lib/display-eligibility`, from the data we
 * stored. Change a number THERE and it takes effect everywhere, instantly,
 * retroactively, with the full history intact. That is the whole reason the two
 * layers are separate.
 *
 * Whatever is set here is honoured by every job: the 10-minute collector, the
 * hourly catalogue sync, and the heal job all read the protocol's listing rule from
 * one place — its `listing.ts` — which reads it from here.
 */
export interface IngestionFloors {
  /**
   * Morpho Blue markets: minimum borrowed USD. Morpho lists thousands of
   * permissionless markets, most of which never see a single borrow.
   */
  minBorrowAssetsUsd?: number
  /** Minimum supplied/total USD. Unset = collect everything the protocol lists. */
  minTvlUsd?: number
}

export interface YieldAdapter {
  /** Unique. = registry key = protocol_name in DB. Ex: 'aave_v3'. */
  id: string
  /** Display name. Ex: 'Aave v3'. */
  name: string
  /** Groups versions. Ex: 'aave'. = provider column. */
  provider: string
  /** Ex: 'v3'. */
  version: string
  /** chainId → chain config. Source of truth for supported chains. */
  chains: Record<number, AdapterChain>
  ingestion?: IngestionFloors

  getProducts(opts?: FetchOpts): Promise<(SupplyProduct | BorrowProduct)[]>
  getApySpot(opts?: FetchOpts): Promise<SpotPayload[]>
  /** OPTIONAL — a protocol without a usable history source omits it; heal falls back to donors. */
  getApyHistory?(params: HistoryParams): Promise<HistoryDataPoint[]>
}

export interface RateParams {
  poolId: string
  chainId: number
  tokenId: Address
  interval: TimeframeLabel
  fromTimestamp: number
}

/**
 * Wallet positions + UI rates + live UI product lists. Optional per protocol —
 * a yield contributor does not have to provide it.
 *
 * getSupplyProducts/getBorrowProducts are REQUIRED here even though spec §7
 * omitted them: products.actions.ts (the /supply and /borrow pages) consumes
 * them today.
 */
export interface AppAdapter {
  getUserSupplyPositions(p: { addresses: Address[] }): Promise<SupplyPosition[]>
  getUserBorrowPositions(p: { addresses: Address[] }): Promise<BorrowPosition[]>
  getMarketSupplyHistoryRates(p: RateParams): Promise<MarketRate[]>
  getMarketBorrowHistoryRates(p: RateParams): Promise<MarketRate[]>
  getSupplyProducts(): Promise<UiSupplyProduct[]>
  getBorrowProducts(): Promise<UiBorrowProduct[]>
}
