import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { clampPage } from '@/lib/db/pagination'
import { db } from '@/lib/db/postgres'
import { products } from '@/lib/db/schema'
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

/** Deactivate all currently-active products for the given providers. Returns count. */
export async function deactivateProviders(
  providers: string[]
): Promise<number> {
  if (providers.length === 0) return 0
  const updated = await db
    .update(products)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(inArray(products.provider, providers), eq(products.active, true))
    )
    .returning({ id: products.id })
  return updated.length
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
