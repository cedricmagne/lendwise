/**
 * @file scripts/backfill-history.ts
 * Backfill `apy_daily` from protocols' own DAY-interval history.
 *
 * PROTOCOL-BLIND. Everything it knows comes from `adapter.getApyHistory` — no
 * `@/lib/protocols/<name>/…` import appears here, and adding a protocol needs
 * zero edits to this file: implement the contract, register the adapter, done.
 * Where a protocol keeps its rates and its TVL/utilization (one API, two
 * subgraphs, a REST endpoint, a non-EVM ledger) is the adapter's business; it
 * merges them internally and hands back one point per (product, day).
 *
 * Two idempotent writes, from the SAME point set:
 *
 *   INSERT (add-only)  — `backfillDailyRows`, ON CONFLICT (product_id, date)
 *     DO NOTHING. Organic rows aggregated from our own spots are never
 *     overwritten; only genuinely missing days are added.
 *
 *   PATCH (fill-only)  — `patchDailyMarketState`, COALESCE(existing, incoming)
 *     on the market columns. This is what repairs rows that already exist but
 *     were written before their protocol had a market-state source. Rows that
 *     don't exist are skipped: `apy_*` are NOT NULL and a patch has no rates.
 *
 * Between fetch and write, `enrichPointsWithUsd` prices the points whose source
 * gave amounts but no price, from another provider's same-day observation.
 *
 * DRY-RUN BY DEFAULT: diffs against the table and reports what it WOULD change.
 * Pass --write to persist. Caveat: in a dry run the patch count ignores rows
 * the INSERT would have created — a --write run inserts first, then patches.
 *
 * Usage:
 *   pnpm backfill:history                                # dry run, morpho, default new chains
 *   pnpm backfill:history -- --protocol all --days 365   # every adapter with a history source
 *   pnpm backfill:history -- --protocol aave --chains 1 --days 500
 *   pnpm backfill:history -- --protocol aave_v3 --chains 1 --skip-market
 *   pnpm backfill:history -- --write                     # PERSIST to apy_daily
 *
 * Flags: --protocol <all|provider|adapterId>  --chains <ids>  --days <n>
 *        --write  --overwrite  --skip-market  --patch-only
 */
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { enrichPointsWithUsd } from '@/lib/backfill/enrich-usd'
import {
  type DailyBackfillInput,
  type DailyMarketPatch,
  backfillDailyRows,
  dailyKey,
  existingDailyKeys,
  patchDailyMarketState,
} from '@/lib/db/repositories/apy'
import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import { toHistoryResult } from '@/lib/protocols/core/history-result'
import type { HistoryDataPoint, YieldAdapter } from '@/lib/protocols/core/types'

// Networks added 2026-07-18 (commit e38331a) — first spot 2026-07-18T12:00Z.
const DEFAULT_NEW_CHAINS = [747474, 143, 988, 999, 4217, 4663, 130]

type AnyMarket = Partial<SupplyMarketState & BorrowMarketState>

// ─── CLI ────────────────────────────────────────────────────────────────────

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Resolve `--protocol` against the registry: an adapter id (`aave_v3`), a
 * provider matching every version of it (`aave`), or `all`. Resolving from
 * YIELD_ADAPTERS rather than a local alias map is what keeps this script at
 * zero maintenance as protocols are added.
 */
async function resolveAdapters(selector: string): Promise<YieldAdapter[]> {
  const ids = Object.keys(YIELD_ADAPTERS) as (keyof typeof YIELD_ADAPTERS)[]
  const loaded = await Promise.all(ids.map((id) => YIELD_ADAPTERS[id]()))

  const matched =
    selector === 'all'
      ? loaded
      : loaded.filter((a) => a.id === selector || a.provider === selector)

  if (matched.length === 0) {
    const providers = [...new Set(loaded.map((a) => a.provider))]
    console.error(
      `Unknown --protocol "${selector}". Use: all | ${providers.join(' | ')} | ${loaded.map((a) => a.id).join(' | ')}`
    )
    process.exit(1)
  }
  return matched
}

// ─── Mapping ────────────────────────────────────────────────────────────────

