/**
 * @file scripts/adapter-test.ts
 * CI harness for YieldAdapters — the mechanized products/spot invariant
 * (the drift lesson: ~18,500 orphan apy_hourly rows/week from aave listing skew).
 *
 * Usage: pnpm adapter:test aave_v3   (network + THEGRAPH_API_KEY required)
 */
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import {
  productStrictSchema,
  spotPayloadStrictSchema,
} from '@/lib/protocols/core/validation'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

async function main(): Promise<void> {
  const id = process.argv[2] as ProtocolName | undefined
  if (!id || !(id in PROTOCOLS_META)) {
    console.error(
      `Usage: pnpm adapter:test <${Object.keys(PROTOCOLS_META).join('|')}>`
    )
    process.exit(2)
  }

  const adapter = await YIELD_ADAPTERS[id]()
  const chainIds = Object.keys(adapter.chains).map(Number)
  let failures = 0

  console.log(
    `\n▶ ${adapter.name} (${adapter.id}) — chains: ${chainIds.join(', ')}\n`
  )

  const [products, spots] = await Promise.all([
    adapter.getProducts(),
    adapter.getApySpot(),
  ])

  if (products.length === 0 || spots.length === 0) {
    console.error(
      `✗ empty result set (products=${products.length}, spots=${spots.length})`
    )
    process.exit(1)
  }

  // 1. Strict validation — any failure fails the run.
  const productSchema = productStrictSchema(adapter)
  for (const p of products) {
    const r = productSchema.safeParse(p)
    if (!r.success) {
      failures++
      console.error(`✗ product ${p._id}: ${r.error.issues[0]?.message}`)
    }
  }
  const spotSchema = spotPayloadStrictSchema(chainIds)
  for (const s of spots) {
    const r = spotSchema.safeParse(s)
    if (!r.success) {
      failures++
      console.error(`✗ spot ${s.productId}: ${r.error.issues[0]?.message}`)
    }
  }

  // 2. products/spot productId set diff — drift is a hard failure.
  const productIds = new Set(products.map((p) => p._id))
  const spotIds = new Set(spots.map((s) => s.productId))
  const onlyProducts = [...productIds].filter((x) => !spotIds.has(x))
  const onlySpots = [...spotIds].filter((x) => !productIds.has(x))
  for (const x of onlyProducts)
    console.error(`✗ in products, missing from spot: ${x}`)
  for (const x of onlySpots)
    console.error(`✗ in spot, missing from products: ${x}`)
  failures += onlyProducts.length + onlySpots.length

  // 3. Human-review summary (DefiLlama-style).
  const byChainKind = new Map<string, number>()
  for (const s of spots) {
    const slug = adapter.chains[s.chainId]?.slug ?? `chain:${s.chainId}`
    const key = `${slug} × ${s.kind}`
    byChainKind.set(key, (byChainKind.get(key) ?? 0) + 1)
  }
  const nets = spots.map((s) => s.apy.net)
  // Supply spots only (borrow market state repeats the same market's
  // supplyAssetsUsd), deduped per product (Compound emits one spot per
  // collateral) — otherwise TVL double-counts.
  const tvlByProduct = new Map<string, number>()
  for (const s of spots) {
    if (s.kind !== 'supply') continue
    const usd = (s.market as { supplyAssetsUsd?: number | null })
      .supplyAssetsUsd
    tvlByProduct.set(s.productId, usd ?? 0)
  }
  const tvl = [...tvlByProduct.values()].reduce((acc, v) => acc + v, 0)
  console.log('\nchain × kind:')
  for (const [k, v] of [...byChainKind].sort()) console.log(`  ${k}: ${v}`)
  console.log(
    `\nAPY net min/median/max: ${Math.min(...nets).toFixed(4)} / ${median(nets).toFixed(4)} / ${Math.max(...nets).toFixed(4)}`
  )
  console.log(`TVL (supply, USD): ${Math.round(tvl).toLocaleString('en-US')}`)
  console.log(
    `\n${failures === 0 ? '✓' : '✗'} ${products.length} products, ${spots.length} spots, ${failures} failure(s)\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
