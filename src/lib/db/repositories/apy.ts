import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { MAX_PRODUCT_IDS, clampPage } from '@/lib/db/pagination'
import { db } from '@/lib/db/postgres'
import {
  apyDaily,
  apyHourly,
  productDisplayFlags,
  products,
} from '@/lib/db/schema'
import type {
  BorrowMarketState,
  RewardItem,
  SpotPayload,
  SupplyMarketState,
} from '@/lib/db/types'

/**
 * Build a parenthesized `($1, $2, …)` list for `col IN (...)`.
 * neon-http does not bind a JS array as a Postgres array, so `= ANY($1)` fails
 * with "op ANY/ALL (array) requires array on right side". Expanding to IN works.
 * Caller must guard against empty input.
 */
function inList(values: string[]) {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )})`
}

// ─── Hourly running-mean upsert ─────────────────────────────────────────────

/** Columns averaged with the incremental-mean formula on conflict. */
const MEAN_COLUMNS = [
  'apy_base',
  'apy_rewards',
  'apy_fees',
  'apy_net',
  'supply_assets',
  'supply_assets_usd',
  'utilization_rate',
  'asset_price_usd',
  'borrow_assets',
  'borrow_assets_usd',
  'collateral_assets_usd',
  'price_collateral_in_loan_asset',
] as const

/**
 * Emits `col = <running mean>` for each averaged column.
 * NULL-safe: if either side is NULL, keep the non-null one (matches old $cond logic).
 *   new_avg = (old*count + new) / (count+1)
 */
function meanSetClause() {
  const parts = MEAN_COLUMNS.map(
    (c) => sql`${sql.raw(c)} = CASE
      WHEN apy_hourly.${sql.raw(c)} IS NULL THEN excluded.${sql.raw(c)}
      WHEN excluded.${sql.raw(c)} IS NULL THEN apy_hourly.${sql.raw(c)}
      ELSE (apy_hourly.${sql.raw(c)} * apy_hourly.quality_count + excluded.${sql.raw(c)})
           / (apy_hourly.quality_count + 1)
    END`
  )
  return sql.join(parts, sql`, `)
}

/**
 * Rows per multi-row upsert. Kept small so a single statement stays well under
 * the neon-http request-payload cap (the backfill hit it at ~2000 rows) and the
 * Postgres 65535-param bind limit (250 × 20 = 5000).
 */
const UPSERT_CHUNK = 250

/** One VALUES tuple for the bulk hourly upsert. */
function hourlyValueTuple(p: SpotPayload, hour: Date, slotTime: Date) {
  const isSupply = p.kind === 'supply'
  const sm = p.market as SupplyMarketState
  const bm = p.market as BorrowMarketState
  return sql`(
    ${p.productId}, ${hour},
    ${p.apy.base}, ${p.apy.rewards}, ${p.apy.fees}, ${p.apy.net},
    ${JSON.stringify(p.apy.rewardItems)}::jsonb,
    ${isSupply ? sm.supplyAssets : bm.supplyAssets},
    ${isSupply ? sm.supplyAssetsUsd : bm.supplyAssetsUsd},
    ${p.market.utilizationRate}, ${p.market.assetPriceUsd},
    ${isSupply ? null : bm.borrowAssets},
    ${isSupply ? null : bm.borrowAssetsUsd},
    ${isSupply ? null : (bm.collateralAssetsUsd ?? null)},
    ${isSupply ? null : (bm.priceCollateralInLoanAsset ?? null)},
    1, 6, ${slotTime}, ${slotTime}, 'building'
  )`
}

/**
 * Only collect what the catalogue actually lists.
 *
 * The spot adapters and the catalogue fetchers enumerate their protocols
 * independently, and they DISAGREE. Two ways:
 *
 *   - Aave's spot collector emits a borrow snapshot for every reserve, while the
 *     catalogue (correctly) registers a borrow product only when
 *     `borrowingState === 'ENABLED'`. Result: ~18,500 rows a week of borrow rates
 *     for reserves nobody can borrow from, for product ids that have no `products`
 *     row at all.
 *   - A pool delisted by its provider keeps being collected until someone notices.
 *
 * Both kinds of row are invisible to every read path (they all INNER JOIN
 * products), so they were pure waste — and they made the availability history lie,
 * since a delisted pool went on producing observations after its period closed.
 *
 * Guarding here rather than in each adapter: this is the single write path for
 * spot data, so a new protocol cannot forget it.
 */
async function listedProductIds(): Promise<Set<string>> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.active, true))
  return new Set(rows.map((r) => r.id))
}

/**
 * Upsert many products' hourly rolling-average rows in chunked multi-row
 * statements. Each row's running mean resolves independently against its own
 * `excluded` values. ProductIds within a slot are unique, so no row is touched
 * twice per statement.
 */
export async function upsertHourlySlots(
  payloads: SpotPayload[],
  hour: Date,
  slotTime: Date
): Promise<number> {
  // One observation per product per slot. Some adapters (Compound) emit the
  // same Comet productId once per collateral; collapse to the last occurrence
  // so a single multi-row statement never touches the same key twice
  // (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a second time").
  const all = Array.from(
    new Map(payloads.map((p) => [p.productId, p])).values()
  )

  const listed = await listedProductIds()
  // An empty catalogue means the products table is broken, not that every pool was
  // delisted. Collecting a superfluous row is recoverable; silently dropping a
  // whole slot for every product is not — so fail open, and make it loud.
  const deduped =
    listed.size === 0 ? all : all.filter((p) => listed.has(p.productId))
  if (listed.size === 0) {
    console.error(
      '[apy:upsert] products catalogue is empty — collecting unfiltered'
    )
  } else if (deduped.length < all.length) {
    // Now that every protocol's collector and catalogue share ONE listing rule
    // (lib/protocols/*/listing.ts), this should be zero on every slot. A non-zero
    // count means the two enumerations have drifted apart again — the exact fault
    // that quietly wrote ~18,500 orphan rows a week. It is not routine, so it is
    // logged as the error it is: the drop itself is harmless (the rows are
    // unreadable anyway), but the divergence upstream is not.
    console.error(
      `[apy:upsert] ENUMERATION DRIFT — ${all.length - deduped.length} snapshots for products the catalogue does not list. ` +
        `The collector and the catalogue sync disagree; check lib/protocols/*/listing.ts.`
    )
  }

  for (let i = 0; i < deduped.length; i += UPSERT_CHUNK) {
    const chunk = deduped.slice(i, i + UPSERT_CHUNK)
    const rows = chunk.map((p) => hourlyValueTuple(p, hour, slotTime))
    await db.execute(sql`
      INSERT INTO apy_hourly (
        product_id, hour,
        apy_base, apy_rewards, apy_fees, apy_net, reward_items,
        supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
        borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset,
        quality_count, quality_expected_count, quality_first_slot, quality_last_slot, quality_status
      ) VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT (product_id, hour) DO UPDATE SET
        ${meanSetClause()},
        reward_items = excluded.reward_items,
        quality_count = apy_hourly.quality_count + 1,
        quality_last_slot = excluded.quality_last_slot,
        quality_status = CASE WHEN apy_hourly.quality_count + 1 >= 6 THEN 'complete' ELSE 'building' END
    `)
  }
  return deduped.length
}

/** Upsert a single product's hourly row (thin wrapper over the batch path). */
export async function upsertHourlySlot(
  payload: SpotPayload,
  hour: Date,
  slotTime: Date
): Promise<void> {
  await upsertHourlySlots([payload], hour, slotTime)
}

