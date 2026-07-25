/**
 * Cross-provider USD enrichment for history points — a PIPELINE step, not an
 * adapter concern.
 *
 * Some protocols' history sources give token amounts without a usable price:
 * Aave's subgraphs record `priceInUsd = 0` for most reserves (no oracle answer
 * they track), so a whole year of TVL would render blank despite the amounts
 * being known. But another provider's `apy_daily` row for the SAME asset on the
 * SAME day usually does have `asset_price_usd` — Compound and Morpho both carry
 * deep price history for the majors.
 *
 * That lookup reads OUR database, so it cannot live inside an adapter (an
 * adapter talks to its protocol, never to our tables). It is generic across
 * providers and chains: give it points, get points whose *Usd columns are
 * filled wherever a real same-day observation existed.
 *
 * Two rules the implementation will not bend:
 *   - A price is NEVER carried across days. A stale price stretched over a
 *     quiet stretch fabricates a TVL curve; a NULL is an honest gap.
 *   - Only the loan-asset columns are derived. `collateralAssetsUsd` is a
 *     different token and is left exactly as the adapter set it.
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

/** Postgres parameter budget per statement — mirrors the repository's chunking. */
const CHUNK = 40

type AnyMarket = Partial<SupplyMarketState & BorrowMarketState>

function utcDayMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export interface UsdEnrichmentReport {
  /** Points that already carried a price from their own source. */
  ownPrice: number
  /** Points priced from another provider's same-day row. */
  crossProvider: number
  /** Points left without a price — their *Usd columns stay NULL. */
  unpriced: number
}

/**
 * Resolve `products.id → asset_symbol` for the ids present in `points`.
 * The productId is opaque — the symbol comes from the catalogue by JOIN, never
 * from splitting the slug (CLAUDE.md).
 */
async function symbolsFor(productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK)
    const res = await db.execute(sql`
      SELECT id, asset_symbol FROM products
      WHERE id IN (${sql.join(
        chunk.map((v) => sql`${v}`),
        sql`, `
      )})
    `)
    for (const r of res.rows as { id: string; asset_symbol: string }[]) {
      out.set(r.id, r.asset_symbol)
    }
  }
  return out
}

/**
 * Same-day USD price per (symbol, day) observed in apy_daily. Averaged across
 * providers: several rows for one asset-day are independent observations of the
 * same price, and their mean is the least arbitrary pick.
 *
 * No provider is excluded. Morpho used to be, and the exclusion mattered: it
 * derived its price as `totalAssetsUsd / totalAssets` with a RAW (undivided)
 * `totalAssets`, so every stored Morpho price was off by 10^decimals and a
 * single Morpho row on an asset-day halved the average (WETH: (1918 + ~0)/2 ≈
 * 959). Both ends of that are now closed — the adapter reads the oracle price
 * and divides by 10^decimals (`morpho/v1/apy-spot.ts`), and the rows written
 * before that deployment were migrated by `scripts/fix-amount-units.ts`.
 * Trusting Morpho again is what gives a price to the assets only it lists.
 */
async function pricesFor(
  symbols: string[],
  from: Date,
  to: Date
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK)
    const res = await db.execute(sql`
      SELECT p.asset_symbol AS sym, d.date AS date, avg(d.asset_price_usd) AS price
      FROM apy_daily d
      JOIN products p ON p.id = d.product_id
      WHERE p.asset_symbol IN (${sql.join(
        chunk.map((v) => sql`${v}`),
        sql`, `
      )})
        AND d.asset_price_usd > 0
        AND d.date >= ${from} AND d.date <= ${to}
      GROUP BY 1, 2
    `)
    for (const r of res.rows as {
      sym: string
      date: string
      price: number
    }[]) {
      out.set(`${r.sym}|${utcDayMs(new Date(r.date))}`, Number(r.price))
    }
  }
  return out
}

/**
 * Fill `assetPriceUsd` / `supplyAssetsUsd` / `borrowAssetsUsd` on points that
 * have token amounts but no price of their own. Points are returned in input
 * order; those needing nothing are returned untouched.
 */
export async function enrichPointsWithUsd(
  points: HistoryDataPoint[]
): Promise<{ points: HistoryDataPoint[]; report: UsdEnrichmentReport }> {
  const report: UsdEnrichmentReport = {
    ownPrice: 0,
    crossProvider: 0,
    unpriced: 0,
  }
  if (points.length === 0) return { points, report }

  // Only points that know an amount but not a price can be enriched at all.
  // Everything else still has to be CLASSIFIED below — a point with neither a
  // price nor an amount is unpriced, not "priced by its own source" — so the
  // classification loop always runs; only the queries are skipped.
  const candidates = points.filter((p) => {
    const m = p.market as AnyMarket
    return (
      m.assetPriceUsd == null &&
      (m.supplyAssets != null || m.borrowAssets != null)
    )
  })

  let symbols = new Map<string, string>()
  let prices = new Map<string, number>()
  if (candidates.length > 0) {
    symbols = await symbolsFor([...new Set(candidates.map((p) => p.productId))])
    const times = candidates.map((p) => p.timestamp.getTime())
    prices = await pricesFor(
      [...new Set([...symbols.values()])],
      new Date(Math.min(...times)),
      new Date(Math.max(...times))
    )
  }

  const enriched = points.map((p) => {
    const m = p.market as AnyMarket
    if (m.assetPriceUsd != null) {
      report.ownPrice++
      return p
    }
    if (m.supplyAssets == null && m.borrowAssets == null) {
      report.unpriced++
      return p
    }

    const symbol = symbols.get(p.productId)
    const price = symbol
      ? prices.get(`${symbol}|${utcDayMs(p.timestamp)}`)
      : undefined
    if (price == null) {
      report.unpriced++
      return p
    }
    report.crossProvider++

    return {
      ...p,
      market: {
        ...m,
        assetPriceUsd: price,
        supplyAssetsUsd:
          m.supplyAssetsUsd ??
          (m.supplyAssets == null ? null : m.supplyAssets * price),
        borrowAssetsUsd:
          m.borrowAssetsUsd ??
          (m.borrowAssets == null ? null : m.borrowAssets * price),
      } as SupplyMarketState | BorrowMarketState,
    }
  })

  return { points: enriched, report }
}
