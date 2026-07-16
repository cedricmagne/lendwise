/**
 * @file scripts/collect-apy.ts
 * Verification run of the 10-minute APY spot collector — the exact code path
 * QStash hits via POST /api/yield/apy/spot, minus the signature check.
 *
 * DRY-RUN BY DEFAULT: fetches and validates every protocol but leaves
 * apy_hourly untouched. Pass --write to contribute a real slot.
 *
 * Usage:
 *   pnpm collect:apy                          # dry run, all protocols
 *   pnpm collect:apy -- --protocol aave_v3    # dry run, one protocol
 *   pnpm collect:apy -- --write               # real slot write (= production cron)
 */
import { collectApySpot } from '@/app/actions/apy-snapshots.actions'
import type { ProtocolName } from '@/config/protocols-meta'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const protoIdx = args.indexOf('--protocol')
  const protocol =
    protoIdx !== -1 ? (args[protoIdx + 1] as ProtocolName) : undefined
  const write = args.includes('--write')

  console.log(`\n🔄 APY spot collection ${write ? '(WRITE)' : '(dry run)'}\n`)
  console.log(`  Protocol: ${protocol ?? 'all'}\n`)

  const result = await collectApySpot(protocol, { dryRun: !write })

  console.log('\n📊 Result:')
  console.log(`  Success:  ${result.success}`)
  const { total, ...perProtocol } = result.counts
  for (const [id, count] of Object.entries(perProtocol)) {
    console.log(`  ${id}: ${count}`)
  }
  console.log(`  Total:    ${total}`)
  console.log(`  Duration: ${result.durationMs}ms`)

  if (result.errors.length > 0) {
    console.log('\n❌ Errors:')
    result.errors.forEach((e) => console.log(`  ${e}`))
    process.exit(1)
  }

  console.log('\n✅ Done\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err)
  process.exit(1)
})