// ─── Daily aggregation (one set-based statement) ────────────────────────────

/**
 * Aggregate all hourly rows in [windowStart, windowEnd) into apy_daily,
 * one row per product, in a single statement. reward_items = last slot of the day.
 * Idempotent: re-running the same day replaces rows and bumps quality_revision.
 *
 * Joined to `products` so an hourly row with no catalogue entry produces no
 * daily row. `upsertHourlySlots` and `backfillDailyRows` both guard this way;
 * this one did not, and 110,388 orphan hourly rows (an Aave listing-predicate
 * drift, closed 2026-07-13) turned into fresh orphan daily rows every time a
 * past day was re-aggregated — 1,739 of them in a single maintenance run.
 *
 * The guard is EXISTENCE, deliberately not `active = true`: a pool delisted
 * yesterday must still get its last hours aggregated. Only a product that was
 * never in the catalogue is dropped.
 */
export async function aggregateDaily(
  windowStart: Date,
  windowEnd: Date,
  computedAt: Date
): Promise<number> {
  const res = await db.execute(sql`
    WITH agg AS (
      SELECT
        h.product_id,
        avg(h.apy_base)    AS apy_base,
        avg(h.apy_rewards) AS apy_rewards,
        avg(h.apy_fees)    AS apy_fees,
        avg(h.apy_net)     AS apy_net,
        avg(h.supply_assets)     AS supply_assets,
        avg(h.supply_assets_usd) AS supply_assets_usd,
        avg(h.utilization_rate)  AS utilization_rate,
        avg(h.asset_price_usd)   AS asset_price_usd,
        avg(h.borrow_assets)     AS borrow_assets,
        avg(h.borrow_assets_usd) AS borrow_assets_usd,
        avg(h.collateral_assets_usd) AS collateral_assets_usd,
        avg(h.price_collateral_in_loan_asset) AS price_collateral_in_loan_asset,
        count(*) AS actual_count,
        (array_agg(h.reward_items ORDER BY h.hour DESC))[1] AS reward_items
      FROM apy_hourly h
      JOIN products p ON p.id = h.product_id
      WHERE h.hour >= ${windowStart} AND h.hour < ${windowEnd}
      GROUP BY h.product_id
    )
    INSERT INTO apy_daily (
      product_id, date, apy_base, apy_rewards, apy_fees, apy_net, reward_items,
      supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
      borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset,
      quality_actual_count, quality_expected_count, quality_completeness, quality_status,
      quality_revision, quality_computed_at
    )
    SELECT
      product_id, ${windowStart}, apy_base, apy_rewards, apy_fees, apy_net, reward_items,
      supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
      borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset,
      actual_count, 24, least(actual_count::float / 24, 1),
      CASE WHEN actual_count >= 24 THEN 'complete'
           WHEN actual_count >= 12 THEN 'partial' ELSE 'missing' END,
      0, ${computedAt}
    FROM agg
    ON CONFLICT (product_id, date) DO UPDATE SET
      apy_base = excluded.apy_base, apy_rewards = excluded.apy_rewards,
      apy_fees = excluded.apy_fees, apy_net = excluded.apy_net,
      reward_items = excluded.reward_items,
      supply_assets = excluded.supply_assets, supply_assets_usd = excluded.supply_assets_usd,
      utilization_rate = excluded.utilization_rate, asset_price_usd = excluded.asset_price_usd,
      borrow_assets = excluded.borrow_assets, borrow_assets_usd = excluded.borrow_assets_usd,
      collateral_assets_usd = excluded.collateral_assets_usd,
      price_collateral_in_loan_asset = excluded.price_collateral_in_loan_asset,
      quality_actual_count = excluded.quality_actual_count,
      quality_completeness = excluded.quality_completeness,
      quality_status = excluded.quality_status,
      quality_computed_at = excluded.quality_computed_at,
      quality_revision = apy_daily.quality_revision + 1
  `)
  return res.rowCount ?? 0
}

