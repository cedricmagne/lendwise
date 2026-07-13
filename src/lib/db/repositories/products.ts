import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { clampPage } from '@/lib/db/pagination'
import { db } from '@/lib/db/postgres'
import { productAvailabilityPeriods, products } from '@/lib/db/schema'
import type { Product } from '@/lib/db/types'

/** Map a fetched Product document (current Mongo-shaped object) → products row. */
function toRow(p: Product) {
  return {
    id: p._id,
    active: p.active ?? true,
    kind: p.kind,
    provider: p.protocol.provider,
    productType: p.protocol.type,
    version: p.protocol.version,
    protocolName: p.protocol.name,
    chainId: p.protocol.chain.id,
    chainName: p.protocol.chain.name,
    assetSymbol: p.asset.symbol,
    assetName: p.asset.name,
    assetAddress: p.asset.address,
    assetDecimals: p.asset.decimals,
    protocolAddress: p.protocol.address,
    subgraphUrl: p.protocol.subgraphUrl ?? null,
    meta: p.protocol.meta,
    collaterals: 'collaterals' in p ? p.collaterals : null,
    createdAt: p.createdAt ?? new Date(),
    updatedAt: new Date(),
  }
}

/** Upsert products by id. created_at set on insert only; everything else refreshed. */
export async function upsertProducts(items: Product[]): Promise<void> {
  if (items.length === 0) return
  const rows = items.map(toRow)
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(products)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: products.id,
        set: {
          active: sql`excluded.active`,
          kind: sql`excluded.kind`,
          provider: sql`excluded.provider`,
          productType: sql`excluded.product_type`,
          version: sql`excluded.version`,
          protocolName: sql`excluded.protocol_name`,
          chainId: sql`excluded.chain_id`,
          chainName: sql`excluded.chain_name`,
          assetSymbol: sql`excluded.asset_symbol`,
          assetName: sql`excluded.asset_name`,
          assetAddress: sql`excluded.asset_address`,
          assetDecimals: sql`excluded.asset_decimals`,
          protocolAddress: sql`excluded.protocol_address`,
          subgraphUrl: sql`excluded.subgraph_url`,
          meta: sql`excluded.meta`,
          collaterals: sql`excluded.collaterals`,
          updatedAt: sql`excluded.updated_at`,
          // created_at deliberately NOT in set → preserved from original insert
        },
      })
  }
}

export interface ProviderSyncResult {
  /** Products the provider returned that had no open availability period. */
  activated: number
  /** Products that were active but the provider no longer lists. */
  deactivated: number
  /** Returned products that were already open — the overwhelming majority. */
  unchanged: number
}

/**
 * Reconcile one provider's catalogue against what it actually returned.
 *
 * Replaces the old "deactivate the whole provider, then re-upsert to bring the
 * survivors back" sequence. That was destructive by construction: for the width of
 * the sync every pool of the provider was inactive, and — worse — it left no trace
 * of WHEN a pool came or went, so a delisting was indistinguishable from a
 * pipeline outage and the heal job kept trying to fabricate rows for markets that
 * no longer existed.
 *
 * Here nothing is torn down. Three disjoint cases, all keyed on exact product ids
 * (the slug is never parsed):
 *
 *   returned + open period      → untouched
 *   returned + no open period   → active = true, a NEW period opens (relisting)
 *   active + not returned       → active = false, its open period is CLOSED
 *
 * MUST only be called for a provider whose enumeration actually succeeded. An
 * empty list from a failed fetch would read as "the provider delisted everything"
 * and close every period it owns.
 *
 * The closing boundary is the hour AFTER the pool's last stored observation, not
 * the sync's own clock: the sync is a poll, not an event stream, so it learns about
 * a delisting up to an hour late. Closing at "now" would leave that hour expected
 * and missing — a phantom gap, and a heal attempt against a dead market.
 */
