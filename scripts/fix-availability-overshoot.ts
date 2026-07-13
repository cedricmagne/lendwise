/**
 * @file scripts/fix-availability-overshoot.ts
 * Pull back availability periods that were closed AFTER the pool had already left
 * its provider's catalogue.
 *
 * Root cause: the 0002 backfill closed an inactive product's period at
 * `max(apy_hourly.hour) + 1h`. That is the right rule for a pool whose last rows
 * are real observations — but some of those last rows were HEAL FABRICATIONS.
 *
 * The frxUSD Morpho market is the clean example. It was delisted on 07-07 00:00.
 * Its only rows anywhere near that date are two nearest-neighbor heals at 07-09
 * 07:00 and 08:00 — the heal job copying a neighbour's rate into a market that had
 * not existed for two days. The backfill then read those fabrications as evidence
 * the pool was alive and held its period open until 07-09 09:00. /status duly
 * reported a "missing" pool for an hour in which nothing was owed, and a rerun of
 * the heal job would simply fabricate the same rows again.
 *
 * The heal inventing data for a dead market, and the backfill taking the invention
 * as proof the market was alive.
 *
 * The corrected boundary, matching syncProviderProducts:
 *
 *   deactivated_at = GREATEST(
 *     LEAST(last COLLECTED hour + 1h, products.updated_at),
 *     activated_at
 *   )
 *
 *   - `NOT healed` — a healed row is not evidence the market existed.
 *   - LEAST(…, updated_at) — a hard cap. `updated_at` is when the catalogue sync
 *     marked the pool inactive, i.e. when its provider stopped listing it. Nothing
 *     found after that can extend the period, whatever wrote it.
 *   - GREATEST(…, activated_at) — a period must never end before it starts.
 *
 * Only shrinks periods, never extends them, and only touches rows written by the
 * migration. Idempotent: a second run finds nothing.
 *
 * Usage:
 *   pnpm fix:availability -- --dry-run   # report only
 *   pnpm fix:availability                # apply
 */
import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'

/** The boundary the period SHOULD have. Referenced by both the report and the update. */
const corrected = sql`
  GREATEST(
    LEAST(
      COALESCE(
        (SELECT date_trunc('hour', max(h.hour)) + interval '1 hour'
           FROM apy_hourly h
          WHERE h.product_id = pa.product_id
            AND NOT h.healed),
        p.updated_at
      ),
      p.updated_at
    ),
    pa.activated_at
  )
`

/** A period held open past the point its provider stopped listing the pool. */
const overshooting = sql`
  pa.detected_by = 'migration'
  AND pa.deactivated_at IS NOT NULL
  AND pa.deactivated_at > ${corrected}
`

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  console.log(`\n🔧 Fix availability overshoot${dryRun ? ' (dry-run)' : ''}\n`)

  const res = await db.execute(sql`
    SELECT p.provider, p.asset_symbol AS asset, p.kind,
           to_char(pa.deactivated_at, 'MM-DD HH24:MI') AS closed_at,
           to_char(${corrected}, 'MM-DD HH24:MI')      AS should_close_at,
           round(
             extract(epoch FROM (pa.deactivated_at - ${corrected}))::numeric / 3600,
             1
           ) AS overshoot_hours
    FROM product_availability_periods pa
    JOIN products p ON p.id = pa.product_id
    WHERE ${overshooting}
    ORDER BY overshoot_hours DESC
  `)
  const rows = res.rows as Record<string, unknown>[]

  if (rows.length === 0) {
    console.log('✅ Nothing to fix — every period ends where it should\n')
    process.exit(0)
  }

  console.log(`  ${rows.length} periods held open too long:\n`)
  console.table(rows)

  if (dryRun) {
    console.log('\n✅ Dry-run complete (no writes)\n')
    process.exit(0)
  }

  // `UPDATE … FROM` here because the corrected boundary needs products.updated_at.
  // The `p.id = pa.product_id` predicate is load-bearing, not decoration: without a
  // join key, Postgres cross-joins and rewrites EVERY row in the table with values
  // from an arbitrary product.
  const upd = await db.execute(sql`
    UPDATE product_availability_periods pa
    SET deactivated_at = ${corrected}
    FROM products p
    WHERE p.id = pa.product_id
      AND ${overshooting}
  `)
  console.log(`\n  Pulled back ${upd.rowCount ?? 0} periods`)

  const after = await db.execute(sql`
    SELECT count(*) AS n
    FROM product_availability_periods pa
    JOIN products p ON p.id = pa.product_id
    WHERE ${overshooting}
  `)
  console.log(`  overshooting remaining: ${(after.rows[0] as { n: string }).n}`)
  console.log(
    `\n✅ Done — those hours are no longer "expected", so /status stops reporting phantom gaps\n`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Fix failed:', err)
  process.exit(1)
})
