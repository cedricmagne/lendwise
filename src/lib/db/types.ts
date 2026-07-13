/**
 * @file types.ts
 * Domain types for the APY pipeline — fetcher output (SpotPayload), the products
 * registry, and shared market/reward shapes.
 *
 * Stored-row types (apy_hourly / apy_daily / products rows) are inferred from the
 * Drizzle schema and re-exported at the bottom of this file. See
 * `src/lib/db/schema.ts` for the Postgres tables.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

export type Kind = 'supply' | 'borrow'
export type ProviderId = 'aave' | 'morpho' | 'compound'

export type ProductType = 'reserve' | 'market' | 'vault'

export interface Chain {
  id: number // EVM chain ID — 1 = Ethereum, 8453 = Base, 42161 = Arbitrum
  name: string // "ethereum" | "base" | "arbitrum" | "polygon"
}

export interface Asset {
  symbol: string
  name: string
  address: string
  decimals: number
}

// ─────────────────────────────────────────────────────────────────────────────
// pools collection
// ─────────────────────────────────────────────────────────────────────────────

export interface Collateral {
  symbol: string
  name: string
  address: string
  decimals: number
  /**
   * Maximum LTV allowed to open a borrow position.
   * null for Morpho Blue — the protocol only exposes lltv.
   */
  ltv: number | null
  /** Liquidation threshold — position becomes liquidatable above this LTV. */
  lltv: number
  /**
   * Whether this asset can be used as collateral on this specific market.
   * Sourced from AAVE's supplyInfo.canBeCollateral.
   * Always true for Morpho Blue.
   */
  canBeCollateral: boolean
}

// ─── Protocol-specific meta — merged into protocol.meta ───────────────────────

/**
 * AAVE supply — a "reserve" in AAVE terminology.
 * Identified by the underlying asset address (underlyingToken).
 */
export interface ProtocolMetaAaveSupply {
  underlyingToken: string // underlying asset contract address
  aTokenSymbol: string // e.g. "aEthLidoUSDC"
  /** Maximum LTV allowed if this asset is used as collateral — e.g. 0.75 */
  maxLTV: number
  /** Liquidation threshold — position becomes liquidatable above this LTV — e.g. 0.80 */
  liquidationThreshold: number
}

/**
 * AAVE borrow — same "reserve", borrow side.
 * IRM parameters fixed by governance.
 */
export interface ProtocolMetaAaveBorrow {
  underlyingToken: string // underlying asset contract address
  vTokenSymbol: string // e.g. "variableDebtEthLidoUSDC"
  variableRateSlope1: number
  variableRateSlope2: number
  optimalUsageRate: number
  baseVariableBorrowRate: number
}

/**
 * Morpho Blue borrow — same market, borrow side.
 */
export interface ProtocolMetaMorphoBlueBorrow {
  id: string // marketId hash
  lltv: number // liquidation LTV for this market — e.g. 0.915
}

/**
 * MetaMorpho supply — a "vault" built on top of Morpho Blue markets.
 * Identified by the vault contract address.
 * No borrow side — vaults are supply-only.
 */
export interface ProtocolMetaMetaMorphoSupply {
  name: string
  symbol: string
  address: string // vault contract address
  curators: string[] // e.g. ["Steakhouse", "Gauntlet"]
}

/**
 * Compound supply — a "market" in Compound terminology.
 * Identified by the cToken (v2) or Comet (v3) contract address.
 */
export interface ProtocolMetaCompoundSupply {
  cToken: string // e.g. "cUSDCv3" contract address
  reserveFactor: number // e.g. 0.10
}

/**
 * Compound borrow — same market, borrow side.
 */
export interface ProtocolMetaCompoundBorrow {
  cToken: string
  reserveFactor: number
}

// ─── Product base ─────────────────────────────────────────────────────────────

export interface BaseProduct {
  /**
   * Deterministic slug — primary key.
   * Format: {protocol.provider}-{protocol.name}-{asset.symbol}-{kind}
   * Morpho Blue borrow: …-{collateral.symbol}-borrow
   */
  _id: string
  active: boolean
  createdAt: Date
  updatedAt: Date
  asset: Asset
  protocol: {
    /** Normalized provider identifier for filtering — "aave" | "morpho" | "compound" */
    provider: ProviderId
    type: ProductType
    version: string
    /**
     * Native market/deployment name, verbatim from the protocol subgraph.
     * Examples: "AaveV3Ethereum", "AaveV3EthereumLido", "MorphoBlueEthereum"
     */
    name: string
    subgraphUrl: string
    chain: Chain
    /** Protocol contract address — supplying pool / market factory. */
    address: string
    /**
     * Protocol-specific metadata — type discriminator + native identifier
     * + governance parameters.
     */
    meta:
      | ProtocolMetaAaveSupply
      | ProtocolMetaAaveBorrow
      | ProtocolMetaMorphoBlueBorrow
      | ProtocolMetaMetaMorphoSupply
      | ProtocolMetaCompoundSupply
      | ProtocolMetaCompoundBorrow
  }
}

