import { type SQL, inArray, sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { products } from '@/lib/db/schema'
import type { HistoryTarget } from '@/lib/protocols/core/types'

export interface GapRow {
  productId: string
  hour: Date
}
export interface IncompleteRow {
  productId: string
  hour: Date
  count: number
}

/**
 * "Was product `p` listed at hour `h`?" — the single definition of expected,
 * shared by gap detection and /status so the heatmap and the healer can never
 * disagree about what was owed.
 *
 * Replaces `p.active AND h >= p.created_at`, which was wrong in both directions:
 * a delisted pool stayed expected forever (phantom gaps, and heal attempts against
 * a market that no longer exists), while its genuinely-collected past hours
 * disappeared from the denominator the moment it was delisted.
 *
 * @param p  the products alias, e.g. `sql.raw('p')`
 * @param h  the hour being tested — a column (`sql.raw('b.hour')`) or a bound
 *           value (`sql\`${hour}\``)
 */
export function expectedAt(p: SQL, h: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM product_availability_periods pap
    WHERE pap.product_id = ${p}.id
      AND pap.activated_at <= ${h}
      AND (pap.deactivated_at IS NULL OR ${h} < pap.deactivated_at)
  )`
}

/**
 * Missing slots: hour boundaries a product was listed for but produced no
 * apy_hourly row. Pure set difference via generate_series.
 *
 * Only products with at least one row in the window are considered ("collected") —
 * a product that never reported at all is a catalogue problem, not a gap.
 */
export async function findGaps(
  windowStart: Date,
  windowEnd: Date
): Promise<GapRow[]> {
  const res = await db.execute(sql`
    WITH boundaries AS (
      SELECT generate_series(${windowStart}::timestamptz, ${windowEnd}::timestamptz - interval '1 hour', interval '1 hour') AS hour
    ),
    collected AS (
      SELECT DISTINCT product_id FROM apy_hourly
      WHERE hour >= ${windowStart} AND hour < ${windowEnd}
    ),
    expected AS (
      SELECT p.id AS product_id, b.hour
      FROM products p
      JOIN collected c ON c.product_id = p.id
      CROSS JOIN boundaries b
      WHERE ${expectedAt(sql.raw('p'), sql.raw('b.hour'))}
    )
    SELECT e.product_id, e.hour
    FROM expected e
    LEFT JOIN apy_hourly h ON h.product_id = e.product_id AND h.hour = e.hour
    WHERE h.product_id IS NULL
    ORDER BY e.hour
  `)
  return (res.rows as { product_id: string; hour: Date }[]).map((r) => ({
    productId: r.product_id,
    hour: new Date(r.hour),
  }))
}

/**
 * Incomplete slots: rows present but quality_count < 6 and not healed.
 *
 * Joined to availability for the same reason findGaps is: the final hour of a
 * delisted pool is usually short (the market vanished mid-hour), and healing it
 * means refetching a market that no longer exists. It is not a defect — nothing
 * was owed for an hour the pool had already left.
 */
export async function findIncomplete(
  windowStart: Date,
  windowEnd: Date
): Promise<IncompleteRow[]> {
  const res = await db.execute(sql`
    SELECT h.product_id, h.hour, h.quality_count
    FROM apy_hourly h
    JOIN products p ON p.id = h.product_id
    WHERE h.hour >= ${windowStart} AND h.hour < ${windowEnd}
      AND h.quality_count < 6 AND h.healed = false
      AND ${expectedAt(sql.raw('p'), sql.raw('h.hour'))}
    ORDER BY h.hour
  `)
  return (
    res.rows as { product_id: string; hour: Date; quality_count: number }[]
  ).map((r) => ({
    productId: r.product_id,
    hour: new Date(r.hour),
    count: r.quality_count,
  }))
}

/** Distinct products with at least one row in the window ("collected" set). */
export async function collectedProductCount(
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(DISTINCT product_id)::int AS n
    FROM apy_hourly
    WHERE hour >= ${windowStart} AND hour < ${windowEnd}
  `)
  return (res.rows as { n: number }[])[0]?.n ?? 0
}

