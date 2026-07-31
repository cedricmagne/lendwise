import { Address } from 'viem'

import type { ProtocolName } from '@/config/protocols-meta'

// ============================================================================
// PROTOCOL TYPES
// ============================================================================
// Re-export the adapter-id union so consumers can `import { ProtocolName } from '@/types'`.
// ============================================================================
export type { ProtocolName }

export type PositionType = 'supply' | 'borrow'
export type AssetType = 'stable' | 'volatile' | 'liquid-staking'

export interface Token {
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  type?: AssetType
  /** Max LTV as a fraction (0–1). Borrow-collateral only; null when the
   *  protocol exposes no native max LTV (e.g. Morpho, which only has LLTV). */
  ltv?: number | null
  /** Liquidation LTV as a fraction (0–1). Borrow-collateral only. */
  lltv?: number | null
}

export interface Market {
  id: string
  protocol: ProtocolName
  asset: Token
  collateralAsset?: Token
  supplyAPY: number
  borrowAPY: number
  totalSupply: string
  totalBorrow: string
  utilizationRate: number
  ltv: number
  liquidationThreshold: number
  liquidationBonus: number
  isActive: boolean
  isFrozen: boolean
}

export interface Position {
  id: string
  protocol: ProtocolName
  user: Address
  market: Market
  type: PositionType
  amount: string
  amountUsd: number
  apy: number
  healthFactor?: number
  collateralEnabled: boolean
  timestamp: number
}

export interface UserPositionSummary {
  address: Address
  totalSupplyUSD: number
  totalBorrowUSD: number
  netAPY: number
  healthFactor: number
  positions: Position[]
  protocolBreakdown: Record<
    ProtocolName,
    {
      supplyUSD: number
      borrowUSD: number
      positionCount: number
    }
  >
}

export interface TokenPrice {
  address: Address
  priceUSD: number
  timestamp: number
}

export interface SupplyPosition {
  id: string
  protocol: ProtocolName
  network: string
  userAddress: Address
  poolName: string
  poolAddress: Address
  poolId: string
  poolChainId: number
  assetAddress: Address
  assetName: string
  assetSymbol: string
  assetDecimals: number
  assetAmount: string
  assetAmountUsd: number
  assetLiveAmountUsd: number
  apy: number
  link?: string
}

export interface SupplyProduct {
  protocol: ProtocolName
  network: string
  poolName: string
  poolAddress: Address
  poolId: string
  poolChainId: number
  assetAddress: Address
  assetName: string
  assetSymbol: string
  assetDecimals: number
  assetAmount: string
  assetAmountUsd: number
  assetPriceUsd?: number
  liquidityAmount: string
  liquidityAmountUsd: number
  /**
   * The standardized net APY of the latest hourly row, or **undefined when we
   * have not measured one**.
   *
   * It used to fall back to the adapter's raw value without saying so, and the
   * two were indistinguishable on screen. That is what produced the 0.00 % on
   * an idle market on 2026-07-26: no hourly row, so the adapter's figure was
   * shown as if it had been measured — and it sorted like one. A display says
   * what it knows; the column renders "—".
   */
  apy?: number
  apyDaily?: number
  apyMonthly?: number
  apyYearly?: number
  /**
   * Reward component of the matching APY horizon, in the same unit (APY, not
   * points). Only used to tell "this rate includes incentives" apart from a pure
   * base rate — `undefined` means unknown, `0` means no rewards.
   */
  apyRewards?: number
  apyRewardsDaily?: number
  apyRewardsMonthly?: number
  apyRewardsYearly?: number
  productId?: string
  link?: string
}

export interface BorrowProduct {
  protocol: ProtocolName
  network: string
  poolName: string
  poolAddress: Address
  poolId: string
  poolChainId: number
  assetAddress: Address
  assetName: string
  assetSymbol: string
  assetDecimals: number
  assetAmount: string
  assetAmountUsd: number
  liquidityAmount: string
  liquidityAmountUsd: number
  collaterals: Token[]
  /**
   * The standardized net APY of the latest hourly row, or **undefined when we
   * have not measured one**.
   *
   * It used to fall back to the adapter's raw value without saying so, and the
   * two were indistinguishable on screen. That is what produced the 0.00 % on
   * an idle market on 2026-07-26: no hourly row, so the adapter's figure was
   * shown as if it had been measured — and it sorted like one. A display says
   * what it knows; the column renders "—".
   */
  apy?: number
  apyDaily?: number
  apyMonthly?: number
  apyYearly?: number
  productId?: string
  link?: string
}

export interface BorrowPosition {
  id: string
  protocol: ProtocolName
  network: string
  healthFactor: number
  userAddress: Address
  poolId: string
  poolName: string
  poolAddress: Address
  poolChainId: number
  loanAssetAddress: Address
  loanAssetName: string
  loanAssetSymbol: string
  loanAssetDecimals: number
  loanAssetAmount: number
  loanAssetAmountUsd: number
  loanLiveAssetAmountUsd: number
  loanTimestamp: number
  collaterals: (Token & { amount: number; amountUsd: number })[]
  apy: number
  link?: string
}

export interface UserPosition {
  supply: { [protocol: string]: SupplyPosition[] }
  borrow: { [protocol: string]: BorrowPosition[] }
}

export interface MarketStats {
  protocol: ProtocolName
  assetSymbol: string
  tvl: number
  supplyApy: number
  borrowApy: number
  volume24h?: number
}

export interface MarketRate {
  timestamp: number
  rate: number
}

/**
 * Market rates interval constants
 * Use MARKET_RATES_INTERVAL.DAY or MARKET_RATES_INTERVAL.HOUR
 */
export const MARKET_RATES_INTERVAL = {
  HOUR: 'HOUR',
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
  QUARTER: 'QUARTER',
  YEAR: 'YEAR',
} as const

/**
 * Type derived from MARKET_RATES_INTERVAL values
 */
export type MarketRateInterval =
  (typeof MARKET_RATES_INTERVAL)[keyof typeof MARKET_RATES_INTERVAL]

export type TimeframeLabel = '24h' | '7d' | '1M' | '3M' | '1Y' | 'Max'

export interface TimeframeOption {
  label: TimeframeLabel
  interval: MarketRateInterval
  days?: number
}

export const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { label: '24h', interval: MARKET_RATES_INTERVAL.HOUR, days: 1 },
  { label: '7d', interval: MARKET_RATES_INTERVAL.DAY, days: 7 },
  { label: '1M', interval: MARKET_RATES_INTERVAL.DAY, days: 30 },
  { label: '3M', interval: MARKET_RATES_INTERVAL.DAY, days: 90 },
  { label: '1Y', interval: MARKET_RATES_INTERVAL.DAY, days: 365 },
  { label: 'Max', interval: MARKET_RATES_INTERVAL.DAY },
]

export interface StatCard {
  label: string
  value: string
  sub?: string
  /** Comparison against the rows currently filtered in the table. */
  note?: string
  /** Colours the note — reserved for the one card carrying an action. */
  noteAccent?: boolean
  accent?: boolean
  /** Makes the card a button — used to filter the table down to the market it names. */
  onClick?: () => void
}