/** A history point as the add-only insert wants it. */
function toDailyInput(p: HistoryDataPoint): DailyBackfillInput {
  const m = p.market as AnyMarket
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

/** The same point as a market-column patch, or null when it carries no state. */
function toMarketPatch(p: HistoryDataPoint): DailyMarketPatch | null {
  const m = p.market as AnyMarket
  const known = [
    m.supplyAssets,
    m.supplyAssetsUsd,
    m.utilizationRate,
    m.assetPriceUsd,
    m.borrowAssets,
    m.borrowAssetsUsd,
  ].some((v) => v != null)
  if (!known) return null

  return {
    productId: p.productId,
    date: p.timestamp,
    supplyAssets: m.supplyAssets ?? null,
    supplyAssetsUsd: m.supplyAssetsUsd ?? null,
    utilizationRate: m.utilizationRate ?? null,
    assetPriceUsd: m.assetPriceUsd ?? null,
    borrowAssets: m.borrowAssets ?? null,
    borrowAssetsUsd: m.borrowAssetsUsd ?? null,
  }
}

// ─── Per-adapter run ────────────────────────────────────────────────────────

interface RunOpts {
  startTs: number
  endTs: number
  chainIds: number[]
  includeMarket: boolean
  patchOnly: boolean
  write: boolean
  overwrite: boolean
}

async function runAdapter(
  adapter: YieldAdapter,
  opts: RunOpts
): Promise<{ inserted: number; patched: number }> {
  console.log(`\n─── ${adapter.id} ───`)

  if (!adapter.getApyHistory) {
    console.log('  No getApyHistory — skipped.')
    return { inserted: 0, patched: 0 }
  }

  const covered = opts.chainIds.filter((id) => id in adapter.chains)
  if (covered.length === 0) {
    console.log(`  Covers none of the requested chains — skipped.`)
    return { inserted: 0, patched: 0 }
  }

  const { points: raw, failures } = toHistoryResult(
    await adapter.getApyHistory({
      startTimestamp: opts.startTs,
      endTimestamp: opts.endTs,
      interval: 'DAY',
      chainIds: covered,
      includeMarket: opts.includeMarket,
    })
  )
  console.log(`  Fetched ${raw.length} history points.`)
  if (failures.length > 0) {
    console.log(
      `  ⚠️  ${failures.length} products the adapter could not answer for:`
    )
    for (const f of failures.slice(0, 5)) {
      console.log(`     ${f.productId} — ${f.reason}`)
    }
  }
  if (raw.length === 0) return { inserted: 0, patched: 0 }

  const { points, report } = await enrichPointsWithUsd(raw)
  console.log(
    `  Price: ${report.ownPrice} from source, ${report.crossProvider} cross-provider, ${report.unpriced} unpriced.`
  )

  const productIds = [...new Set(points.map((p) => p.productId))]
  const existing = await existingDailyKeys(
    productIds,
    new Date(opts.startTs * 1000),
    new Date(opts.endTs * 1000)
  )

  // A point either creates a row (INSERT) or repairs one (PATCH) — the table
  // decides which, so both sets come from the same fetch with no extra query.
  const inserts = opts.patchOnly
    ? []
    : points.filter((p) => !existing.has(dailyKey(p.productId, p.timestamp)))
  const patches = points
    .filter((p) => existing.has(dailyKey(p.productId, p.timestamp)))
    .map(toMarketPatch)
    .filter((p): p is DailyMarketPatch => p !== null)

  const supply = inserts.filter((p) => p.kind === 'supply').length
  console.log(
    `  INSERT: ${inserts.length} new rows (supply=${supply} borrow=${inserts.length - supply})`
  )
  console.log(`  PATCH : ${patches.length} existing rows carry market state`)

  if (!opts.write) return { inserted: 0, patched: 0 }

  const inserted =
    inserts.length > 0
      ? await backfillDailyRows(inserts.map(toDailyInput), new Date())
      : 0
  const patched = await patchDailyMarketState(patches, {
    overwrite: opts.overwrite,
  })
  console.log(`  ✅ inserted ${inserted}, patched ${patched}`)
  return { inserted, patched }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const overwrite = args.includes('--overwrite')
  const includeMarket = !args.includes('--skip-market')
  const patchOnly = args.includes('--patch-only')
  const selector = (arg(args, '--protocol') ?? 'morpho').toLowerCase()
  const days = Number(arg(args, '--days') ?? 365)
  const chainsArg = arg(args, '--chains')
  const chainIds = chainsArg
    ? chainsArg.split(',').map((s) => Number(s.trim()))
    : DEFAULT_NEW_CHAINS

  const endTs = Math.floor(Date.now() / 1000)
  const startTs = endTs - days * 86400

  const adapters = await resolveAdapters(selector)

  console.log(`\n🔄 History backfill ${write ? '(WRITE)' : '(dry run)'}`)
  console.log(`  Adapters: ${adapters.map((a) => a.id).join(', ')}`)
  console.log(`  Chains:   ${chainIds.join(', ')}`)
  console.log(
    `  Window:   ${utcDay(new Date(startTs * 1000))
      .toISOString()
      .slice(0, 10)} → ${utcDay(new Date(endTs * 1000))
      .toISOString()
      .slice(0, 10)} (${days}d)`
  )
  console.log(
    `  Market state: ${includeMarket ? 'requested' : 'skipped (--skip-market)'}`
  )

  const totals = { inserted: 0, patched: 0 }
  for (const adapter of adapters) {
    // One failing adapter must not cost the others their backfill.
    try {
      const r = await runAdapter(adapter, {
        startTs,
        endTs,
        chainIds,
        includeMarket,
        patchOnly,
        write,
        overwrite,
      })
      totals.inserted += r.inserted
      totals.patched += r.patched
    } catch (err) {
      console.error(
        `  ❌ ${adapter.id} failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  if (write) {
    console.log(
      `\n✅ TOTAL: ${totals.inserted} rows inserted, ${totals.patched} rows patched (${overwrite ? 'overwrite' : 'fill-only'}).\n`
    )
  } else {
    console.log(
      '\nDry run — nothing written. Re-run with --write to persist.\n'
    )
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