// ─── One-time daily backfill (ADD-ONLY) ─────────────────────────────────────

/**
 * One authoritative daily reading sourced from a protocol's own DAY-interval
 * history (getApyHistory) — NOT an aggregate of our hourly slots. Market-state
 * fields are optional: a provider whose history carries only rates (Morpho
 * markets) leaves them undefined → stored as NULL ("unknown"), never a false 0.
 */
export interface DailyBackfillInput {
  productId: string
  /** Any instant within the day; floored to midnight UTC on write. */
  date: Date
  apy: {
    base: number
    rewards: number
    fees: number
    net: number
    rewardItems: unknown[]
  }
  market?: {
    supplyAssets?: number | null
    supplyAssetsUsd?: number | null
    utilizationRate?: number | null
    assetPriceUsd?: number | null
    borrowAssets?: number | null
    borrowAssetsUsd?: number | null
    collateralAssetsUsd?: number | null
    priceCollateralInLoanAsset?: number | null
  }
}

/** Midnight-UTC boundary for a day — matches the apy_daily `date` convention. */
function floorUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Composite key "productId|<midnight-UTC ISO>" for existence diffing. */
export function dailyKey(productId: string, date: Date): string {
  return `${productId}|${floorUtcDay(date).toISOString()}`
}

/**
 * The (product_id, date) pairs that ALREADY exist in apy_daily for these
 * products within [from, to]. Lets a dry run report how many rows a backfill
 * would actually add vs skip, without writing anything.
 */
export async function existingDailyKeys(
  productIds: string[],
  from: Date,
  to: Date
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set()
  const keys = new Set<string>()
  for (let i = 0; i < productIds.length; i += MAX_PRODUCT_IDS) {
    const chunk = productIds.slice(i, i + MAX_PRODUCT_IDS)
    const rows = await db
      .select({ productId: apyDaily.productId, date: apyDaily.date })
      .from(apyDaily)
      .where(
        and(
          inArray(apyDaily.productId, chunk),
          gte(apyDaily.date, from),
          lte(apyDaily.date, to)
        )
      )
    for (const r of rows) keys.add(dailyKey(r.productId, r.date))
  }
  return keys
}