export async function syncProviderProducts(
  provider: string,
  fetchedIds: string[],
  syncStartedAt: Date
): Promise<ProviderSyncResult> {
  // Keyed on the OPEN PERIOD, not on `products.active`.
  //
  // These two say the same thing when all is well, but they are written by
  // different statements and they DO drift — three products were left `active =
  // false` with an open period, and a reconciliation driven by `active` never
  // looked at them again: not active, so never a candidate for closing; period
  // still open, so expected by gap detection and /status forever. Phantom gaps, and
  // a heal job refetching a market that no longer exists, in perpetuity.
  //
  // The period table is what every downstream reader actually consults, so it is
  // the thing to reconcile against. Doing so makes this self-healing: whatever
  // state the two columns are in, one run converges them.
  const open = await db
    .select({ id: productAvailabilityPeriods.productId })
    .from(productAvailabilityPeriods)
    .innerJoin(products, eq(products.id, productAvailabilityPeriods.productId))
    .where(
      and(
        eq(products.provider, provider),
        isNull(productAvailabilityPeriods.deactivatedAt)
      )
    )
  const openIds = new Set(open.map((r) => r.id))

  const returned = new Set(fetchedIds)
  const staleIds = [...openIds].filter((id) => !returned.has(id))

  if (staleIds.length > 0) {
    await db
      .update(products)
      .set({ active: false, updatedAt: syncStartedAt })
      .where(inArray(products.id, staleIds))

    const ids = sql`(${sql.join(
      staleIds.map((v) => sql`${v}`),
      sql`, `
    )})`
    // Correlated subquery, NOT `UPDATE … FROM`: a FROM-join without a join key
    // cross-joins and rewrites every row in the table.
    //
    // The boundary is the hour after the last hour the pool lived through WHOLE,
    // capped at the moment the catalogue stopped listing it, and never before the
    // period began. Each part of that earns its place:
    //
    //   + 1h — the sync is a poll, so it learns of a delisting up to an hour late.
    //     Closing at "now" would leave the intervening hours expected and empty: a
    //     phantom gap, and a heal attempt against a market that no longer exists.
    //   `quality_count >= 6` — the LAST hour of a pool's life is usually a partial
    //     one: the market vanished from the API mid-hour, so we collected 1 spot of
    //     6. Closing after it would mark that hour "expected" and score it
    //     incomplete — reporting a defect where there was none. The pool did not
    //     fail to report; it ceased to exist. Closing AT it drops a stub hour from
    //     the denominator and keeps every hour the pool actually lived through.
    //   `NOT healed` — a healed row is not evidence the market was alive. The heal
    //     job fabricated two nearest-neighbor rows for an frxUSD market two days
    //     AFTER it was delisted; a boundary drawn from max(hour) swallowed them and
    //     held the period open across a stretch the pool did not exist in.
    //   LEAST(…, syncStartedAt) — a hard cap. Whatever rows exist, a pool cannot be
    //     expected past the point its provider stopped listing it.
    await db.execute(sql`
      UPDATE product_availability_periods pap
      SET deactivated_at = GREATEST(
        LEAST(
          COALESCE(
            (SELECT date_trunc('hour', max(h.hour)) + interval '1 hour'
               FROM apy_hourly h
              WHERE h.product_id = pap.product_id
                AND NOT h.healed
                AND h.quality_count >= 6),
            ${syncStartedAt}
          ),
          ${syncStartedAt}
        ),
        pap.activated_at
      )
      WHERE pap.product_id IN ${ids}
        AND pap.deactivated_at IS NULL
    `)
  }

  // Anything returned without an open period is newly listed OR relisted after a
  // dead stretch. Both open a period; ON CONFLICT DO NOTHING absorbs the race
  // where two syncs overlap (the partial unique index would otherwise raise).
  let activated = 0
  if (fetchedIds.length > 0) {
    const ids = sql`(${sql.join(
      fetchedIds.map((v) => sql`${v}`),
      sql`, `
    )})`
    const res = await db.execute(sql`
      INSERT INTO product_availability_periods (product_id, activated_at, deactivated_at, detected_by)
      SELECT p.id, ${syncStartedAt}, NULL, 'product-sync'
      FROM products p
      WHERE p.id IN ${ids}
        AND NOT EXISTS (
          SELECT 1 FROM product_availability_periods pap
          WHERE pap.product_id = p.id AND pap.deactivated_at IS NULL
        )
      ON CONFLICT DO NOTHING
    `)
    activated = res.rowCount ?? 0
  }

  return {
    activated,
    deactivated: staleIds.length,
    unchanged: fetchedIds.length - activated,
  }
}

/** Active product ids (+ createdAt) — used by gap detection / status. */
export async function listActiveProducts(): Promise<
  { id: string; provider: string; kind: string; createdAt: Date }[]
