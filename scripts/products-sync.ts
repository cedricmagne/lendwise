/**
 * @file scripts/products-sync.ts
 * Manual trigger for the products sync job.
 *
 * Usage:
 *   bun run --env-file=.env products:sync
 *   bun run --env-file=.env products:sync -- --protocol aave_v3
 *   bun run --env-file=.env products:sync -- --protocol morpho_v1
 */
import { syncProducts } from '@/app/actions/products-sync.actions'
import type { ProtocolName } from '@/config/protocols-meta'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const protoIdx = args.indexOf('--protocol')
  const protocol =
    protoIdx !== -1 ? (args[protoIdx + 1] as ProtocolName) : undefined

  console.log('\n🔄 products sync\n')
  if (protocol) {
    console.log(`  Protocol: ${protocol}\n`)
  } else {
    console.log('  Protocol: all\n')
  }

  const result = await syncProducts(protocol)

  console.log('\n📊 Result:')
  console.log(`  Success:  ${result.success}`)
  console.log(`  Total:    ${result.counts.total}`)
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