function dailyBackfillTuple(r: DailyBackfillInput, computedAt: Date) {
  const a = r.apy
  const m = r.market ?? {}
  // quality: one complete daily reading from the provider (expected = actual =
  // 1), so it is never flagged low-quality — distinct from a 24-hourly aggregate.
  return sql`(
    ${r.productId}, ${floorUtcDay(r.date)},
    ${a.base}, ${a.rewards}, ${a.fees}, ${a.net},
    ${JSON.stringify(a.rewardItems ?? [])}::jsonb,
    ${m.supplyAssets ?? null}, ${m.supplyAssetsUsd ?? null}, ${m.utilizationRate ?? null}, ${m.assetPriceUsd ?? null},
    ${m.borrowAssets ?? null}, ${m.borrowAssetsUsd ?? null}, ${m.collateralAssetsUsd ?? null}, ${m.priceCollateralInLoanAsset ?? null},
    1, 1, 1, 'complete', 0, ${computedAt}
  )`
}

/**
 * Backfill daily rows from provider history. ADD-ONLY: ON CONFLICT
 * (product_id, date) DO NOTHING — never overwrites a row the daily aggregation
 * (or a prior backfill) already wrote. Guarded to the active catalogue, and
 * deduped to the last reading per (productId, day) so one statement never
 * touches the same key twice. Returns the number of rows actually inserted.
 */
export async function backfillDailyRows(
  inputs: DailyBackfillInput[],
  computedAt: Date
): Promise<number> {
  if (inputs.length === 0) return 0

  const listed = await listedProductIds()
  const byKey = new Map<string, DailyBackfillInput>()
  for (const p of inputs) {
    if (listed.size > 0 && !listed.has(p.productId)) continue
    byKey.set(dailyKey(p.productId, p.date), p)
  }
  const rows = [...byKey.values()]

  let written = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const tuples = chunk.map((r) => dailyBackfillTuple(r, computedAt))
    const res = await db.execute(sql`
      INSERT INTO apy_daily (
        product_id, date, apy_base, apy_rewards, apy_fees, apy_net, reward_items,
        supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
        borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset,
        quality_actual_count, quality_expected_count, quality_completeness, quality_status,
        quality_revision, quality_computed_at
      ) VALUES ${sql.join(tuples, sql`, `)}
      ON CONFLICT (product_id, date) DO NOTHING
    `)
    written += res.rowCount ?? 0
  }
  return written
}

// ─── Market-state patch (historical backfill from a subgraph) ───────────────

/** The market columns a history backfill can fill in on an existing daily row. */
const PATCHABLE_MARKET_COLUMNS = [
  'supply_assets',
  'supply_assets_usd',
  'utilization_rate',
  'asset_price_usd',
  'borrow_assets',
  'borrow_assets_usd',
] as const

/**
 * One day of market state for an existing apy_daily row. Every field is
 * optional: `undefined`/`null` means "not known from this source" and leaves the
 * stored value untouched — a backfill must never turn a real reading into a 0,
 * nor a genuine unknown into a fabricated one.
 */
export interface DailyMarketPatch {
  productId: string
  /** Any instant within the day; floored to midnight UTC to match the PK. */
  date: Date
  supplyAssets?: number | null
  supplyAssetsUsd?: number | null
  utilizationRate?: number | null
  assetPriceUsd?: number | null
  borrowAssets?: number | null
  borrowAssetsUsd?: number | null
}

function marketPatchTuple(p: DailyMarketPatch) {
  return sql`(
    ${p.productId}::text, ${floorUtcDay(p.date)}::timestamptz,
    ${p.supplyAssets ?? null}::double precision,
    ${p.supplyAssetsUsd ?? null}::double precision,
    ${p.utilizationRate ?? null}::double precision,
    ${p.assetPriceUsd ?? null}::double precision,
    ${p.borrowAssets ?? null}::double precision,
    ${p.borrowAssetsUsd ?? null}::double precision
  )`
}

/**
 * Fill missing market state on daily rows that already exist. UPDATE-only — a
 * (product_id, date) with no row is skipped, because apy_* columns are NOT NULL
 * and this source carries no rates.
 *
 * Default is FILL-ONLY: `COALESCE(existing, incoming)`, so a value aggregated
 * from our own hourly slots always wins over a backfilled one, and only genuine
 * NULLs are written. Pass `overwrite` to let the incoming value win instead
 * (still NULL-safe — an incoming NULL never erases a stored reading).
 *
 * Returns the number of rows actually changed.
 */
