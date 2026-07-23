/**
 * @file scripts/backfill-history.ts
 * One-time backfill of `apy_daily` from a protocol's own DAY-interval history
 * (adapter `getApyHistory`). Fills the deep history the 10-minute spot cron and
 * the gap-heal job never reach — heal skips every hour before a product's
 * createdAt, so a newly-added network otherwise starts with a flat chart.
 *
 * ADD-ONLY: rows are inserted with ON CONFLICT (product_id, date) DO NOTHING,
 * so organic daily rows (already aggregated from spot) are never overwritten —
 * only genuinely missing historical days are added.
 *
 * DRY-RUN BY DEFAULT: fetches, diffs against existing rows, and reports what it
 * WOULD insert. Pass --write to persist.
 *
 * Usage:
 *   pnpm backfill:history                              # dry run, morpho, default new chains, 365d
 *   pnpm backfill:history -- --chains 999,143          # dry run, specific chainIds
 *   pnpm backfill:history -- --protocol aave --days 90 # dry run, aave, 90-day window
 *   pnpm backfill:history -- --write                   # PERSIST to apy_daily
 */
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import {
  type DailyBackfillInput,
  backfillDailyRows,
  dailyKey,
  existingDailyKeys,
} from '@/lib/db/repositories/apy'
import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

// Networks added 2026-07-18 (commit e38331a) — first spot 2026-07-18T12:00Z.
const DEFAULT_NEW_CHAINS: Record<number, string> = {
  747474: 'katana',
  143: 'monad',
  988: 'stable',
  999: 'hyperevm',
  4217: 'tempo',
  4663: 'robinhood',
  130: 'unichain',
}

const PROTOCOL_ADAPTER: Record<string, keyof typeof YIELD_ADAPTERS> = {
  morpho: 'morpho_v1',
  aave: 'aave_v3',
}

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

/** Map a fetched history point onto the repository's add-only daily input. */
function toDailyInput(p: HistoryDataPoint): DailyBackfillInput {
  const m = p.market as Partial<SupplyMarketState & BorrowMarketState>
  return {
    productId: p.productId,
    date: p.timestamp,
    apy: {
      base: p.apy.base,
      rewards: p.apy.rewards,
      fees: p.apy.fees,
      net: p.apy.net,
      rewardItems: p.apy.rewardItems ?? [],
    },
    market: {
      supplyAssets: m.supplyAssets ?? null,
      supplyAssetsUsd: m.supplyAssetsUsd ?? null,
      utilizationRate: m.utilizationRate ?? null,
      assetPriceUsd: m.assetPriceUsd ?? null,
      borrowAssets: m.borrowAssets ?? null,
      borrowAssetsUsd: m.borrowAssetsUsd ?? null,
      collateralAssetsUsd: m.collateralAssetsUsd ?? null,
      priceCollateralInLoanAsset: m.priceCollateralInLoanAsset ?? null,
    },
  }
}

function networkOf(productId: string): string {
  return productId.split(':')[2] ?? 'unknown'
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const protocol = (arg(args, '--protocol') ?? 'morpho').toLowerCase()
  const days = Number(arg(args, '--days') ?? 365)
  const chainsArg = arg(args, '--chains')
  const chainIds = chainsArg
    ? chainsArg.split(',').map((s) => Number(s.trim()))
    : Object.keys(DEFAULT_NEW_CHAINS).map(Number)

  const adapterId = PROTOCOL_ADAPTER[protocol]
  if (!adapterId) {
    console.error(`Unknown --protocol "${protocol}". Use: morpho | aave`)
    process.exit(1)
  }

  const now = Math.floor(Date.now() / 1000)
  const startTs = now - days * 86400
  const from = new Date(startTs * 1000)
  const to = new Date(now * 1000)

  console.log(`\n🔄 History backfill ${write ? '(WRITE)' : '(dry run)'}`)
  console.log(`  Protocol: ${protocol}`)
  console.log(`  Chains:   ${chainIds.join(', ')}`)
  console.log(`  Window:   ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${days}d)\n`)

  const adapter = await YIELD_ADAPTERS[adapterId]()
  if (!adapter.getApyHistory) {
    console.error(`Adapter ${adapterId} has no getApyHistory.`)
    process.exit(1)
  }

  const points = await adapter.getApyHistory({
    startTimestamp: startTs,
    endTimestamp: now,
    interval: 'DAY',
    chainIds,
  })
  console.log(`Fetched ${points.length} history points.`)

  const inputs = points.map(toDailyInput)
  const productIds = [...new Set(inputs.map((r) => r.productId))]

  // Diff against what already exists so the dry run reports true inserts.
  const existing = await existingDailyKeys(productIds, from, to)
  const newRows = inputs.filter((r) => !existing.has(dailyKey(r.productId, r.date)))

  // Per-network summary of what WOULD be added.
  const byNet = new Map<string, { products: Set<string>; add: number }>()
  for (const r of newRows) {
    const net = networkOf(r.productId)
    const cur = byNet.get(net) ?? { products: new Set(), add: 0 }
    cur.products.add(r.productId)
    cur.add++
    byNet.set(net, cur)
  }

  console.log('\nRows to add (new (product, date) pairs):')
  for (const [net, v] of [...byNet.entries()].sort()) {
    console.log(`  ${net.padEnd(12)} ${String(v.products.size).padStart(3)} products  ${String(v.add).padStart(5)} new rows`)
  }
  const supply = newRows.filter((r) => r.productId.endsWith(':supply')).length
  const borrow = newRows.length - supply
  console.log(
    `\n  TOTAL new rows: ${newRows.length}  (supply=${supply} borrow=${borrow})` +
      `  |  already present, skipped: ${inputs.length - newRows.length}`
  )

  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write to persist.\n')
    process.exit(0)
  }

  const inserted = await backfillDailyRows(inputs, new Date())
  console.log(`\n✅ Inserted ${inserted} rows into apy_daily (add-only).\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
