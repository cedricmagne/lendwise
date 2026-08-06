import { Version } from '@blend-capital/blend-sdk'

import type {
  BorrowMarketState,
  SpotPayload,
  SupplyMarketState,
} from '@/lib/db/types'
import type { FetchOpts } from '@/lib/protocols/core/types'
import { aprToApyDaily } from '@/lib/utils'

import {
  getBackstop,
  getPool,
  getPoolPrices,
  getTokenMetadata,
  primeTokenMetadata,
} from '../common/api'
import { BLEND_PROVIDER } from '../common/config'
import { buildProductId } from '../common/utils'
import { BLEND_V1_CHAINS } from './config'

/**
 * Fetch current APY snapshots for all active Blend V1 pools.
 * One reserve → two documents (supply + borrow).
 *
 * Rates come from the SDK's own IRM (`reserve.supplyApr`/`borrowApr`, already
 * accrued to now by `Pool.load`) but are run through this pipeline's
 * canonical daily-compounding formula rather than the SDK's own APY estimate
 * — the SDK compounds supply weekly and borrow daily (two different periods),
 * which would be inconsistent with every other protocol's stored APY here.
 *
 * Reward emissions (`reserve.supplyEmissions`/`borrowEmissions`) are not
 * wired yet — `rewardItems` is empty until that lands.
 */
export async function fetchBlendV1ApySpot(
  opts?: FetchOpts
): Promise<SpotPayload[]> {
  let chainIds = Object.keys(BLEND_V1_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  console.log(
    `[cron:blend_v1] Fetching APY spot for chains: ${chainIds.join(', ')}`
  )

  const backstop = await getBackstop({ version: Version.V1 })
  const poolIds = backstop.config?.rewardZone ?? []

  const snapshots: SpotPayload[] = []

  for (const poolId of poolIds) {
    const pool = await getPool({ version: Version.V1, poolId })

    // One request for the pool.s token metadata instead of one per reserve.
    await primeTokenMetadata([...pool.reserves.keys()])

    // A pool whose oracle is unreachable still yields rates — only its USD
    // columns go unknown. Skipping it would desync this enumeration from
    // `getProducts`, which lists the pool regardless.
    const oracleId = pool.metadata?.oracle
    let prices = new Map<string, number>()
    if (!oracleId) {
      console.warn(
        `[cron:blend_v1] Pool ${poolId} has no oracle — USD values unknown`
      )
    } else {
      // Not guarded: getPoolPrices only throws when the RPC REFUSED us, and
      // that has to reach the route as a 500 so QStash re-runs the job. A
      // genuinely unpriceable asset is already handled in there, as an
      // absent entry.
      prices = await getPoolPrices({
        oracleId,
        assetIds: [...pool.reserves.keys()],
      })
    }

    for (const [assetId, reserve] of pool.reserves) {
      const token = await getTokenMetadata(assetId)

      // NULL, never 0, when the oracle could not price the asset: a zero here
      // is a claim that the market holds nothing, and the display policy
      // believes it (see the note on BorrowMarketState in src/lib/db/types.ts).
      const priceUsd = prices.get(assetId) ?? null
      const utilizationRate = reserve.getUtilizationFloat()
      const supplyAssets = reserve.totalSupplyFloat()
      const supplyAssetsUsd = priceUsd == null ? null : supplyAssets * priceUsd
      const borrowAssets = reserve.totalLiabilitiesFloat()
      const borrowAssetsUsd = priceUsd == null ? null : borrowAssets * priceUsd

      // ─── Supply side ────────────────────────────────────────────────────
      // reserve.supplyApr is already net of the backstop's cut of interest
      // (curIr * utilization * (1 - backstopTakeRate)). The gross rate before
      // that cut is curIr * utilization — reconstructed here as borrowApr *
      // utilization, since curIr itself isn't exposed on the reserve.
      const grossSupplyApr = reserve.borrowApr * utilizationRate
      const baseSupplyApy = aprToApyDaily(grossSupplyApr)
      const netSupplyApy = aprToApyDaily(reserve.supplyApr)
      const supplyFeesApy = Math.max(0, baseSupplyApy - netSupplyApy)

      snapshots.push({
        productId: buildProductId({ poolId, assetId, kind: 'supply' }),
        kind: 'supply',
        protocol: BLEND_PROVIDER,
        chainId: -1,
        asset: token.symbol,
        apy: {
          base: baseSupplyApy,
          rewards: 0,
          fees: supplyFeesApy,
          net: netSupplyApy,
          rewardItems: [],
        },
        market: {
          supplyAssets,
          supplyAssetsUsd,
          utilizationRate,
          assetPriceUsd: priceUsd,
        } as SupplyMarketState,
      })

      // ─── Borrow side — borrower pays the full rate, no protocol cut ─────
      const borrowApy = aprToApyDaily(reserve.borrowApr)

      snapshots.push({
        productId: buildProductId({ poolId, assetId, kind: 'borrow' }),
        kind: 'borrow',
        protocol: BLEND_PROVIDER,
        chainId: -1,
        asset: token.symbol,
        apy: {
          base: borrowApy,
          rewards: 0,
          fees: 0,
          net: borrowApy,
          rewardItems: [],
        },
        market: {
          supplyAssets,
          supplyAssetsUsd,
          borrowAssets,
          borrowAssetsUsd,
          utilizationRate,
          assetPriceUsd: priceUsd,
          // Blend pools are multi-collateral, like AAVE — no single
          // collateral value or price ratio.
          collateralAssetsUsd: null,
          priceCollateralInLoanAsset: null,
        } as BorrowMarketState,
      })
    }
  }

  const borrows = snapshots.filter((s) => s.kind === 'borrow').length
  console.log(
    `[cron:blend_v1] Fetched ${snapshots.length} snapshots (${snapshots.length - borrows} supply + ${borrows} borrow)`
  )
  return snapshots
}