export async function patchDailyMarketState(
  patches: DailyMarketPatch[],
  opts: { overwrite?: boolean } = {}
): Promise<number> {
  if (patches.length === 0) return 0

  // Last patch wins per key so one statement never updates a row twice.
  const byKey = new Map<string, DailyMarketPatch>()
  for (const p of patches) byKey.set(dailyKey(p.productId, p.date), p)
  const rows = [...byKey.values()]

  const set = PATCHABLE_MARKET_COLUMNS.map((c) =>
    opts.overwrite
      ? sql`${sql.raw(c)} = COALESCE(v.${sql.raw(c)}, d.${sql.raw(c)})`
      : sql`${sql.raw(c)} = COALESCE(d.${sql.raw(c)}, v.${sql.raw(c)})`
  )
  // Touch only rows the patch would actually change, so rowCount is meaningful.
  const changes = PATCHABLE_MARKET_COLUMNS.map((c) =>
    opts.overwrite
      ? sql`(v.${sql.raw(c)} IS NOT NULL AND d.${sql.raw(c)} IS DISTINCT FROM v.${sql.raw(c)})`
      : sql`(d.${sql.raw(c)} IS NULL AND v.${sql.raw(c)} IS NOT NULL)`
  )

  let changed = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const res = await db.execute(sql`
      UPDATE apy_daily d
      SET ${sql.join(set, sql`, `)}
      FROM (VALUES ${sql.join(chunk.map(marketPatchTuple), sql`, `)}) AS v(
        product_id, date, ${sql.raw(PATCHABLE_MARKET_COLUMNS.join(', '))}
      )
      WHERE d.product_id = v.product_id
        AND d.date = v.date
        AND (${sql.join(changes, sql` OR `)})
    `)
    changed += res.rowCount ?? 0
  }
  return changed
}

// ─── Enrichment reads (used by products.actions) ────────────────────────────

export interface LatestHourly {
  apyNet: number
  /** Reward component of that same row — 0 when the market pays no incentives. */
  apyRewards: number
}

/** Latest hourly net APY per product (replaces $sort+$group $first). */
export async function latestHourly(
  productIds: string[]
): Promise<Map<string, LatestHourly>> {
  const map = new Map<string, LatestHourly>()
  if (productIds.length === 0) return map
  const res = await db.execute(sql`
    SELECT DISTINCT ON (product_id) product_id, apy_net, apy_rewards
    FROM apy_hourly
    WHERE product_id IN ${inList(productIds)}
    ORDER BY product_id, hour DESC
  `)
  for (const r of res.rows as {
    product_id: string
    apy_net: number
    apy_rewards: number
  }[]) {
    map.set(r.product_id, {
      apyNet: r.apy_net,
      apyRewards: Number(r.apy_rewards) || 0,
    })
  }
  return map
}

export interface ApyEnrichment {
  apyDaily?: number
  apyMonthly?: number
  apyYearly?: number
  apyRewardsDaily?: number
  apyRewardsMonthly?: number
  apyRewardsYearly?: number
}

/**
 * 7d / 30d / 365d net-APY windowed averages, matching the 7D / 1M / 1Y horizon
 * labels exposed in the UI. Each value is the mean of whatever daily rows exist
 * in its window and is returned as soon as ≥1 row is present — partial coverage
 * is surfaced rather than hidden, so freshly-tracked products still show a
 * value instead of a dash.
 */
