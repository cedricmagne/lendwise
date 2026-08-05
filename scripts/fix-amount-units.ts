/**
 * One-shot migration: put every stored amount in WHOLE TOKEN units.
 *
 * Compound and Morpho stored their protocols' RAW base units while Aave stored
 * human ones, so `supply_assets` / `borrow_assets` carried two different scales
 * with nothing saying which (fixed at ingestion by chantier C). This corrects
 * the rows written before that fix, in BOTH tables:
 *
 *   - apy_hourly is pruned to 180d and self-heals, but reconcile re-aggregates
 *     the last 7d from it every night, and the charts read it directly — so a
 *     raw hourly row corrupts a daily average and shows a wrong amount for up to
 *     180 days. It must be fixed, not waited out.
 *   - apy_daily is the deep, permanent series. It must be fixed for all history.
 *
 * ── Why the selector is TEMPORAL, not a data check ───────────────────────────
 *
 * For Compound the amount is raw while the price is a sound oracle value, so
 * `amount × price` overshoots `amountUsd` and a coherence check would find the
 * raw rows. But for Morpho the amount is raw AND the price was derived with a
 * RAW denominator, so the price is 10^decimals too small: the two errors CANCEL
 * and `amount × price ≈ amountUsd` holds whether raw or fixed. No row-internal
 * check can tell them apart (WBTC at 8 decimals × ~$100k defeats every
 * magnitude threshold too). The unambiguous fact is TIME: a row whose slot is
 * before chantier C shipped was built entirely from raw spots.
 *
 * So `--before <iso>` is required, and it is the deploy timestamp of chantier C.
 * `apy_hourly.hour` / `apy_daily.date` strictly before it → raw, fix it. The
 * hour/day straddling the deploy is a raw+human mix; it is LEFT ALONE (one
 * hour, ages out) rather than corrupted.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────
 *
 * Because the selector is temporal, the fix (divide) is NOT self-guarding — a
 * second --write would divide again. A marker in `data_migrations` records a
 * completed run and a second one is refused. To UNDO: multiply the same rows by
 * 10^decimals (and, for Morpho, divide the price).
 *
 * DRY-RUN BY DEFAULT. Pass --write to persist.
 *
 * Usage:
 *   pnpm fix:amount-units -- --before 2026-07-25T15:00:00Z              # dry run
 *   pnpm fix:amount-units -- --before 2026-07-25T15:00:00Z --write
 *   pnpm fix:amount-units -- --before <iso> --table daily --write       # one table
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'

type Table = 'apy_hourly' | 'apy_daily'
type Provider = 'morpho' | 'compound'

interface Affected {
  productId: string
  provider: Provider
  decimals: number
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const timeCol = (t: Table) => (t === 'apy_hourly' ? sql`hour` : sql`date`)
const tableRef = (t: Table) =>
  t === 'apy_hourly' ? sql`apy_hourly` : sql`apy_daily`

async function ensureMarkerTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS data_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function alreadyApplied(name: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT 1 FROM data_migrations WHERE name = ${name}`
  )
  return res.rows.length > 0
}

/** Products whose amounts may be raw, with the decimals that scale them. */
async function affectedProducts(only?: Provider): Promise<Affected[]> {
  const res = await db.execute(sql`
    SELECT id, provider, asset_decimals
    FROM products
    WHERE provider IN ('morpho', 'compound')
      AND asset_decimals IS NOT NULL
      ${only ? sql`AND provider = ${only}` : sql``}
  `)
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    productId: r.id as string,
    provider: r.provider as Provider,
    decimals: Number(r.asset_decimals),
  }))
}

/** The SET that rescales one raw row to whole tokens. */
function fixAssignments(p: Affected) {
  const factor = 10 ** p.decimals
  if (p.provider === 'morpho') {
    // Divide the amounts, and lift the price back to its true scale.
    return sql`
      supply_assets = supply_assets / ${factor},
      borrow_assets = borrow_assets / ${factor},
      asset_price_usd = asset_price_usd * ${factor}`
  }
  return sql`
    supply_assets = supply_assets / ${factor},
    borrow_assets = borrow_assets / ${factor}`
}