> {
  return db
    .select({
      id: products.id,
      provider: products.provider,
      kind: products.kind,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(eq(products.active, true))
}

// ─── Public catalogue reads (GraphQL / MCP) ─────────────────────────────────

export interface ProductFilters {
  productId?: string // exact products.id PK match — no parsing
  kind?: 'supply' | 'borrow'
  protocol?: string // provider — aave | morpho | compound
  market?: string // protocol_name, e.g. "AaveV3Ethereum"
  chainId?: number
  asset?: string // asset symbol
  active?: boolean
}

/**
 * Predicates over typed, indexed columns only. The productId slug is never
 * parsed — it is irregular (morpho has no `:kind` suffix), so substring/regex
 * filtering on it is wrong by construction.
 */
function filterConds(f: ProductFilters) {
  const conds = []
  if (f.productId) conds.push(eq(products.id, f.productId))
  if (f.kind) conds.push(eq(products.kind, f.kind))
  if (f.protocol) conds.push(eq(products.provider, f.protocol))
  if (f.market) conds.push(eq(products.protocolName, f.market))
  if (f.chainId) conds.push(eq(products.chainId, f.chainId))
  if (f.asset) conds.push(eq(products.assetSymbol, f.asset))
  if (f.active != null) conds.push(eq(products.active, f.active))
  return conds.length > 0 ? and(...conds) : undefined
}

/**
 * Paginated product registry read, with a total count.
 *
 * Clamps its own page (via the shared `clampPage`) rather than trusting the
 * caller — a negative `first` reaches Postgres as `LIMIT -1` and 500s.
 */
export async function queryProducts(
  f: ProductFilters,
  page: { first: number; skip: number }
) {
  const where = filterConds(f)
  const applied = clampPage(page)

  const [countRows, rows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(where),
    db
      .select()
      .from(products)
      .where(where)
      .orderBy(asc(products.id))
      .limit(applied.first)
      .offset(applied.skip),
  ])

  return { rows, countTotal: countRows[0]?.n ?? 0, applied }
}

/**
 * A product's listing history, oldest first.
 *
 * Exists so an APY chart can BREAK its line instead of drawing one. A pool that
 * was delisted on the 3rd and relisted on the 9th has no rows in between; without
 * this, a chart joins the last point before to the first point after and invents a
 * six-day trend across a stretch where the market did not exist. With it, the
 * series is drawn as one segment per period.
 *
 * It also disambiguates the two reasons a series can have a hole — the pipeline
 * missed the data (a defect, and healable) versus the pool was not listed (not a
 * defect, and nothing to heal). Only the periods can tell them apart.
 */
export async function listAvailabilityPeriods(
  productId: string
): Promise<
  { activatedAt: Date; deactivatedAt: Date | null; detectedBy: string }[]
> {
  return db
    .select({
      activatedAt: productAvailabilityPeriods.activatedAt,
      deactivatedAt: productAvailabilityPeriods.deactivatedAt,
      detectedBy: productAvailabilityPeriods.detectedBy,
    })
    .from(productAvailabilityPeriods)
    .where(eq(productAvailabilityPeriods.productId, productId))
    .orderBy(asc(productAvailabilityPeriods.activatedAt))
}

export interface ProductFacets {
  assets: { symbol: string; count: number }[]
  chains: { id: number; name: string; count: number }[]
  protocols: { name: string; count: number }[]
}

/**
 * The distinct filter values that actually exist, with counts. One call and an
 * agent stops guessing asset symbols and chain names that aren't there.
 *
 * Chains group by chain_id, never chain_name — the latter is written
 * inconsistently by each adapter ("Ethereum" vs "ethereum", "op mainnet").
 * The returned `name` is resolved from the canonical id by the caller.
 */
export async function queryProductFacets(
  f: ProductFilters
): Promise<Omit<ProductFacets, 'chains'> & { chains: RawChainFacet[] }> {
  const where = filterConds(f)
  const n = sql<number>`count(*)::int`

  const [assets, chains, protocols] = await Promise.all([
    db
      .select({ symbol: products.assetSymbol, count: n })
      .from(products)
      .where(where)
      .groupBy(products.assetSymbol)
      .orderBy(desc(n), asc(products.assetSymbol)),
    db
      .select({
        id: products.chainId,
        // Any chain_name for this id — used only as a fallback display label.
        fallbackName: sql<string>`min(${products.chainName})`,
        count: n,
      })
      .from(products)
      .where(where)
      .groupBy(products.chainId)
      .orderBy(desc(n), asc(products.chainId)),
    db
      .select({ name: products.provider, count: n })
      .from(products)
      .where(where)
      .groupBy(products.provider)
      .orderBy(desc(n), asc(products.provider)),
  ])

  return { assets, chains, protocols }
}

export interface RawChainFacet {
  id: number
  fallbackName: string
  count: number
}
