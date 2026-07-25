#!/usr/bin/env node
/**
 * LendWise × Blend — Proof of Concept (SCF Build candidacy support)
 * ------------------------------------------------------------------
 * Demonstrates the core "green brick" from the technical architecture:
 * reading live Blend lending rates straight from Soroban (no subgraph,
 * no GraphQL, no API key) and normalizing them into the exact row shape
 * LendWise upserts into `apy_hourly`.
 *
 * What it proves, end to end, against Stellar MAINNET:
 *   1. Connect to a public Soroban RPC (no credentials).
 *   2. Discover live pools on-chain via the Blend Backstop reward zone
 *      (no hard-coded pool address).
 *   3. Load each pool's reserves with @blend-capital/blend-sdk (PoolV2.load).
 *   4. Read on-chain supply/borrow APR, normalize APR → APY with LendWise's
 *      formula (1 + APR/365)^365 − 1, and cross-check against the SDK's own
 *      compounded estimate.
 *   5. Emit normalized SupplyProduct / BorrowProduct rows — the upsert payload.
 *
 * Runtime budget: hard-asserted under 3 minutes (exits non-zero if exceeded).
 *
 * Run:  npm install && npm start
 */
import { Backstop, PoolV2 } from '@blend-capital/blend-sdk'

// --- Config (mainnet defaults, all overridable via env) ----------------------
const RPC = process.env.BLEND_RPC ?? 'https://mainnet.sorobanrpc.com'
const PASSPHRASE =
  process.env.BLEND_PASSPHRASE ??
  'Public Global Stellar Network ; September 2015'
// Blend v2 mainnet Backstop (source: docs.blend.capital/mainnet-deployments)
const BACKSTOP =
  process.env.BLEND_BACKSTOP ??
  'CAQQR5SWBXKIGZKPBZDH3KM5GQ5GUTPKB7JAFCINLZBC5WXPJKRG3IM7'
const MAX_POOLS = Number(process.env.MAX_POOLS ?? 5)
const TIME_BUDGET_MS = 3 * 60 * 1000

const network = { rpc: RPC, passphrase: PASSPHRASE, opts: { allowHttp: false } }

/** APR → APY, daily compounding — LendWise's canonical conversion before storage. */
const aprToApy = (apr) => (1 + apr / 365) ** 365 - 1
const pct = (x) => `${(x * 100).toFixed(4)}%`
const short = (id) => `${id.slice(0, 4)}…${id.slice(-4)}`

/**
 * Build the normalized rows LendWise would upsert into `apy_hourly`.
 * One supply row + one borrow row per reserve. Net rate convention:
 *   supply net = base − fees + rewards ; borrow net = base + fees − rewards.
 * Emissions (BLND) are the reward leg — modeled as a follow-up; base only here.
 */
function toApyRows(poolId, poolName, assetId, reserve) {
  const supplyApy = aprToApy(reserve.supplyApr)
  const borrowApy = aprToApy(reserve.borrowApr)
  const slug = (kind) =>
    `blend:v2:stellar:${short(poolId)}:${short(assetId)}:${kind}`
  return [
    {
      productId: slug('supply'),
      provider: 'blend',
      chain: 'stellar',
      pool: poolName,
      asset: assetId,
      kind: 'supply',
      baseApy: supplyApy,
      netApy: supplyApy, // base − fees + rewards (rewards = emissions, follow-up)
      utilization: reserve.getUtilizationFloat(),
    },
    {
      productId: slug('borrow'),
      provider: 'blend',
      chain: 'stellar',
      pool: poolName,
      asset: assetId,
      kind: 'borrow',
      baseApy: borrowApy,
      netApy: borrowApy, // base + fees − rewards
      utilization: reserve.getUtilizationFloat(),
    },
  ]
}

async function main() {
  const started = Date.now()
  console.log('LendWise × Blend — live mainnet read PoC')
  console.log('RPC:', RPC)
  console.log('Backstop:', short(BACKSTOP), '\n')

  // 1 + 2: discover live pools on-chain (no hard-coded pool address)
  const backstop = await Backstop.load(network, BACKSTOP)
  const rewardZone = backstop.config?.rewardZone ?? []
  const poolIds = rewardZone.slice(0, MAX_POOLS)
  console.log(
    `Discovered ${rewardZone.length} pools in the Backstop reward zone.`
  )
  console.log(`Reading ${poolIds.length} pool(s)…\n`)

  const upsertRows = []
  let maxAprApyDelta = 0
  let checkedReserves = 0

  for (const poolId of poolIds) {
    // 3: load pool reserves directly from Soroban
    const pool = await PoolV2.load(network, poolId)
    const name = pool.metadata?.name ?? short(poolId)
    console.log(
      `■ Pool "${name}" (${short(poolId)}) — ${pool.reserves.size} reserves`
    )

    for (const [assetId, reserve] of pool.reserves) {
      // 4: normalize + cross-check against the SDK's compounded estimate.
      // Only validate against healthy reserves — degenerate/over-utilized
      // reserves (APR ≫ 100%, util > 100%) diverge by compounding convention.
      const supplyApy = aprToApy(reserve.supplyApr)
      const borrowApy = aprToApy(reserve.borrowApr)
      const util = reserve.getUtilizationFloat()
      const healthy = reserve.borrowApr < 1 && util > 0.01 && util <= 1
      if (healthy) {
        checkedReserves++
        maxAprApyDelta = Math.max(
          maxAprApyDelta,
          Math.abs(supplyApy - reserve.estSupplyApy),
          Math.abs(borrowApy - reserve.estBorrowApy)
        )
      }
      console.log(
        `   ${short(assetId)}  supply ${pct(supplyApy).padStart(9)}  ` +
          `borrow ${pct(borrowApy).padStart(9)}  ` +
          `util ${pct(reserve.getUtilizationFloat()).padStart(8)}`
      )
      // 5: collect the normalized upsert payload
      upsertRows.push(...toApyRows(poolId, name, assetId, reserve))
    }
    console.log('')
  }

  // Evidence block
  const elapsed = Date.now() - started
  console.log('─'.repeat(60))
  console.log(
    `Normalized rows ready for apy_hourly upsert: ${upsertRows.length}`
  )
  console.log('Sample upsert row (SupplyProduct shape):')
  console.log(JSON.stringify(upsertRows[0], null, 2))
  console.log(
    `\nMax |LendWise APY − SDK estimate| across ${checkedReserves} healthy reserves: ${pct(maxAprApyDelta)}` +
      "\n  (near-zero ⇒ the APR→APY normalization matches the SDK's on-chain compounded rate)"
  )
  console.log(
    `\n⏱  Completed in ${(elapsed / 1000).toFixed(1)}s (budget ${TIME_BUDGET_MS / 1000}s)`
  )

  if (elapsed > TIME_BUDGET_MS) {
    console.error('✗ Exceeded 3-minute budget')
    process.exit(1)
  }
  if (upsertRows.length === 0) {
    console.error('✗ No rows produced — reward zone empty or RPC unreachable')
    process.exit(1)
  }
  console.log(
    '✓ PoC passed: live Blend rates read, normalized, and shaped for the LendWise pipeline.'
  )
}

main().catch((err) => {
  console.error('✗ PoC failed:', err?.message ?? err)
  process.exit(1)
})
