import { createSchema } from 'graphql-yoga'

import { resolvers } from './resolvers'

export const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  # ─── Enums ──────────────────────────────────────────────────────────────────

  enum ProtocolName {
    aave
    morpho
    compound
  }

  enum RewardSource {
    protocol
    merkl
    merit
  }

  # ─── Shared types ────────────────────────────────────────────────────────────

  type RewardToken {
    symbol: String!
    address: String!
  }

  # ─── APY breakdown ───────────────────────────────────────────────────────────

  type RewardItem {
    token: RewardToken!
    "Raw APR as returned by the source protocol — stored for traceability."
    apr: Float!
    "APR converted to APY using daily compounding (1 + APR/365)^365 - 1."
    apy: Float!
    source: RewardSource!
    program: String
  }

  "APY breakdown for HOURLY timeframe — single value per field."
  type HourlyApyBreakdown {
    "Base APY from the protocol IRM — before fees, without rewards."
    base: Float!
    "Sum of all reward APYs (converted from APR)."
    rewards: Float!
    "Protocol fee APY."
    fees: Float!
    "Net APY = base - fees + rewards (supply) / base + fees - rewards (borrow)."
    net: Float!
    "Individual reward items — one per (token, program) pair."
    rewardItems: [RewardItem!]!
  }

  "APY breakdown for DAILY timeframe — daily averaged values."
  type DailyApyBreakdown {
    "Average base APY across all hourly slots of the day."
    base: Float!
    "Average net APY — primary field for comparisons."
    net: Float!
    "Average reward APY across the day."
    rewards: Float!
    "Average protocol fee APY across the day."
    fees: Float!
    "Reward items from the last hourly slot of the day."
    rewardItems: [RewardItem!]!
  }

  # ─── Market state ─────────────────────────────────────────────────────────────

  type SupplyHourlyMarketState {
    "Total amount supplied in native token units."
    supplyAssets: Float!
    "Total value supplied in USD."
    supplyAssetsUsd: Float!
    utilizationRate: Float!
    assetPriceUsd: Float!
  }

  type BorrowHourlyMarketState {
    "Total amount supplied in native token units."
    supplyAssets: Float!
    "Total value supplied in USD."
    supplyAssetsUsd: Float!
    "Total amount borrowed in native token units."
    borrowAssets: Float!
    "Total value borrowed in USD."
    borrowAssetsUsd: Float!
    utilizationRate: Float!
    assetPriceUsd: Float!
    "null for AAVE/Compound — multi-collateral."
    collateralAssetsUsd: Float
    "Morpho Blue only — null for AAVE/Compound."
    priceCollateralInLoanAsset: Float
  }

  type SupplyDailyMarketState {
    "Average total amount supplied in native token units across the day."
    supplyAssets: Float!
    "Average total value supplied in USD across the day."
    supplyAssetsUsd: Float!
    "Average utilization rate across the day."
    utilizationRate: Float!
    "Average asset price in USD across the day."
    assetPriceUsd: Float!
  }

  type BorrowDailyMarketState {
    "Average total amount supplied in native token units across the day."
    supplyAssets: Float!
    "Average total value supplied in USD across the day."
    supplyAssetsUsd: Float!
    "Average total amount borrowed in native token units across the day."
    borrowAssets: Float!
    "Average total value borrowed in USD across the day."
    borrowAssetsUsd: Float!
    "Average total collateral in USD across the day — null for AAVE/Compound."
    collateralAssetsUsd: Float
    "Average utilization rate across the day."
    utilizationRate: Float!
    "Average asset price in USD across the day."
    assetPriceUsd: Float!
    "Average collateral/loan price ratio across the day — null for AAVE/Compound."
    priceCollateralInLoanAsset: Float
  }

  # ─── Quality ──────────────────────────────────────────────────────────────────

  type HourlyQuality {
    count: Int!
    expectedCount: Int!
    firstSlot: DateTime!
    lastSlot: DateTime!
    status: String!
  }

  # ─── Collateral ───────────────────────────────────────────────────────────────

  type Collateral {
    symbol: String!
    name: String!
    address: String!
    decimals: Int!
    "null for Morpho Blue — only lltv is exposed."
    ltv: Float
    lltv: Float!
    canBeCollateral: Boolean!
  }

  # ─── Product ─────────────────────────────────────────────────────────────────

  type ProductAsset {
    symbol: String!
    name: String!
    address: String!
    decimals: Int!
  }

  type ProductChain {
    id: Int!
    name: String!
  }

  type ProductProtocol {
    "Normalized provider identifier — aave | morpho | compound."
    provider: ProtocolName!
    "Product type — reserve | market | vault."
    type: String!
    version: String!
    "Native market/deployment name — e.g. AaveV3Ethereum, MorphoBlueEthereum."
    name: String!
    chain: ProductChain!
    "Protocol contract address — pool / market factory."
    address: String!
    "Protocol-specific metadata — shape varies by provider. Use JSON scalar."
    meta: JSON
  }

  type Product {
    id: String!
    active: Boolean!
    kind: String!
    asset: ProductAsset!
    protocol: ProductProtocol!
    "Accepted collateral assets — null for supply products."
    collaterals: [Collateral!]
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # ─── Pagination ──────────────────────────────────────────────────────────────

  type PaginationInfo {
    "Number of items returned in this page."
    count: Int!
    "Total number of items matching the filters (ignoring first/skip)."
    countTotal: Int!
    "Maximum number of items requested (first argument)."
    limit: Int!
    "Number of items skipped (skip argument)."
    skip: Int!
  }

  enum OrderDirection {
    asc
    desc
  }

  """
  Sortable fields for supply queries. \`time\` resolves to the hour (hourly) or
  the date (daily), so one enum serves both grains.
  """
  enum SupplyApyOrderBy {
    time
    apyNet
    apyBase
    supplyAssetsUsd
    utilizationRate
  }

  "Sortable fields for borrow queries."
  enum BorrowApyOrderBy {
    time
    apyNet
    apyBase
    supplyAssetsUsd
    borrowAssetsUsd
    utilizationRate
  }

  # ─── Supply results ─────────────────────────────────────────────────────────────

  type SupplyHourlyResult {
    hour: DateTime!
    productId: String!
    protocol: ProtocolName!
    chainId: Int!
    asset: String!
    product: Product
    apy: HourlyApyBreakdown!
    market: SupplyHourlyMarketState!
    quality: HourlyQuality!
  }

  type SupplyDailyResult {
    date: DateTime!
    productId: String!
    protocol: ProtocolName!
    chainId: Int!
    asset: String!
    product: Product
    apy: DailyApyBreakdown!
    market: SupplyDailyMarketState!
  }

  # ─── Borrow results ───────────────────────────────────────────────────────────

  type BorrowHourlyResult {
    hour: DateTime!
    productId: String!
    protocol: ProtocolName!
    chainId: Int!
    asset: String!
    product: Product
    collaterals: [Collateral!]!
    apy: HourlyApyBreakdown!
    market: BorrowHourlyMarketState!
    quality: HourlyQuality!
  }

  type BorrowDailyResult {
    date: DateTime!
    productId: String!
    protocol: ProtocolName!
    chainId: Int!
    asset: String!
    product: Product
    collaterals: [Collateral!]!
    apy: DailyApyBreakdown!
    market: BorrowDailyMarketState!
  }

  # ─── Paginated responses ─────────────────────────────────────────────────────

  type SupplyHourlyResponse {
    items: [SupplyHourlyResult!]!
    pagination: PaginationInfo!
  }

  type SupplyDailyResponse {
    items: [SupplyDailyResult!]!
    pagination: PaginationInfo!
  }

  type BorrowHourlyResponse {
    items: [BorrowHourlyResult!]!
    pagination: PaginationInfo!
  }

  type BorrowDailyResponse {
    items: [BorrowDailyResult!]!
    pagination: PaginationInfo!
  }

  type ProductsResponse {
    items: [Product!]!
    pagination: PaginationInfo!
  }

  # ─── Facets ───────────────────────────────────────────────────────────────────

  type AssetFacet {
    symbol: String!
    "Number of products matching the filters with this asset."
    count: Int!
  }

  type ChainFacet {
    id: Int!
    "Canonical chain name, resolved from the chain ID."
    name: String!
    count: Int!
  }

  type ProtocolFacet {
    name: ProtocolName!
    count: Int!
  }

  "The filter values that actually exist, with counts — so a client never has to guess one."
  type ProductFacets {
    assets: [AssetFacet!]!
    chains: [ChainFacet!]!
    protocols: [ProtocolFacet!]!
  }

  # ─── Inputs ───────────────────────────────────────────────────────────────────

  "Shared filters for hourly queries."
  input HourlyFilters {
    "Filter by exact productId — e.g. morpho:v1:ethereum:vault:0x…:supply."
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    "Filter by protocol name — aave | morpho | compound."
    protocol: ProtocolName
    "Filter by native market name — e.g. AaveV3Ethereum, MorphoBlueEthereum."
    market: String
    "Filter by chain ID."
    chainId: Int
    "Filter by loan asset symbol — e.g. USDC, WETH."
    asset: String
    "Minimum supplied TVL in USD. In a thin market a headline APY is mostly noise."
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
    "ISO date string — start of range (inclusive). Defaults to last 24h."
    from: String
    "ISO date string — end of range (inclusive)."
    to: String
  }

  """
  Filters for the latest-snapshot queries.

  Deliberately has no \`from\` / \`to\`: these queries always read the most recent
  reading per product within a fixed 6-hour window. Accepting a time range here
  and ignoring it would be a filter that silently does nothing.
  """
  input LatestFilters {
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    "Minimum supplied TVL in USD. In a thin market a headline APY is mostly noise."
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
  }

  "Latest-snapshot filters for borrow products."
  input LatestBorrowFilters {
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    "Filter by collateral asset symbol."
    collateral: String
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
  }

  "Filters for the product registry. Typed columns only — the productId slug is never parsed."
  input ProductFilters {
    "Exact productId (primary key) — matched whole, never parsed."
    productId: String
    "supply | borrow."
    kind: String
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    "Defaults to true — only products still being tracked."
    active: Boolean
  }

  "Shared filters for daily queries."
  input DailyFilters {
    "Filter by exact productId — e.g. morpho:v1:ethereum:vault:0x…:supply."
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    "Minimum supplied TVL in USD. In a thin market a headline APY is mostly noise."
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
    "ISO date string — start of range (inclusive). Defaults to last 30 days."
    from: String
    "ISO date string — end of range (inclusive)."
    to: String
    "Convenience shorthand — 7d | 30d | 90d | 180d | 1y. Default: 30d."
    range: String
  }

  input BorrowHourlyFilters {
    "Filter by exact productId — e.g. aave:v3:ethereum:reserve:0x…:borrow."
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    "Filter by collateral asset symbol."
    collateral: String
    "Minimum supplied TVL in USD."
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
    "ISO date string — start of range (inclusive). Defaults to last 24h."
    from: String
    to: String
  }

  input BorrowDailyFilters {
    "Filter by exact productId — e.g. aave:v3:ethereum:reserve:0x…:borrow."
    productId: String
    "Filter by a batch of exact productIds — max 50."
    productIds: [String!]
    protocol: ProtocolName
    market: String
    chainId: Int
    asset: String
    collateral: String
    "Minimum supplied TVL in USD."
    minTvlUsd: Float
    """
    Include pools withheld from public rankings — empty markets (TVL below the
    floor) and absurd rates. Raw-data escape hatch: OFF by default, so every
    ordinary query is filtered before sorting, counting and pagination.
    """
    includeIneligible: Boolean
    "ISO date string — start of range (inclusive). Defaults to last 30 days."
    from: String
    to: String
    range: String
  }

  # ─── Queries ──────────────────────────────────────────────────────────────────

  """
  One stretch during which a pool was listed by its protocol.

  Half-open: \`activatedAt <= t < deactivatedAt\`. A null \`deactivatedAt\` means the
  pool is listed right now.
  """
  type AvailabilityPeriod {
    activatedAt: DateTime!
    "null = still listed."
    deactivatedAt: DateTime
    "How the boundary was established — product-sync | migration."
    detectedBy: String!
  }

  type Query {
    """
    A pool's listing history, oldest first.

    Ask for this alongside a time series when you intend to PLOT it. The series has
    no rows for hours the pool was not listed, so a chart that simply connects its
    points will draw a straight line across a stretch where the market did not
    exist. Split the series on these boundaries and draw one segment per period.

    It is also the only way to tell the two kinds of hole apart: data we failed to
    collect (a defect — it gets healed) versus a pool that was not there (not a
    defect — there is nothing to heal).
    """
    productAvailability(productId: String!): [AvailabilityPeriod!]!
    "Hourly APY time series for supply products. \`first\` is capped at 500."
    supplyApyHourly(
      filters: HourlyFilters
      first: Int = 100
      skip: Int = 0
      orderBy: SupplyApyOrderBy = time
      orderDirection: OrderDirection = asc
    ): SupplyHourlyResponse!
    "Daily aggregated APY for supply products. \`first\` is capped at 500."
    supplyApyDaily(
      filters: DailyFilters
      first: Int = 100
      skip: Int = 0
      orderBy: SupplyApyOrderBy = time
      orderDirection: OrderDirection = asc
    ): SupplyDailyResponse!
    "Hourly APY time series for borrow pools. \`first\` is capped at 500."
    borrowApyHourly(
      filters: BorrowHourlyFilters
      first: Int = 100
      skip: Int = 0
      orderBy: BorrowApyOrderBy = time
      orderDirection: OrderDirection = asc
    ): BorrowHourlyResponse!
    "Daily aggregated APY for borrow pools. \`first\` is capped at 500."
    borrowApyDaily(
      filters: BorrowDailyFilters
      first: Int = 100
      skip: Int = 0
      orderBy: BorrowApyOrderBy = time
      orderDirection: OrderDirection = asc
    ): BorrowDailyResponse!

    """
    The single most recent snapshot per supply product, across the whole
    catalogue — the "best markets right now" query. Only products with a reading
    in the last 6 hours are returned; a stale APY is worse than a missing one.
    """
    latestSupplyApy(
      filters: LatestFilters
      first: Int = 100
      skip: Int = 0
      orderBy: SupplyApyOrderBy = apyNet
      orderDirection: OrderDirection = desc
    ): SupplyHourlyResponse!
    """
    The single most recent snapshot per borrow product, across the whole
    catalogue — the "cheapest borrow right now" query. Defaults to net APY
    ascending: borrow net is a cost (base + fees − rewards), so the lowest is the
    best, the reverse of latestSupplyApy. Only products with a reading in the last
    6 hours are returned; a stale rate is worse than a missing one.
    """
    latestBorrowApy(
      filters: LatestBorrowFilters
      first: Int = 100
      skip: Int = 0
      orderBy: BorrowApyOrderBy = apyNet
      orderDirection: OrderDirection = asc
    ): BorrowHourlyResponse!

    "The product registry. \`first\` is capped at 500."
    products(
      filters: ProductFilters
      first: Int = 100
      skip: Int = 0
    ): ProductsResponse!
    """
    Distinct assets / chains / protocols that exist, with counts. Call this first:
    it is what stops a client from guessing a filter value that does not exist.
    """
    productFacets(filters: ProductFilters): ProductFacets!
  }
`

export const schema = createSchema({
  typeDefs,
  resolvers,
})