export async function apyEnrichments(
  productIds: string[]
): Promise<Map<string, ApyEnrichment>> {
  const map = new Map<string, ApyEnrichment>()
  if (productIds.length === 0) return map
  const res = await db.execute(sql`
    SELECT
      product_id,
      avg(apy_net) FILTER (WHERE date >= now() - interval '7 days')   AS avg7,
      count(*)     FILTER (WHERE date >= now() - interval '7 days')   AS n7,
      avg(apy_net) FILTER (WHERE date >= now() - interval '30 days')  AS avg30,
      count(*)     FILTER (WHERE date >= now() - interval '30 days')  AS n30,
      avg(apy_net)                                                    AS avg365,
      count(*)                                                        AS n365,
      avg(apy_rewards) FILTER (WHERE date >= now() - interval '7 days')  AS rew7,
      avg(apy_rewards) FILTER (WHERE date >= now() - interval '30 days') AS rew30,
      avg(apy_rewards)                                                   AS rew365
    FROM apy_daily
    WHERE product_id IN ${inList(productIds)} AND date >= now() - interval '365 days'
    GROUP BY product_id
  `)
  for (const r of res.rows as {
    product_id: string
    avg7: number | null
    n7: number | string
    avg30: number | null
    n30: number | string
    avg365: number | null
    n365: number | string
    rew7: number | null
    rew30: number | null
    rew365: number | null
  }[]) {
    // Postgres numeric can hold 'NaN' (e.g. a bad upstream APR→APY); avg() over
    // it yields NaN. Coerce any non-finite value to undefined so the UI shows a
    // dash instead of "NaN%".
    const avg = (v: number | null) => {
      const n = v != null ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    map.set(r.product_id, {
      apyDaily: Number(r.n7) >= 1 ? avg(r.avg7) : undefined,
      apyMonthly: Number(r.n30) >= 1 ? avg(r.avg30) : undefined,
      apyYearly: Number(r.n365) >= 1 ? avg(r.avg365) : undefined,
      apyRewardsDaily: Number(r.n7) >= 1 ? avg(r.rew7) : undefined,
      apyRewardsMonthly: Number(r.n30) >= 1 ? avg(r.rew30) : undefined,
      apyRewardsYearly: Number(r.n365) >= 1 ? avg(r.rew365) : undefined,
    })
  }
  return map
}

// ─── Filtered read (JOIN products — replaces the regex path) ────────────────

export interface ApyFilters {
  kind: 'supply' | 'borrow'
  productIds?: string[] // exact products.id PK batch match — no parsing
  protocol?: string // 'aave' | 'morpho' | 'compound' (or '<provider>_<version>')
  market?: string // protocol_name, e.g. "AaveV3Ethereum"
  chainId?: number
  asset?: string // asset symbol — NOW actually applied
  collateral?: string // borrow only; matched against collaterals jsonb
  minTvlUsd?: number // floor on supply_assets_usd — thin markets are APY noise
  /**
   * Raw-data escape hatch: include pools withheld by display eligibility (empty
   * markets, absurd rates). Off by default, so every public list is filtered
   * unless a caller deliberately asks for the unvarnished table.
   */
  includeIneligible?: boolean
  from?: Date
  to?: Date
}

/** Window an hourly read falls back to when the caller gives no `from`. */
const HOURLY_DEFAULT_HOURS = 24

/** Window a daily read falls back to when the caller gives no `from`. */
const DAILY_DEFAULT_DAYS = 30

/**
 * Sortable fields. `time` maps to `hour` (hourly) or `date` (daily), so one
 * union serves both grains. `borrowAssetsUsd` is only meaningful for borrow.
 */
export type ApyOrderBy =
  | 'time'
  | 'apyNet'
  | 'apyBase'
  | 'supplyAssetsUsd'
  | 'utilizationRate'
  | 'borrowAssetsUsd'

export interface Page {
  first: number
  skip: number
  orderBy: ApyOrderBy
  orderDir: 'asc' | 'desc'
}

/**
 * The orderable columns, structurally. Both apy_hourly and apy_daily satisfy
 * this, as does the `latest` CTE — their column sets are identical apart from
 * the time column, which is passed separately.
 */
interface OrderableColumns {
  apyNet: AnyPgColumn
  apyBase: AnyPgColumn
  supplyAssetsUsd: AnyPgColumn
  utilizationRate: AnyPgColumn
  borrowAssetsUsd: AnyPgColumn
}

/** Resolve an ApyOrderBy to the real column on the table being read. */
function orderColumn(
  table: OrderableColumns,
  timeCol: AnyPgColumn,
  orderBy: ApyOrderBy
): AnyPgColumn {
  switch (orderBy) {
    case 'time':
      return timeCol
    case 'apyNet':
      return table.apyNet
    case 'apyBase':
      return table.apyBase
    case 'supplyAssetsUsd':
      return table.supplyAssetsUsd
    case 'utilizationRate':
      return table.utilizationRate
    case 'borrowAssetsUsd':
      return table.borrowAssetsUsd
  }
}

/**
 * ORDER BY with the tiebreaker, and with NULLs pushed to the end.
 *
 * Postgres defaults to NULLS FIRST on DESC, so `orderBy: supplyAssetsUsd,
 * desc` would rank markets whose TVL is unknown ABOVE the genuinely largest
 * ones. NULL means "we don't know", which is never the top of a "best" list.
 *
 * productId breaks ties: many products share an APY to float precision, and an
 * unstable sort makes offset pagination repeat or skip rows across pages.
 */
function orderClause(
  col: AnyPgColumn,
  dir: 'asc' | 'desc',
  productIdCol: AnyPgColumn
) {
  return [
    dir === 'desc' ? sql`${col} DESC NULLS LAST` : sql`${col} ASC NULLS LAST`,
    asc(productIdCol),
  ]
}

/**
 * Exclude rows whose core APY is NaN.
 *
 * Postgres `double precision` can hold NaN (a bad upstream APR→APY lands there),
 * and Postgres sorts NaN ABOVE every real number — so a single NaN row would top
 * every `orderBy: apyNet desc` ranking. It would also break the response
 * outright: the GraphQL `Float!` serializer throws on NaN, failing the whole
 * query rather than the one row. A NaN APY is not data; it never leaves the DB.
 */
function finiteApy(
  table: OrderableColumns & { apyRewards: AnyPgColumn; apyFees: AnyPgColumn }
) {
  return sql`
    ${table.apyNet} <> 'NaN'::float8 AND
    ${table.apyBase} <> 'NaN'::float8 AND
    ${table.apyRewards} <> 'NaN'::float8 AND
    ${table.apyFees} <> 'NaN'::float8
  `
}

/** Shared product-level predicates. Typed, indexed columns only — no productId parsing. */
function productConds(f: ApyFilters) {
  const conds = [eq(products.kind, f.kind)]
  if (f.productIds?.length)
    conds.push(inArray(products.id, f.productIds.slice(0, MAX_PRODUCT_IDS)))
  if (f.protocol) conds.push(eq(products.provider, f.protocol.split('_')[0]))
  if (f.market) conds.push(eq(products.protocolName, f.market))
  if (f.chainId) conds.push(eq(products.chainId, f.chainId))
  if (f.asset) conds.push(eq(products.assetSymbol, f.asset))
  if (f.collateral)
    conds.push(
      sql`${products.collaterals} @> ${JSON.stringify([{ symbol: f.collateral }])}::jsonb`
    )
  // Display eligibility. Applied here, at the product level, so that BOTH the
  // count query and the data query inherit it and therefore agree — an ineligible
  // pool must not distort the sort order, inflate countTotal, or occupy a slot in
  // a page. Filtering it out client-side would leave all three wrong.
  if (!f.includeIneligible) conds.push(displayEligible())
  return conds
}

/** No current entry in the withheld-pools projection. See lib/display-eligibility. */
function displayEligible() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${productDisplayFlags}
    WHERE ${productDisplayFlags.productId} = ${products.id}
  )`
}

/**
 * Returns rows joined with their product, plus a total count, for a hourly/daily query.
 * Filters hit indexed columns on products — no regex, no full scan.
 *
 * The time window defaults HERE rather than in the resolver: without a `from`,
 * an `orderBy: apyNet` sorts and counts every row ever retained (180 days ×
 * ~700 products). Any caller that forgets to bound the range would otherwise
 * silently reintroduce that scan.
 */
export async function queryApy(
  grain: 'hourly' | 'daily',
  f: ApyFilters,
  page: Page
) {
  // Column names are identical across both tables; cast for unified typing.
  const table = (grain === 'hourly' ? apyHourly : apyDaily) as typeof apyHourly
  const timeCol = grain === 'hourly' ? apyHourly.hour : apyDaily.date
  const applied = clampPage(page)

  const from =
    f.from ??
    new Date(
      Date.now() -
        (grain === 'hourly'
          ? HOURLY_DEFAULT_HOURS * 60 * 60 * 1000
          : DAILY_DEFAULT_DAYS * 24 * 60 * 60 * 1000)
    )

  const conds = productConds(f)
  conds.push(finiteApy(table))
  if (f.minTvlUsd != null) conds.push(gte(table.supplyAssetsUsd, f.minTvlUsd))
  conds.push(gte(timeCol, from))
  if (f.to) conds.push(lte(timeCol, f.to))
  const where = and(...conds)

  const col = orderColumn(table, timeCol, page.orderBy)
  const order = orderClause(col, page.orderDir, table.productId)

  const [countRows, rows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .innerJoin(products, eq(table.productId, products.id))
      .where(where),
    db
      .select({ row: table, product: products })
      .from(table)
      .innerJoin(products, eq(table.productId, products.id))
      .where(where)
      .orderBy(...order)
      .limit(applied.first)
      .offset(applied.skip),
  ])

  return { rows, countTotal: countRows[0]?.n ?? 0, applied }
}

// ─── Latest snapshot across all products ─────────────────────────────────────

/**
 * Hours of history the "latest" snapshot may draw from. Bounds the DISTINCT ON
 * scan, and naturally drops products whose pipeline has stalled — a stale APY is
 * worse than a missing one. A pipeline outage therefore looks like "fewer
 * markets" here; /status is where gaps are surfaced.
 */
const LATEST_WINDOW_HOURS = 6

/**
 * The most recent hourly row per product, across the whole catalogue, sorted and
 * paginated by any field. This is what answers "the best markets right now" —
 * `latestHourly` can't, because it takes explicit productIds and so discovers
 * nothing.
 *
 * DISTINCT ON must sort by product_id first, which rules out sorting by APY in
 * the same statement — hence the CTE: reduce to one row per product, then order
 * the result.
 */
export async function queryLatestApy(f: ApyFilters, page: Page) {
  const since = new Date(Date.now() - LATEST_WINDOW_HOURS * 60 * 60 * 1000)
  const applied = clampPage(page)

  const latest = db.$with('latest').as(
    db
      .selectDistinctOn([apyHourly.productId])
      .from(apyHourly)
      .where(and(gte(apyHourly.hour, since), finiteApy(apyHourly)))
      .orderBy(apyHourly.productId, desc(apyHourly.hour))
  )

  const conds = productConds(f)
  if (f.minTvlUsd != null) conds.push(gte(latest.supplyAssetsUsd, f.minTvlUsd))
  const where = and(...conds)

  const col = orderColumn(latest, latest.hour, page.orderBy)
  const order = orderClause(col, page.orderDir, latest.productId)

  const [countRows, rows] = await Promise.all([
    db
      .with(latest)
      .select({ n: sql<number>`count(*)::int` })
      .from(latest)
      .innerJoin(products, eq(latest.productId, products.id))
      .where(where),
    db
      .with(latest)
      .select()
      .from(latest)
      .innerJoin(products, eq(latest.productId, products.id))
      .where(where)
      .orderBy(...order)
      .limit(applied.first)
      .offset(applied.skip),
  ])

  return {
    rows: rows.map((r) => ({ row: r.latest, product: r.products })),
    countTotal: countRows[0]?.n ?? 0,
    applied,
  }
}

// ─── Single-product time series ──────────────────────────────────────────────

/** One slot of a product's full APY + market-state history. */
export interface ProductApyHistoryPoint {
  t: Date
  base: number
  rewards: number
  fees: number
  net: number
  rewardItems: RewardItem[]
  supplyAssetsUsd: number | null
  borrowAssetsUsd: number | null
  collateralAssetsUsd: number | null
  utilizationRate: number | null
  assetPriceUsd: number | null
}

/**
 * Full APY + market-state series for a single product, ordered oldest→newest.
 * Reads our own pipeline tables (apy_hourly / apy_daily) by exact productId, so
 * values match the products table exactly. Powers the product detail drawer.
 */
export async function productApyHistory(
  productId: string,
  grain: 'hourly' | 'daily',
  from?: Date
): Promise<ProductApyHistoryPoint[]> {
  // Columns are identical across both tables; cast for unified typing.
  const table = (grain === 'hourly' ? apyHourly : apyDaily) as typeof apyHourly
  const timeCol = grain === 'hourly' ? apyHourly.hour : apyDaily.date

  const conds = [eq(table.productId, productId)]
  if (from) conds.push(gte(timeCol, from))

  const rows = await db
    .select({
      t: timeCol,
      base: table.apyBase,
      rewards: table.apyRewards,
      fees: table.apyFees,
      net: table.apyNet,
      rewardItems: table.rewardItems,
      supplyAssetsUsd: table.supplyAssetsUsd,
      borrowAssetsUsd: table.borrowAssetsUsd,
      collateralAssetsUsd: table.collateralAssetsUsd,
      utilizationRate: table.utilizationRate,
      assetPriceUsd: table.assetPriceUsd,
    })
    .from(table)
    .where(and(...conds))
    .orderBy(asc(timeCol))
    .limit(10_000)

  // Postgres double precision can store 'NaN' (a bad upstream APR→APY). A slot
  // with a non-finite core APY would render as "NaN%" and break the chart area,
  // so drop it — the line connects across the gap (charts use connectNulls).
  // Nullable market-state numerics are coerced NaN→null individually.
  const finite = (v: number | null): number | null =>
    v != null && Number.isFinite(v) ? v : null

  return rows.flatMap((r) =>
    [r.base, r.rewards, r.fees, r.net].every(Number.isFinite)
      ? [
          {
            t: new Date(r.t),
            base: r.base,
            rewards: r.rewards,
            fees: r.fees,
            net: r.net,
            rewardItems: (r.rewardItems as RewardItem[]) ?? [],
            supplyAssetsUsd: finite(r.supplyAssetsUsd),
            borrowAssetsUsd: finite(r.borrowAssetsUsd),
            collateralAssetsUsd: finite(r.collateralAssetsUsd),
            utilizationRate: finite(r.utilizationRate),
            assetPriceUsd: finite(r.assetPriceUsd),
          },
        ]
      : []
  )
}
