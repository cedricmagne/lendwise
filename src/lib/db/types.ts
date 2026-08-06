/**
 * Domain types for the APY pipeline — fetcher output (SpotPayload), the products
 * registry, and shared market/reward shapes.
 *
 * Stored-row types (apy_hourly / apy_daily / products rows) are inferred from the
 * Drizzle schema and re-exported at the bottom of this file. See
 * `src/lib/db/schema.ts` for the Postgres tables.
 */
import type { ProductRow } from './schema'

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

export type Kind = 'supply' | 'borrow'

export type ProductType = 'reserve' | 'market' | 'vault' | 'pool'

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

// ─── Product base ─────────────────────────────────────────────────────────────

/**
 * `TMeta` defaults to `unknown` so `SupplyProduct`, `BorrowProduct` and
 * `Product` stay usable bare (as the pipeline uses them —
 * `getProducts(): Promise<(SupplyProduct | BorrowProduct)[]>`) and any
 * concrete meta interface — which, having no index signature, is not
 * assignable to `Record<string, unknown>` — widens into it without a cast.
 * Each protocol declares its own meta shape next to its adapter
 * (`src/lib/protocols/{name}/{version}/types.ts`) and narrows locally, e.g.
 * `SupplyProduct<AaveSupplyMeta>` — this file never grows a protocol union.
 */
export interface BaseProduct<TMeta = unknown> {
  /**
   * Deterministic slug — primary key.
   * Format: {protocol.provider}-{protocol.name}-{asset.symbol}-{kind}
   */
  _id: string
  active: boolean
  createdAt: Date
  updatedAt: Date
  asset: Asset
  protocol: {
    /**
     * Normalized provider identifier for filtering — groups an adapter's
     * versions, e.g. "aave", "morpho". Deliberately `string`, not a closed
     * union: nothing narrows on this field, so adding a protocol never
     * requires touching this file. DB column is plain `text`, no enum.
     */
    provider: string
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
    /** Protocol-owned metadata — native identifier + governance parameters. */
    meta: TMeta
  }
}

export interface SupplyProduct<TMeta = unknown> extends BaseProduct<TMeta> {
  kind: 'supply'
}

export interface BorrowProduct<TMeta = unknown> extends BaseProduct<TMeta> {
  kind: 'borrow'
  /** Always non-empty on a borrow product. */
  collaterals: Collateral[]
}

export type Product<TMeta = unknown> =
  SupplyProduct<TMeta> | BorrowProduct<TMeta>

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
  /**
   * Average total amount supplied in native token units. `null` when unknown,
   * e.g. backfilled Aave reserve history, whose offchain API carries APY
   * rates only — no liquidity timeseries at all (a zero would be a false
   * "market holds nothing" claim). Same lesson as BorrowMarketState below,
   * hitting the supply side via Aave instead of Morpho.
   */
  supplyAssets: number | null
  /** Average total value supplied in USD. `null` when unknown — see supplyAssets. */
  supplyAssetsUsd: number | null
  /**
   * Average utilization rate — 0 to 1. `null` when unknown, e.g. backfilled
   * Morpho vault history, whose API carries no liquidity timeseries to derive
   * it from (a zero would be a false "0% utilized" claim). See the parallel
   * note on unknownBorrowMarket in morpho/v1/apy-history.ts.
   */
  utilizationRate: number | null
  /** Average loan asset price in USD. `null` when unknown — see supplyAssets. */
  assetPriceUsd: number | null
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
 * as `low_liquidity`.
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
  protocol: string
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

/**
 * A catalogued product and its most recent observation — what a table reads.
 *
 * The type lives here rather than in the repository or the presentation
 * module: both depend on it, and neither should import the other.
 */
export interface CatalogueRow {
  product: ProductRow
  hour: Date
  apyNet: number
  apyRewards: number
  supplyAssets: number | null
  supplyAssetsUsd: number | null
  borrowAssets: number | null
  borrowAssetsUsd: number | null
  collateralAssetsUsd: number | null
  utilizationRate: number | null
  assetPriceUsd: number | null
  // 7d / 30d / 365d windowed averages from `apy_daily`, joined in the same
  // query as the hourly observation above — see `latestForTable`. Shaped to
  // satisfy `ApyEnrichment` structurally so a `CatalogueRow` can be passed
  // anywhere an enrichment is expected without an extra fetch.
  apyDaily?: number
  apyMonthly?: number
  apyYearly?: number
  apyRewardsDaily?: number
  apyRewardsMonthly?: number
  apyRewardsYearly?: number
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
