/**
 * @file scripts/adapter-test.ts
 * CI harness for YieldAdapters — the mechanized products/spot invariant
 * (the drift lesson: ~18,500 orphan apy_hourly rows/week from aave listing skew),
 * plus the targeted-history invariant (see `probeTargeting` below).
 *
 * Usage: pnpm adapter:test aave_v3   (network + THEGRAPH_API_KEY required)
 */
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import type { Product } from '@/lib/db/types'
import { toHistoryResult } from '@/lib/protocols/core/history-result'
import type { HistoryTarget, YieldAdapter } from '@/lib/protocols/core/types'
import {
  productStrictSchema,
  spotPayloadStrictSchema,
} from '@/lib/protocols/core/validation'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

const HOUR_SECONDS = 3600
/** Short enough that a leak costs seconds, long enough to expect points. */
const PROBE_LOOKBACK_HOURS = 48
const PROBE_SIZE = 3

/**
 * Three products from the chain the adapter covers most heavily.
 *
 * Deriving the sample from the adapter's own `getProducts` is the whole point:
 * the predecessor of this check (`scripts/verify-targeting.ts`) carried
 * production productIds as constants, and they rot — a contributor would have
 * watched it fail for reasons foreign to their adapter. The busiest chain is a
 * self-derived stand-in for "the protocol's main deployment", which is where an
 * upstream is likeliest to actually publish history; a sample landing on a
 * chain with no history at all still proves the targeting invariant, it just
 * proves it over an empty answer.
 */
function probeSample(products: Product[]): Product[] {
  const perChain = new Map<number, Product[]>()
  for (const p of products) {
    const id = p.protocol.chain.id
    perChain.set(id, [...(perChain.get(id) ?? []), p])
  }
  const busiest = [...perChain.values()].sort((a, b) => b.length - a.length)[0]
  return (busiest ?? []).slice(0, PROBE_SIZE)
}

/** The catalogue row as `products.meta` would carry it — see `HistoryTarget`. */
function toTarget(p: Product): HistoryTarget {
  return {
    productId: p._id,
    chainId: p.protocol.chain.id,
    kind: p.kind,
    meta: p.protocol.meta as unknown as Record<string, unknown>,
  }
}

/**
 * `getApyHistory` must fan out over the REQUESTED products and nothing else.
 *
 * An adapter that ignores the field stays conforming but keeps the full
 * catalogue fan-out — which is how Aave came to fetch ~1,000 reserves to repair
 * 216 and got its batch tail cut off by the rate limiter. The failure mode is
 * silent, so it needs a harness.
 *
 * Returns the number of HARD failures. Requested-but-unanswered products are
 * reported, never counted: a protocol legitimately publishes no history on some
 * chains (Aave answers "no history for this side" on metis), and failing on
 * that would make the harness lie about the adapter.
 */
async function probeTargeting(
  adapter: YieldAdapter,
  products: Product[]
): Promise<number> {
  console.log('\ntargeted history (getApyHistory):')
  if (!adapter.getApyHistory) {
    console.log('  — not implemented (optional); targeting not applicable')
    return 0
  }

  const sample = probeSample(products)
  if (sample.length === 0) {
    console.log('  — no product to probe')
    return 0
  }
  const requested = sample.map((p) => p._id)
  const chainSlug =
    adapter.chains[sample[0].protocol.chain.id]?.slug ??
    `chain:${sample[0].protocol.chain.id}`

  const now = Math.floor(Date.now() / 1000)
  const started = Date.now()
  const result = toHistoryResult(
    await adapter.getApyHistory({
      startTimestamp: now - PROBE_LOOKBACK_HOURS * HOUR_SECONDS,
      endTimestamp: now,
      interval: 'HOUR',
      // Both forms, exactly as the reconcile job sends them. `targets` wins
      // where both are read, and `requestedProducts()` derives one set from
      // whichever is present, so they cannot drift apart.
      productIds: requested,
      targets: sample.map(toTarget),
    })
  )
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  const returned = new Set(result.points.map((pt) => pt.productId))
  const leaked = [...returned].filter((id) => !requested.includes(id))
  const answered = requested.filter((id) => returned.has(id))

  console.log(
    `  asked ${requested.length} on ${chainSlug} → ${answered.length} answered, ` +
      `${result.points.length} points in ${seconds}s`
  )
  for (const id of leaked)
    console.error(`✗ returned a product that was NOT requested: ${id}`)

  const unanswered = requested.filter((id) => !returned.has(id))
  if (unanswered.length > 0) {
    const reason = new Map(result.failures.map((f) => [f.productId, f.reason]))
    console.log(`  unanswered (not a failure):`)
    for (const id of unanswered) {
      const why = reason.get(id)
      console.log(
        why ? `    ${id}\n      → ${why}` : `    ${id}  ⚠ no reason reported`
      )
    }
  }

  return leaked.length
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

  // 3. Targeted history — the fan-out must cost what the request costs.
  failures += await probeTargeting(adapter, products)

  // 4. Human-review summary (DefiLlama-style).
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
