/**
 * @file scripts/clean-non-finite-apy.ts
 * Purge UNSTORABLE APY rows (NaN / ±Infinity) from apy_hourly + apy_daily, then
 * rebuild the affected past days from the cleaned hourly rows.
 *
 * Deliberately magnitude-blind. A finite rate the protocol API actually returned
 * is real data, however absurd — an empty Morpho market genuinely quotes 297,996%
 * — and deleting it would be falsifying the ingestion record. Whether such a rate
 * is fit to SHOW is display eligibility, decided on the read side. This mirrors
 * `isFiniteApyBlock`, the only guard the ingestion pipeline is allowed to apply.
 *
 * (The previous version of this script deleted anything outside ±100. Run against
 * today's data it would destroy 479 legitimate rows.)
 *
 * Steps:
 *   1. Delete non-finite apy_hourly rows.
 *   2. Delete non-finite apy_daily rows.
 *   3. Re-aggregate every affected past UTC day from the surviving hourly rows
 *      (today is skipped — the in-progress day is rebuilt by the daily cron).
 *
 * Usage:
 *   pnpm clean:non-finite-apy -- --dry-run   # report only
 *   pnpm clean:non-finite-apy                # apply
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { aggregateDaily } from '@/lib/db/repositories/apy'

/**
 * Row is unstorable if any APY component is not a real number.
 *
 * Postgres has no finite-check for floats — `isfinite()` accepts only
 * timestamp/interval/date and raises 42883 on a `double precision`. The three
 * non-finite float values are spellable as literals, though, and `=` on them
 * behaves (Postgres defines NaN = NaN as true), so an explicit IN-list is both
 * correct and exhaustive.
 *
 * A NULL column yields NULL — not true — so NULL rows are left alone. That is
 * intended: a missing component is not a garbage one.
 */
const NON_FINITE = sql`('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)`

const nonFinite = sql`(
  apy_base    IN ${NON_FINITE} OR
  apy_rewards IN ${NON_FINITE} OR
  apy_fees    IN ${NON_FINITE} OR
  apy_net     IN ${NON_FINITE}
)`

async function count(table: 'apy_hourly' | 'apy_daily'): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*) AS n FROM ${sql.raw(table)} WHERE ${nonFinite}`
  )
  return Number((res.rows[0] as { n: number | string }).n)
}

/** Distinct past UTC days touched by non-finite rows (need daily rebuild). */
async function affectedPastDays(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT d FROM (
      SELECT to_char(date_trunc('day', hour), 'YYYY-MM-DD') AS d
        FROM apy_hourly WHERE ${nonFinite}
      UNION
      SELECT to_char(date, 'YYYY-MM-DD') AS d
        FROM apy_daily WHERE ${nonFinite}
    ) s
    WHERE d < to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
    ORDER BY d
  `)
  return (res.rows as { d: string }[]).map((r) => r.d)
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`\n🧼 Clean non-finite APY${dryRun ? ' (dry-run)' : ''}\n`)

  const [h, d, days] = await Promise.all([
    count('apy_hourly'),
    count('apy_daily'),
    affectedPastDays(),
  ])
  console.log(`  non-finite apy_hourly rows: ${h}`)
  console.log(`  non-finite apy_daily rows:  ${d}`)
  console.log(
    `  past days to rebuild:   ${days.length}${days.length ? ` (${days.join(', ')})` : ''}`
  )

  if (dryRun) {
    console.log('\n✅ Dry-run complete (no writes)\n')
    process.exit(0)
  }

  const dh = await db.execute(sql`DELETE FROM apy_hourly WHERE ${nonFinite}`)
  console.log(`\n  Deleted ${dh.rowCount ?? 0} hourly rows`)
  const dd = await db.execute(sql`DELETE FROM apy_daily WHERE ${nonFinite}`)
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
  console.log(`\n  non-finite remaining — hourly: ${hAfter}, daily: ${dAfter}`)
  console.log(`\n✅ Done\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Clean failed:', err)
  process.exit(1)
})
