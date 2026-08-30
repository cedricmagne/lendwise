/**
 * One-off Blend catalogue bootstrap — seeds the `products` table from Hubble.
 *
 * WHEN TO RUN THIS: a fresh environment, or after the Blend `products` rows
 * have been purged. Not a cron job.
 *
 * In steady state the hourly products sync is enough: the Blend adapter's
 * `getProducts` enumerates from the injected catalogue set unioned with a fresh
 * factory `Deploy` scan (`getFactoryDeployedPools`, ~7-day RPC retention). That
 * cannot see the ~11 pools deployed months ago when `products` is empty — the
 * RPC no longer serves those events. Hubble's `history_contract_events` mirror
 * carries the full `Deploy` history and fills that gap exactly once.
 *
 * Idempotent: every write is an upsert on the deterministic product slug id.
 *
 * Usage:
 *   pnpm blend:bootstrap
 */
import { Version } from '@blend-capital/blend-sdk'

import { getBigQueryClient } from '@/lib/bigquery/client'
import {
  syncProviderProducts,
  upsertProducts,
} from '@/lib/db/repositories/products'
import { getBackstop } from '@/lib/protocols/blend/common/api'
import { BLEND_PROVIDER } from '@/lib/protocols/blend/common/config'
import { fetchBlendPoolDeploys } from '@/lib/protocols/blend/common/hubble'
import { fetchBlendV1Products } from '@/lib/protocols/blend/v1/products'
import { fetchBlendV2Products } from '@/lib/protocols/blend/v2/products'

async function main(): Promise<void> {
  console.log('\n🔄 Blend catalogue bootstrap (Hubble)\n')

  const client = getBigQueryClient()
  if (!client) {
    console.error(
      '❌ BigQuery client unavailable — set GCP_PROJECT and ' +
        'GCP_SERVICE_ACCOUNT_BASE64 (base64-encoded service-account JSON) in ' +
        'the environment.'
    )
    process.exit(1)
  }

  // Factory addresses are read off the backstops, never hardcoded.
  const [v1Backstop, v2Backstop] = await Promise.all([
    getBackstop({ version: Version.V1 }),
    getBackstop({ version: Version.V2 }),
  ])
  const factories = {
    v1: v1Backstop.config.poolFactory,
    v2: v2Backstop.config.poolFactory,
  }

  const deploys = await fetchBlendPoolDeploys(client, factories)
  console.log(
    `  Hubble Deploy events: ${deploys.v1.length} V1, ${deploys.v2.length} V2 ` +
      '(includes never-launched redeployments — filtered on load)\n'
  )

  if (deploys.v1.length + deploys.v2.length === 0) {
    console.warn(
      '⚠️  Hubble returned no Deploy events for either factory. Check the ' +
        'factory addresses read off the backstops, or the query. Leaving ' +
        '`products` untouched.\n'
    )
    process.exit(0)
  }

  // `fetchBlendV{1,2}Products` loads each pool over RPC and drops status-6
  // (Setup / never-launched) pools, so the ghost redeployments Hubble surfaces
  // are discarded here. Called unconditionally: an empty `poolIds` falls
  // through to the adapter's own factory Deploy scan alone (`[]` if that is
  // also empty).
  const [v1Products, v2Products] = await Promise.all([
    fetchBlendV1Products({ poolIds: deploys.v1 }),
    fetchBlendV2Products({ poolIds: deploys.v2 }),
  ])

  const allProducts = [...v1Products, ...v2Products]
  console.log(
    `  Live products: ${v1Products.length} V1 + ${v2Products.length} V2 ` +
      `= ${allProducts.length}\n`
  )

  if (allProducts.length === 0) {
    console.warn(
      '⚠️  Nothing to seed — every pool Hubble returned is never-launched ' +
        '(status 6). Leaving `products` untouched.\n'
    )
    process.exit(0)
  }

  await upsertProducts(allProducts)

  // ONE reconciliation call spanning both versions. A per-version call would
  // read the other version's absent ids as "delisted" and close its periods.
  const fetchedIds = allProducts.map((p) => p._id)
  const r = await syncProviderProducts(BLEND_PROVIDER, fetchedIds, new Date())

  console.log('📊 Result:')
  console.log(`  Products upserted:  ${allProducts.length}`)
  console.log(`  Periods activated:  ${r.activated}`)
  console.log(`  Periods closed:     ${r.deactivated}`)
  console.log(`  Unchanged:          ${r.unchanged}`)
  console.log('\n✅ Done\n')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err)
  process.exit(1)
})