/** Mark stale 'building' rows (past hours, count<6) as 'partial'. Returns count. */
export async function markStale(
  windowStart: Date,
  windowEnd: Date
): Promise<number> {
  const res = await db.execute(sql`
    UPDATE apy_hourly SET quality_status = 'partial'
    WHERE hour >= ${windowStart} AND hour < ${windowEnd}
      AND quality_count < 6 AND quality_status = 'building'
  `)
  return res.rowCount ?? 0
}

export interface HealRow {
  productId: string
  hour: Date
  apy: {
    base: number
    rewards: number
    fees: number
    net: number
    rewardItems: unknown[]
  }
  market: Record<string, number | null>
  source: 'refetch' | 'nearest-neighbor'
  healedFrom: string
  gapKind: 'missing' | 'incomplete'
}

/**
 * Rows per multi-row insert. 250 × 23 cols = 5750 params — well under the
 * Postgres 65535-param bind limit and the neon-http request-payload cap.
 */
const HEAL_CHUNK = 250

/** ON CONFLICT clause for incomplete gaps — overwrite the partial row. */
const HEAL_UPDATE_SET = sql`DO UPDATE SET apy_base=excluded.apy_base, apy_rewards=excluded.apy_rewards, apy_fees=excluded.apy_fees, apy_net=excluded.apy_net, reward_items=excluded.reward_items, supply_assets=excluded.supply_assets, supply_assets_usd=excluded.supply_assets_usd, utilization_rate=excluded.utilization_rate, asset_price_usd=excluded.asset_price_usd, borrow_assets=excluded.borrow_assets, borrow_assets_usd=excluded.borrow_assets_usd, collateral_assets_usd=excluded.collateral_assets_usd, price_collateral_in_loan_asset=excluded.price_collateral_in_loan_asset, quality_count=excluded.quality_count, quality_status=excluded.quality_status, healed=true, heal_source=excluded.heal_source, healed_from=excluded.healed_from`

/** One VALUES tuple for the bulk heal insert. */
function healValueTuple(r: HealRow) {
  const m = r.market
  const count = r.source === 'refetch' ? 6 : 0
  const status = r.source === 'refetch' ? 'complete' : 'partial'
  return sql`(
    ${r.productId}, ${r.hour}, ${r.apy.base}, ${r.apy.rewards}, ${r.apy.fees}, ${r.apy.net},
    ${JSON.stringify(r.apy.rewardItems)}::jsonb,
    ${m.supplyAssets ?? null}, ${m.supplyAssetsUsd ?? null}, ${m.utilizationRate ?? null}, ${m.assetPriceUsd ?? null},
    ${m.borrowAssets ?? null}, ${m.borrowAssetsUsd ?? null}, ${m.collateralAssetsUsd ?? null}, ${m.priceCollateralInLoanAsset ?? null},
    ${count}, 6, ${r.hour}, ${r.hour}, ${status}, true, ${r.source}, ${r.healedFrom}
  )`
}

/** Keep the last row per (productId, hour) — ON CONFLICT can't touch a row twice in one statement. */
function dedupeHealRows(rows: HealRow[]): HealRow[] {
  return Array.from(
    new Map(
      rows.map((r) => [`${r.productId}|${r.hour.toISOString()}`, r])
    ).values()
  )
}

/**
 * Write healed rows in chunked multi-row statements (one round-trip per chunk
 * instead of per row — the per-row loop timed out the Vercel function once gap
 * counts reached the thousands). Split by conflict behavior:
 *   missing    → ON CONFLICT DO NOTHING (never clobber organic data)
 *   incomplete → ON CONFLICT DO UPDATE (overwrite the partial row)
 * Marks healed=true.
 */
