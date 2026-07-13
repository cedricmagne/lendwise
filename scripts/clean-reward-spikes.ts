/**
 * @file scripts/clean-reward-spikes.ts
 * Purge reward-APY spike rows from apy_hourly + apy_daily, then rebuild the
 * affected past days from the surviving hourly rows.
 *
 * Root cause (2026-03-12 event): collection glitches wrote hourly slots with
 * apy_rewards up to 52.6 (5,260% APY) and EMPTY reward_items across 41 morpho
 * products in one day. Averaged into apy_daily, one such slot turns a healthy
 * vault's 5% day into a 97% day — which then poisons every 180d mean/stddev
 * computed over the series.
 *
 * Gate: apy_rewards >= 5 (500% APY). Rewards only, and deliberately narrow:
 *   - The largest REAL reward rate observed in our data is ~220% APR (memecoin
 *     incentives on a thin market). 500%+ sustained reward APY is fiction.
 *   - Net/base extremes on empty markets (TVL ≈ $0 quoting 297,996% net) are
 *     what the protocol API actually returned — real ingestion data. Hiding them
 *     is display eligibility's job, on the read side. NOT touched here.
 *
 * Distinct from clean-non-finite-apy, which deletes only NaN/±Infinity: this one
 * removes rows whose *stored value is a fabrication of a collection glitch*, not
 * rows that are merely extreme.
 *
 * Safety: every row is copied to apy_hourly_quarantine / apy_daily_quarantine
 * before deletion, so the operation is fully reversible.
 *
 * Steps:
 *   1. Quarantine + delete breaching apy_hourly rows.
 *   2. Quarantine + delete breaching apy_daily rows.
 *   3. Re-aggregate every affected past UTC day from surviving hourly rows
 *      (idempotent; days with no retained hourly simply stay absent — an honest
 *      gap beats a fabricated rate).
 *
 * Usage:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/clean-reward-spikes.ts --dry-run
 *   pnpm exec dotenv -e .env.local -- tsx scripts/clean-reward-spikes.ts
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { aggregateDaily } from '@/lib/db/repositories/apy'

const REWARD_APY_MAX = 5

/** Reward-rate fiction: BETWEEN also rejects NaN/±Inf (neither compares true). */
const spiking = sql`NOT (apy_rewards BETWEEN ${-REWARD_APY_MAX} AND ${REWARD_APY_MAX})`

async function count(table: 'apy_hourly' | 'apy_daily'): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE ${spiking}`
  )
  return Number((res.rows[0] as { n: number | string }).n)
}

/** Distinct past UTC days touched by spiking rows (need daily rebuild). */
async function affectedPastDays(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT d FROM (
      SELECT to_char(date_trunc('day', hour), 'YYYY-MM-DD') AS d
        FROM apy_hourly WHERE ${spiking}
      UNION
      SELECT to_char(date, 'YYYY-MM-DD') AS d
        FROM apy_daily WHERE ${spiking}
    ) s
    WHERE d < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
    ORDER BY d
  `)
  return (res.rows as { d: string }[]).map((r) => r.d)
}

/** Copy breaching rows into a quarantine twin table (idempotent on rerun). */
async function quarantine(table: 'apy_hourly' | 'apy_daily'): Promise<number> {
  const t = sql.raw(table)
  const q = sql.raw(`${table}_quarantine`)
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS ${q} (LIKE ${t} INCLUDING ALL)`
  )
  const res = await db.execute(sql`
    INSERT INTO ${q} SELECT * FROM ${t} WHERE ${spiking}
    ON CONFLICT DO NOTHING
  `)
  return res.rowCount ?? 0
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`\n🧼 Clean reward-APY spikes${dryRun ? ' (dry-run)' : ''}\n`)

  const [h, d, days] = await Promise.all([
    count('apy_hourly'),
    count('apy_daily'),
    affectedPastDays(),
  ])
  console.log(`  spiking apy_hourly rows: ${h}`)
  console.log(`  spiking apy_daily rows:  ${d}`)
  console.log(
    `  past days to rebuild:    ${days.length}${days.length ? ` (${days[0]} … ${days[days.length - 1]})` : ''}`
  )

  if (dryRun) {
    console.log('\n✅ Dry-run complete (no writes)\n')
    process.exit(0)
  }

  const qh = await quarantine('apy_hourly')
  const qd = await quarantine('apy_daily')
  console.log(`\n  Quarantined ${qh} hourly + ${qd} daily rows`)

  const dh = await db.execute(sql`DELETE FROM apy_hourly WHERE ${spiking}`)
  console.log(`  Deleted ${dh.rowCount ?? 0} hourly rows`)
  const dd = await db.execute(sql`DELETE FROM apy_daily WHERE ${spiking}`)
  console.log(`  Deleted ${dd.rowCount ?? 0} daily rows`)

  for (const day of days) {
    const start = new Date(`${day}T00:00:00.000Z`)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const n = await aggregateDaily(start, end, new Date())
    console.log(`  Re-aggregated ${day}: ${n} rows`)
  }

  const [hAfter, dAfter] = await Promise.all([
    count('apy_hourly'),
    count('apy_daily'),
  ])
  console.log(`\n  spiking remaining — hourly: ${hAfter}, daily: ${dAfter}`)
  console.log(`\n✅ Done — quarantine tables hold the removed rows\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Clean failed:', err)
  process.exit(1)
})
