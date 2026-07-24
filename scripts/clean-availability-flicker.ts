/**
 * @file scripts/clean-availability-flicker.ts
 * Coalesce spurious short availability gaps ("flickers"). A poll-based sync
 * (syncProviderProducts) closes a period on a single missed catalogue fetch and
 * reopens it minutes-to-hours later; the drawer chart then cuts its line across
 * a stretch the pool actually lived through. On a daily chart a sub-day gap
 * becomes a full-day visual break (seen after the 2026-07-17/18 deploys).
 *
 * Merges consecutive periods of a product separated by a gap shorter than
 * --max-gap-hours (default 12; observed flicker gaps top out at ~8h, real
 * delist→relist cycles are far longer).
 *
 * DRY-RUN BY DEFAULT. Pass --write to persist.
 *
 * Usage:
 *   pnpm clean:availability-flicker                    # dry run, 12h threshold
 *   pnpm clean:availability-flicker -- --max-gap-hours 6
 *   pnpm clean:availability-flicker -- --write
 */
import { coalesceAvailabilityFlicker } from '@/lib/db/repositories/products'

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const maxGapHours = Number(arg(args, '--max-gap-hours') ?? 12)

  console.log(
    `\n🧹 Availability flicker cleanup ${write ? '(WRITE)' : '(dry run)'}`
  )
  console.log(`  Merge gaps shorter than: ${maxGapHours}h\n`)

  const { productsAffected, periodsRemoved, plans } =
    await coalesceAvailabilityFlicker(maxGapHours, { dryRun: !write })

  // Sample of what merges, longest gaps first.
  const sample = [...plans]
    .sort((a, b) => Math.max(...b.gapsHours) - Math.max(...a.gapsHours))
    .slice(0, 10)
  if (sample.length > 0) {
    console.log('Sample merges (largest bridged gap first):')
    for (const p of sample) {
      const gaps = p.gapsHours.map((h) => `${h.toFixed(1)}h`).join(', ')
      console.log(
        `  ${p.productId}  −${p.removed.length} period(s)  gaps: ${gaps}`
      )
    }
    console.log('')
  }

  console.log(
    `${write ? 'Merged' : 'Would merge'}: ${productsAffected} products, ${periodsRemoved} periods removed.`
  )

  if (!write) {
    console.log(
      '\nDry run — nothing written. Re-run with --write to persist.\n'
    )
  } else {
    console.log('\n✅ Done.\n')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Cleanup failed:', err)
  process.exit(1)
})