export async function writeHealed(rows: HealRow[]): Promise<number> {
  const groups = [
    {
      rows: dedupeHealRows(rows.filter((r) => r.gapKind === 'missing')),
      conflict: sql`DO NOTHING`,
    },
    {
      rows: dedupeHealRows(rows.filter((r) => r.gapKind === 'incomplete')),
      conflict: HEAL_UPDATE_SET,
    },
  ]

  let written = 0
  for (const group of groups) {
    for (let i = 0; i < group.rows.length; i += HEAL_CHUNK) {
      const chunk = group.rows.slice(i, i + HEAL_CHUNK)
      const tuples = chunk.map(healValueTuple)
      const res = await db.execute(sql`
        INSERT INTO apy_hourly (
          product_id, hour, apy_base, apy_rewards, apy_fees, apy_net, reward_items,
          supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
          borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset,
          quality_count, quality_expected_count, quality_first_slot, quality_last_slot, quality_status,
          healed, heal_source, healed_from
        ) VALUES ${sql.join(tuples, sql`, `)}
        ON CONFLICT (product_id, hour) ${group.conflict}
      `)
      written += res.rowCount ?? 0
    }
  }
  return written
}

/** Donor rows for nearest-neighbor heal (Compound + fallback). */
export async function fetchDonors(
  productIds: string[],
  start: Date,
  end: Date
): Promise<Record<string, unknown>[]> {
  if (productIds.length === 0) return []
  // neon-http can't bind a JS array for ANY($1); expand to IN ($1,$2,…).
  const ids = sql`(${sql.join(
    productIds.map((v) => sql`${v}`),
    sql`, `
  )})`
  const res = await db.execute(sql`
    SELECT product_id, hour, apy_base, apy_rewards, apy_fees, apy_net, reward_items,
           supply_assets, supply_assets_usd, utilization_rate, asset_price_usd,
           borrow_assets, borrow_assets_usd, collateral_assets_usd, price_collateral_in_loan_asset
    FROM apy_hourly
    WHERE product_id IN ${ids} AND hour >= ${start} AND hour <= ${end}
  `)
  return res.rows as Record<string, unknown>[]
}

/**
 * The catalogue rows behind a set of productIds, as adapters want them.
 *
 * `meta` is forwarded untouched: it is the adapter's own vocabulary (the
 * market id, reserve address or cToken it wrote at getProducts time), and
 * handing it back is what lets a DELISTED product still be fetched by its own
 * identifier. Nothing here interprets it — the pipeline stays protocol-blind.
 *
 * Deliberately NOT filtered on `active`: a product dropped from the catalogue
 * is exactly the one whose history we can no longer reach any other way.
 */
export async function historyTargets(
  productIds: string[]
): Promise<HistoryTarget[]> {
  if (productIds.length === 0) return []
  const rows = await db
    .select({
      id: products.id,
      chainId: products.chainId,
      kind: products.kind,
      meta: products.meta,
    })
    .from(products)
    .where(inArray(products.id, productIds))

  return rows.map((r) => ({
    productId: r.id,
    chainId: r.chainId,
    kind: r.kind as 'supply' | 'borrow',
    meta: (r.meta ?? {}) as Record<string, unknown>,
  }))
}

/** productId → products.provider, resolved by exact id — NEVER by parsing. */
export async function productProviders(
  productIds: string[]
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map()
  const rows = await db
    .select({ id: products.id, provider: products.provider })
    .from(products)
    .where(inArray(products.id, productIds))
  return new Map(rows.map((r) => [r.id, r.provider]))
}

/** TTL replacement — delete hourly rows older than 180 days. Returns count. */
export async function pruneHourly(): Promise<number> {
  const res = await db.execute(
    sql`DELETE FROM apy_hourly WHERE hour < now() - interval '180 days'`
  )
  return res.rowCount ?? 0
}
