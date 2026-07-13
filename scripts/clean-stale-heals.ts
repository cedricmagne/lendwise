/**
 * @file scripts/clean-stale-heals.ts
 * Quarantine nearest-neighbor heals whose donor row was too far away to be a
 * credible stand-in, then rebuild the affected days from what survives.
 *
 * Root cause: the heal job's `DONOR_PADDING_HOURS = 6` was never a distance cap.
 * It widens the query that FETCHES candidate donors, and that query is bounded by
 * the min/max hour across EVERY gap in the report — so a report spanning a week
 * fetched a week of candidates. `findNearestDonor` then took the closest of that
 * whole set without ever measuring how far it was. A Sunday APY was being copied
 * into a Tuesday hole and served as that hour's rate, in the time series and in
 * the charts, indistinguishable from a real observation.
 *
 * Measured before the fix: 1,457 neighbor-healed rows over 30 days, of which 280
 * (19%) came from more than 6 hours away and 82 from more than three days away.
 *
 * The heal route now enforces MAX_DONOR_DISTANCE_HOURS, so no new ones are
 * written. This removes the ones already in the table.
 *
 * Gate: heal_source = 'nearest-neighbor' AND |hour − healed_from| > 6h.
 *   - REFETCH heals are never touched. Those are the protocol's own data, merely
 *     fetched late — not a copy of anything.
 *   - Neighbor heals within the window are kept. A rate an hour either side of the
 *     hole is a defensible stand-in; that is the whole premise of the strategy.
 *
 * The removed hours become honest holes: red on /status, and re-proposed by the
 * next gap detection, which will now either refetch them properly or leave them
 * empty. A gap beats a confident fabrication.
 *
 * Safety: every row is copied to apy_hourly_quarantine / apy_daily_quarantine
 * before deletion, so the operation is fully reversible.
 *
 * Steps:
 *   1. Quarantine + delete stale-donor apy_hourly rows.
 *   2. Quarantine + delete the apy_daily rows those hours fed. Deleting rather
 *      than only re-aggregating is deliberate: aggregateDaily UPSERTS, so a
 *      (product, day) whose every hour was a stale copy would keep its old,
 *      poisoned daily row forever — the rebuild would simply never visit it.
 *   3. Re-aggregate the affected past UTC days from surviving hourly rows. A day
 *      left with no hourly rows stays absent, which is the honest outcome.
 *
 * Usage:
 *   pnpm clean:stale-heals -- --dry-run   # report only
 *   pnpm clean:stale-heals                # apply
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { aggregateDaily } from '@/lib/db/repositories/apy'

/** Must match MAX_DONOR_DISTANCE_HOURS in src/app/api/yield/apy/heal/route.ts. */
const MAX_DONOR_DISTANCE_HOURS = 6

/**
 * A neighbor heal copied from too far away.
 *
 * `healed_from` is stored as an ISO text column, hence the cast. Rows with a NULL
 * healed_from cannot be judged and are left alone — absence of evidence is not
 * evidence of staleness.
 */
const stale = sql`
  heal_source = 'nearest-neighbor'
  AND healed_from IS NOT NULL
  AND abs(extract(epoch FROM (hour - healed_from::timestamptz)))
      > ${MAX_DONOR_DISTANCE_HOURS * 3600}
`

interface Affected {
  productId: string
  date: string
}

async function countStale(): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*) AS n FROM apy_hourly WHERE ${stale}`
  )
  return Number((res.rows[0] as { n: number | string }).n)
}

/** How far the stale copies actually came from — the damage, in one line. */
async function distances(): Promise<Record<string, number>> {
  const res = await db.execute(sql`
    WITH d AS (
      SELECT abs(extract(epoch FROM (hour - healed_from::timestamptz))) / 3600 AS h
      FROM apy_hourly WHERE ${stale}
    )
    SELECT
      count(*) FILTER (WHERE h <= 24)             AS "6-24h",
      count(*) FILTER (WHERE h > 24 AND h <= 72)  AS "1-3d",
      count(*) FILTER (WHERE h > 72)              AS ">3d",
      round(max(h)::numeric, 1)                   AS worst
    FROM d
  `)
  return res.rows[0] as unknown as Record<string, number>
}

/** The (product, day) pairs whose daily aggregate was fed by a stale hour. */
async function affected(): Promise<Affected[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT product_id,
           to_char(date_trunc('day', hour), 'YYYY-MM-DD') AS date
    FROM apy_hourly WHERE ${stale}
    ORDER BY date, product_id
  `)
  return (res.rows as { product_id: string; date: string }[]).map((r) => ({
    productId: r.product_id,
    date: r.date,
  }))
}

