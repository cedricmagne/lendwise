/**
 * @file scripts/clean-merkl-market-misattribution.ts
 * Strip Merkl reward_items that were misattributed to the wrong Aave V3 market.
 *
 * Root cause (fixed 2026-07-14 in src/lib/protocols/aave/v3/apy-spot.ts):
 * some Merkl "aave" opportunities — Aave V4 hub/spoke campaigns, and multi-token
 * "Dutch" campaigns — carry no `marketName` in their depositUrl. The old
 * lookupMerklIncentive() fell back to an address-only match, so any V3 market
 * sharing the same underlying token address picked up rewards that were never
 * meant for it (e.g. Aave V4's Core Hub campaign leaking into the V3 mainnet
 * market's USDG reserve, which shows no Merkl reward on Aave's own UI).
 *
 * Verified against Merkl's live+past opportunity history and Aave's UI: none of
 * the 4 products below ever had a real V3-scoped campaign. Every non-empty
 * reward_items row in their apy_hourly history is exactly one 'merkl' item —
 * never mixed with a real incentive — so the whole history is safe to strip.
 *
 * Affected (all kind=supply):
 *   - aave:v3:ethereum:reserve:0xe343167631d89b6ffc58b88d6b7fb0228795491d:supply (USDG)
 *   - aave:v3:ethereum:reserve:0x4c9edd5852cd905f086c759e8383e09bff1e68b3:supply
 *   - aave:v3:ethereum:reserve:0x9d39a5de30e57443bff2a8307a4256c8797a3497:supply (sUSDe, mainnet)
 *   - aave:v3:ethereum-lido:reserve:0x9d39a5de30e57443bff2a8307a4256c8797a3497:supply (sUSDe, lido)
 *
 * Safety: affected apy_hourly rows are quarantined before mutation. Only the
 * reward-derived columns are touched (reward_items, apy_rewards, apy_net) —
 * apy_base/apy_fees and market-state columns are untouched. Net for supply is
 * base - fees + rewards, and apy_net/apy_rewards are running means over the
 * same slots, so `apy_net - apy_rewards` exactly removes the reward
 * contribution without needing per-slot history. apy_daily for the affected
 * day range is then rebuilt from the corrected hourly rows.
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/clean-merkl-market-misattribution.ts --dry-run
 *   pnpm exec dotenv -e .env.local -- tsx scripts/clean-merkl-market-misattribution.ts
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { aggregateDaily } from '@/lib/db/repositories/apy'

const BAD_PRODUCT_IDS = [
  'aave:v3:ethereum:reserve:0xe343167631d89b6ffc58b88d6b7fb0228795491d:supply',
  'aave:v3:ethereum:reserve:0x4c9edd5852cd905f086c759e8383e09bff1e68b3:supply',
  'aave:v3:ethereum:reserve:0x9d39a5de30e57443bff2a8307a4256c8797a3497:supply',
  'aave:v3:ethereum-lido:reserve:0x9d39a5de30e57443bff2a8307a4256c8797a3497:supply',
]

/** neon-http can't bind a JS array for `= ANY($1)` — expand to IN (...). */
function inList(values: string[]) {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )})`
}

const affected = sql`product_id IN ${inList(BAD_PRODUCT_IDS)} AND jsonb_array_length(reward_items) > 0`

async function count(): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*) AS n FROM apy_hourly WHERE ${affected}`
  )
  return Number((res.rows[0] as { n: number | string }).n)
}

async function affectedDays(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT to_char(date_trunc('day', hour), 'YYYY-MM-DD') AS d
    FROM apy_hourly WHERE ${affected}
    ORDER BY d
  `)
  return (res.rows as { d: string }[]).map((r) => r.d)
}

/** Copy affected rows into a quarantine twin table (idempotent on rerun). */
async function quarantine(): Promise<number> {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS apy_hourly_quarantine (LIKE apy_hourly INCLUDING ALL)`
  )
  const res = await db.execute(sql`
    INSERT INTO apy_hourly_quarantine
    SELECT * FROM apy_hourly WHERE ${affected}
    ON CONFLICT DO NOTHING
  `)
  return res.rowCount ?? 0
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  console.log(
    `\n🧼 Clean Merkl market-misattribution${dryRun ? ' (dry-run)' : ''}\n`
  )

  // The fix below assumes kind=supply (net = base - fees + rewards). If a
  // borrow product ever gets added to BAD_PRODUCT_IDS it needs its own
  // formula (net = max(0, base - rewards)) — fail loudly instead of silently
  // corrupting it.
  const kindRes = await db.execute(sql`
    SELECT DISTINCT kind FROM products WHERE id IN ${inList(BAD_PRODUCT_IDS)}
  `)
  const nonSupply = (kindRes.rows as { kind: string }[]).filter(
    (r) => r.kind !== 'supply'
  )
  if (nonSupply.length > 0) {
    throw new Error(
      `Expected all targeted products to be kind=supply, found: ${JSON.stringify(nonSupply)}`
    )
  }

  const [n, days] = await Promise.all([count(), affectedDays()])
  console.log(`  affected apy_hourly rows: ${n}`)
  console.log(
    `  days to rebuild:          ${days.length}${days.length ? ` (${days[0]} … ${days[days.length - 1]})` : ''}`
  )

  if (dryRun) {
    console.log('\n✅ Dry-run complete (no writes)\n')
    process.exit(0)
  }

  const q = await quarantine()
  console.log(`\n  Quarantined ${q} hourly rows`)

  const upd = await db.execute(sql`
    UPDATE apy_hourly
    SET reward_items = '[]'::jsonb,
        apy_net = apy_net - apy_rewards,
        apy_rewards = 0
    WHERE ${affected}
  `)
  console.log(`  Updated ${upd.rowCount ?? 0} hourly rows`)

  for (const day of days) {
    const start = new Date(`${day}T00:00:00.000Z`)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const rows = await aggregateDaily(start, end, new Date())
    console.log(`  Re-aggregated ${day}: ${rows} rows`)
  }

  const after = await count()
  console.log(`\n  affected rows remaining: ${after}`)
  console.log(`\n✅ Done — apy_hourly_quarantine holds the pre-fix rows\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Clean failed:', err)
  process.exit(1)
})