export interface SupplyProduct extends BaseProduct {
  kind: 'supply'
  protocol: BaseProduct['protocol'] & {
    meta:
      | ProtocolMetaAaveSupply
      | ProtocolMetaMetaMorphoSupply
      | ProtocolMetaCompoundSupply
  }
}

export interface BorrowProduct extends BaseProduct {
  kind: 'borrow'
  /** Always non-empty on a borrow product. */
  collaterals: Collateral[]
  protocol: BaseProduct['protocol'] & {
    meta:
      | ProtocolMetaAaveBorrow
      | ProtocolMetaMorphoBlueBorrow
      | ProtocolMetaCompoundBorrow
  }
}

export type Product = SupplyProduct | BorrowProduct

// ─────────────────────────────────────────────────────────────────────────────
// Shared APY types — used by apy.hourly and apy.daily
// ─────────────────────────────────────────────────────────────────────────────

export interface RewardItem {
  token: {
    symbol: string
    address: string
  }
  /**
   * Raw APR as returned by the source protocol — stored for traceability.
   * Morpho:  state.rewards[].supplyApr / borrowApr
   * AAVE:    AaveSupplyIncentive.extraSupplyApr / AaveBorrowIncentive.borrowAprDiscount
   * Merkl:   opportunity.apr
   */
  apr: number
  /**
   * APR converted to APY using daily compounding (n=365).
   * APY = (1 + APR / 365)^365 - 1
   */
  apy: number
  source: 'protocol' | 'merkl' | 'merit'
  program: string | null
}

export interface ApyBreakdown {
  /** Average base APY from the protocol IRM — before fees, without rewards. */
  base: number
  /** Average sum of all reward APYs. */
  rewards: number
  /** Average protocol fee APY. */
  fees: number
  /**
   * Average net APY — effective rate for the user.
   * Supply:   base - fees + rewards
   * Borrow: base + fees - rewards
   */
  net: number
  /**
   * Reward items from the last slot — not averaged.
   * Items can appear/disappear between slots.
   */
  rewardItems: RewardItem[]
}

// ─── Market state — split by kind ─────────────────────────────────────────────

export interface SupplyMarketState {
  /** Average total amount supplied in native token units. */
  supplyAssets: number
  /** Average total value supplied in USD. */
  supplyAssetsUsd: number
  /** Average borrow utilization rate — 0 to 1. */
  utilizationRate: number
  /** Average loan asset price in USD. */
  assetPriceUsd: number
}

/**
 * Every number here is nullable, because "we don't know" is a state the pipeline
 * really does reach and the columns behind them have always been nullable.
 *
 * Morpho's market-history query returns rates but no liquidity, so a HEALED borrow
 * hour has no market state at all. While this type insisted on `number`, the only
 * way to satisfy it was to write zeros — and a zero is not a blank, it is a claim
 * that the market holds nothing. 1,595 rows made that claim about markets holding
 * tens of millions, and the display policy believed them and hid two $27M markets
 * as `empty_market`.
 *
 * A type that cannot say "unknown" forces every writer to lie.
 */
export interface BorrowMarketState {
  /** Average total amount supplied in native token units. */
  supplyAssets: number | null
  /** Average total value supplied in USD. */
  supplyAssetsUsd: number | null
  /** Average total amount borrowed in native token units. */
  borrowAssets: number | null
  /** Average total value borrowed in USD. */
  borrowAssetsUsd: number | null
  /** Average borrow utilization rate — 0 to 1. */
  utilizationRate: number | null
  /** Average loan asset price in USD. */
  assetPriceUsd: number | null
  /**
   * Average total collateral in USD.
   * null for AAVE/Compound (multi-collateral).
   */
  collateralAssetsUsd: number | null
  /**
   * Average collateral/loan price ratio.
   * Morpho Blue only — null for AAVE/Compound.
   */
  priceCollateralInLoanAsset: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// SpotPayload — fetcher output, input to the hourly upsert pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalized snapshot returned by each protocol fetcher.
 * Contains only the data needed to compute the rolling average in apy.hourly.
 * No timestamp — assigned by the orchestrator at collection time.
 */
export type SpotPayload = {
  productId: string
  kind: Kind
  protocol: ProviderId
  chainId: number
  /** Loan asset symbol — "USDC", "WETH". */
  asset: string
  apy: {
    base: number
    rewards: number
    fees: number
    net: number
    rewardItems: RewardItem[]
  }
  market: SupplyMarketState | BorrowMarketState
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres row types (inferred from the Drizzle schema)
//
// Canonical row shapes for the stored data. Domain types above (SpotPayload,
// Product, market states) describe fetcher output + the products registry;
// these describe the apy_hourly / apy_daily rows.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ApyDailyRow,
  ApyHourlyInsert,
  ApyHourlyRow,
  ProductRow,
} from './schema'