/** Copy the stale hourly rows into the quarantine twin (idempotent on rerun). */
async function quarantineHourly(): Promise<number> {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS apy_hourly_quarantine (LIKE apy_hourly INCLUDING ALL)`
  )
  const res = await db.execute(sql`
    INSERT INTO apy_hourly_quarantine SELECT * FROM apy_hourly WHERE ${stale}
    ON CONFLICT DO NOTHING
  `)
  return res.rowCount ?? 0
}

/**
 * Quarantine + delete the daily rows the stale hours fed.
 *
 * Chunked: the pair list can run to thousands, and one VALUES list that long
 * would blow past the neon-http payload cap.
 */
async function purgeDaily(pairs: Affected[]): Promise<number> {
  if (pairs.length === 0) return 0
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS apy_daily_quarantine (LIKE apy_daily INCLUDING ALL)`
  )

  const CHUNK = 500
  let deleted = 0
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK)
    const tuples = sql.join(
      chunk.map((p) => sql`(${p.productId}, ${p.date}::date)`),
      sql`, `
    )
    const match = sql`(product_id, date) IN (${tuples})`

    await db.execute(sql`
      INSERT INTO apy_daily_quarantine SELECT * FROM apy_daily WHERE ${match}
      ON CONFLICT DO NOTHING
    `)
    const res = await db.execute(sql`DELETE FROM apy_daily WHERE ${match}`)
    deleted += res.rowCount ?? 0
  }
  return deleted
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  console.log(
    `\n🧼 Clean stale nearest-neighbor heals${dryRun ? ' (dry-run)' : ''}\n`
  )

  const [n, dist, pairs] = await Promise.all([
    countStale(),
    distances(),
    affected(),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const days = [...new Set(pairs.map((p) => p.date))]
    .filter((d) => d < today) // the in-progress day is rebuilt by the daily cron
    .sort()

  console.log(`  stale hourly rows:     ${n}`)
  console.log(
    `    6–24h away: ${dist['6-24h'] ?? 0}   1–3d: ${dist['1-3d'] ?? 0}   >3d: ${dist['>3d'] ?? 0}   worst: ${dist.worst ?? 0}h`
  )
  console.log(`  daily rows to rebuild: ${pairs.length} (product, day) pairs`)
  console.log(
    `  past days to rebuild:  ${days.length}${days.length ? ` (${days[0]} … ${days[days.length - 1]})` : ''}`
  )

  if (n === 0) {
    console.log('\n✅ Nothing to clean\n')
    process.exit(0)
  }
  if (dryRun) {
    console.log('\n✅ Dry-run complete (no writes)\n')
    process.exit(0)
  }

  const qh = await quarantineHourly()
  const dh = await db.execute(sql`DELETE FROM apy_hourly WHERE ${stale}`)
  console.log(`\n  Quarantined ${qh} hourly rows, deleted ${dh.rowCount ?? 0}`)

  const dd = await purgeDaily(pairs)
  console.log(`  Quarantined + deleted ${dd} daily rows`)

  for (const day of days) {
    const start = new Date(`${day}T00:00:00.000Z`)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const rebuilt = await aggregateDaily(start, end, new Date())
    console.log(`  Re-aggregated ${day}: ${rebuilt} rows`)
  }

  const after = await countStale()
  console.log(`\n  stale remaining: ${after}`)
  console.log(`\n✅ Done — quarantine tables hold every removed row\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Clean failed:', err)
  process.exit(1)
})