async function countBefore(
  t: Table,
  p: Affected,
  before: string
): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM ${tableRef(t)}
    WHERE product_id = ${p.productId}
      AND ${timeCol(t)} < date_trunc(${t === 'apy_hourly' ? 'hour' : 'day'}, ${before}::timestamptz)
  `)
  return (res.rows as { n: number }[])[0]?.n ?? 0
}

async function fixBefore(
  t: Table,
  p: Affected,
  before: string
): Promise<number> {
  const res = await db.execute(sql`
    UPDATE ${tableRef(t)}
    SET ${fixAssignments(p)}
    WHERE product_id = ${p.productId}
      AND ${timeCol(t)} < date_trunc(${t === 'apy_hourly' ? 'hour' : 'day'}, ${before}::timestamptz)
  `)
  return res.rowCount ?? 0
}

async function run(
  table: Table,
  products: Affected[],
  before: string,
  write: boolean
): Promise<void> {
  const per: Record<Provider, { products: number; rows: number }> = {
    morpho: { products: 0, rows: 0 },
    compound: { products: 0, rows: 0 },
  }
  for (const p of products) {
    const n = write
      ? await fixBefore(table, p, before)
      : await countBefore(table, p, before)
    if (n > 0) {
      per[p.provider].products += 1
      per[p.provider].rows += n
    }
  }
  console.log(`\n  ${table}`)
  for (const provider of ['morpho', 'compound'] as Provider[]) {
    const s = per[provider]
    console.log(
      `    ${provider.padEnd(9)} ${String(s.rows).padStart(9)} rows across ${s.products} products`
    )
  }
}

/** Before/after on one broken WETH row, so the effect is inspectable. */
async function sample(before: string): Promise<void> {
  const res = await db.execute(sql`
    SELECT p.provider, p.asset_symbol, p.asset_decimals,
           d.supply_assets AS amount, d.asset_price_usd AS price,
           d.supply_assets_usd AS usd
    FROM apy_daily d JOIN products p ON p.id = d.product_id
    WHERE p.provider IN ('morpho', 'compound')
      AND p.asset_symbol = 'WETH'
      AND d.supply_assets > 0 AND d.supply_assets_usd > 0
      AND d.date < date_trunc('day', ${before}::timestamptz)
    ORDER BY p.provider, d.date DESC LIMIT 4
  `)
  const rows = res.rows as Record<string, unknown>[]
  if (rows.length === 0) return
  console.log(
    '\n  Sample of WETH rows before the cutoff (amount → whole tokens):'
  )
  for (const r of rows) {
    const dec = Number(r.asset_decimals)
    const amt = Number(r.amount)
    const provider = String(r.provider)
    const priceAfter =
      provider === 'morpho' ? Number(r.price) * 10 ** dec : Number(r.price)
    console.log(
      `    ${provider.padEnd(9)} amount ${amt.toExponential(2)} → ${(amt / 10 ** dec).toExponential(2)}   price ${Number(r.price).toExponential(2)} → ${priceAfter.toExponential(2)}   usd ${Number(r.usd).toFixed(0)}`
    )
  }
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write')
  const before = argValue('--before')
  if (!before || Number.isNaN(Date.parse(before))) {
    console.error(
      'Required: --before <iso>  (the chantier C deploy timestamp, e.g. 2026-07-25T15:00:00Z)'
    )
    process.exit(1)
  }
  const only = argValue('--provider') as Provider | undefined
  const tableArg = argValue('--table')
  const tables: Table[] =
    tableArg === 'hourly'
      ? ['apy_hourly']
      : tableArg === 'daily'
        ? ['apy_daily']
        : ['apy_hourly', 'apy_daily']

  const marker = `fix-amount-units:${before}`

  console.log(`\n📏 Amount-unit migration ${write ? '(WRITE)' : '(dry run)'}`)
  console.log(`   cutoff (raw before): ${before}`)

  if (write) {
    await ensureMarkerTable()
    if (await alreadyApplied(marker)) {
      console.error(
        `\n⛔ Already applied for cutoff ${before}. Refusing to divide twice.\n` +
          `   (marker '${marker}' in data_migrations)\n`
      )
      process.exit(1)
    }
  }

  const products = await affectedProducts(only)
  console.log(`   ${products.length} candidate products`)

  if (!write) await sample(before)

  for (const t of tables) await run(t, products, before, write)

  if (write) {
    await db.execute(
      sql`INSERT INTO data_migrations (name) VALUES (${marker})
          ON CONFLICT (name) DO NOTHING`
    )
    console.log('\n  ✅ Done and marker recorded.\n')
  } else {
    console.log('\n  Dry run — nothing written. Re-run with --write.\n')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('❌', err)
  process.exit(1)
})
