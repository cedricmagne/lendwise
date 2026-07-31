import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

// ─── products ─────────────────────────────────────────────────────────────────
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(), // colon slug, e.g. "aave:v3:ethereum:reserve:0x..:supply"
    active: boolean('active').notNull().default(true),
    kind: text('kind').notNull(), // 'supply' | 'borrow'
    provider: text('provider').notNull(), // 'aave' | 'morpho' | 'compound'
    productType: text('product_type').notNull(), // 'reserve' | 'market' | 'vault'
    version: text('version').notNull(),
    protocolName: text('protocol_name').notNull(), // "AaveV3Ethereum"
    chainId: integer('chain_id').notNull(),
    chainName: text('chain_name').notNull(),
    assetSymbol: text('asset_symbol').notNull(),
    assetName: text('asset_name').notNull(),
    assetAddress: text('asset_address').notNull(),
    assetDecimals: integer('asset_decimals').notNull(),
    protocolAddress: text('protocol_address').notNull(),
    subgraphUrl: text('subgraph_url'),
    meta: jsonb('meta').notNull(), // 6-variant protocol.meta
    collaterals: jsonb('collaterals'), // borrow only; null for supply
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('products_provider_asset_kind').on(t.provider, t.assetSymbol, t.kind),
    index('products_name_asset_kind').on(t.protocolName, t.assetSymbol, t.kind),
    index('products_active_chain').on(t.active, t.chainId),
  ]
)

// ─── apy_hourly ─────────────────────────────────────────────────────────────────
export const apyHourly = pgTable(
  'apy_hourly',
  {
    productId: text('product_id').notNull(),
    hour: timestamp('hour', { withTimezone: true }).notNull(),
    apyBase: doublePrecision('apy_base').notNull(),
    apyRewards: doublePrecision('apy_rewards').notNull(),
    apyFees: doublePrecision('apy_fees').notNull(),
    apyNet: doublePrecision('apy_net').notNull(),
    rewardItems: jsonb('reward_items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    supplyAssets: doublePrecision('supply_assets'),
    supplyAssetsUsd: doublePrecision('supply_assets_usd'),
    utilizationRate: doublePrecision('utilization_rate'),
    assetPriceUsd: doublePrecision('asset_price_usd'),
    borrowAssets: doublePrecision('borrow_assets'),
    borrowAssetsUsd: doublePrecision('borrow_assets_usd'),
    collateralAssetsUsd: doublePrecision('collateral_assets_usd'),
    priceCollateralInLoanAsset: doublePrecision(
      'price_collateral_in_loan_asset'
    ),
    // ─── Last observation — amounts NOT averaged ───────────────────────────
    // The columns above are running means over the hour, which is what we
    // want for a rate and not for an amount. These carry the last value
    // observed of the slot: it's what the /supply and /borrow tables
    // display. Null on the rows the heal INSERTS (a "missing" gap), which
    // repairs past hours and so has no "last" observation to offer. Not on
    // the ones it repairs by UPDATE (an "incomplete" gap, HEAL_UPDATE_SET in
    // gaps.ts): that path leaves `last_*` as-is.
    lastSupplyAssets: doublePrecision('last_supply_assets'),
    lastSupplyAssetsUsd: doublePrecision('last_supply_assets_usd'),
    lastBorrowAssets: doublePrecision('last_borrow_assets'),
    lastBorrowAssetsUsd: doublePrecision('last_borrow_assets_usd'),
    lastCollateralAssetsUsd: doublePrecision('last_collateral_assets_usd'),
    lastUtilizationRate: doublePrecision('last_utilization_rate'),
    lastAssetPriceUsd: doublePrecision('last_asset_price_usd'),
    qualityCount: integer('quality_count').notNull(),
    qualityExpectedCount: integer('quality_expected_count')
      .notNull()
      .default(6),
    qualityFirstSlot: timestamp('quality_first_slot', {
      withTimezone: true,
    }).notNull(),
    qualityLastSlot: timestamp('quality_last_slot', {
      withTimezone: true,
    }).notNull(),
    qualityStatus: text('quality_status').notNull(), // 'building' | 'complete' | 'partial'
    healed: boolean('healed').notNull().default(false),
    healSource: text('heal_source'),
    healedFrom: text('healed_from'),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.hour] }),
    index('apy_hourly_hour').on(t.hour),
  ]
)

// ─── apy_daily ─────────────────────────────────────────────────────────────────
export const apyDaily = pgTable(
  'apy_daily',
  {
    productId: text('product_id').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(), // midnight UTC
    apyBase: doublePrecision('apy_base').notNull(),
    apyRewards: doublePrecision('apy_rewards').notNull(),
    apyFees: doublePrecision('apy_fees').notNull(),
    apyNet: doublePrecision('apy_net').notNull(),
    rewardItems: jsonb('reward_items')
      .notNull()
      .default(sql`'[]'::jsonb`),
    supplyAssets: doublePrecision('supply_assets'),
    supplyAssetsUsd: doublePrecision('supply_assets_usd'),
    utilizationRate: doublePrecision('utilization_rate'),
    assetPriceUsd: doublePrecision('asset_price_usd'),
    borrowAssets: doublePrecision('borrow_assets'),
    borrowAssetsUsd: doublePrecision('borrow_assets_usd'),
    collateralAssetsUsd: doublePrecision('collateral_assets_usd'),
    priceCollateralInLoanAsset: doublePrecision(
      'price_collateral_in_loan_asset'
    ),
    qualityActualCount: integer('quality_actual_count').notNull(),
    qualityExpectedCount: integer('quality_expected_count')
      .notNull()
      .default(24),
    qualityCompleteness: doublePrecision('quality_completeness').notNull(),
    qualityStatus: text('quality_status').notNull(),
    qualityRevision: integer('quality_revision').notNull().default(0),
    qualityComputedAt: timestamp('quality_computed_at', {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.date] }),
    index('apy_daily_status_date').on(t.qualityStatus, t.date),
  ]
)

// ─── product_availability_periods ───────────────────────────────────────────────
/**
 * Append-only history of when each product was listed. See lib/db/product-availability.
 *
 * `products.active` stays as the present-tense catalogue flag; this table is the
 * past tense. A product may be listed, delisted and relisted any number of times
 * — each cycle is its own row, and closing one never rewrites an older one.
 *
 * A partial unique index (in the migration, not expressible here) enforces at most
 * one OPEN period per product: `... (product_id) WHERE deactivated_at IS NULL`.
 */
export const productAvailabilityPeriods = pgTable(
  'product_availability_periods',
  {
    productId: text('product_id').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    /** null = open. Half-open interval: activated_at <= hour < deactivated_at. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    detectedBy: text('detected_by').notNull(), // 'product-sync' | 'migration'
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.activatedAt] }),
    index('product_availability_periods_lookup').on(
      t.productId,
      t.activatedAt,
      t.deactivatedAt
    ),
  ]
)

// ─── pipeline_reports ───────────────────────────────────────────────────────────
export const pipelineReports = pgTable(
  'pipeline_reports',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    // 'reconcile' since 2026-07-24. 'gap-detection' | 'gap-healing' are the
    // pre-cutover types, still present in history — the two jobs they came from
    // are now the detect and repair steps of one run.
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('pipeline_reports_type_created').on(t.type, t.createdAt)]
)

// Inferred row types — replace the hand-written types in lib/db/types.ts
export type ProductRow = typeof products.$inferSelect
export type ApyHourlyRow = typeof apyHourly.$inferSelect
export type ApyHourlyInsert = typeof apyHourly.$inferInsert
export type ApyDailyRow = typeof apyDaily.$inferSelect
