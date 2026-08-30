import { Version } from '@blend-capital/blend-sdk'

import type {
  BorrowMarketState,
  RewardItem,
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
  isRpcRefusal,
  primeTokenMetadata,
} from '../common/api'
import { BLEND_PROVIDER } from '../common/config'
import {
  buildProductId,
  computeEmissionsApr,
  getBlndPriceUsd,
} from '../common/utils'
import { blendPoolIds } from '../listing'
import { BLEND_V2_CHAINS } from './config'

/**
 * Fetch current APY snapshots for all active Blend V2 pools.
 * One reserve → two documents (supply + borrow).
 *
 * Rates come from the SDK's own IRM (`reserve.supplyApr`/`borrowApr`, already
 * accrued to now by `Pool.load`) but are run through this pipeline's
 * canonical daily-compounding formula rather than the SDK's own APY estimate
 * — the SDK compounds supply weekly and borrow daily (two different periods),
 * which would be inconsistent with every other protocol's stored APY here.
 */
export async function fetchBlendV2ApySpot(
  opts?: FetchOpts
): Promise<SpotPayload[]> {
  let chainIds = Object.keys(BLEND_V2_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  console.log(
    `[cron:blend_v2] Fetching APY spot for chains: ${chainIds.join(', ')}`
  )

  // The pool set comes from `./listing` in `spot` mode — the `products`
  // catalogue only (`opts.poolIds`), no factory scan: the catalogue is
  // authoritative for what to collect.
  const poolIds = await blendPoolIds('v2', opts, 'spot')
  if (poolIds.length === 0) {
    console.warn('[cron:blend_v2] no pool ids resolved — skipping')
    return []
  }
  console.log(`[cron:blend_v2] ${poolIds.length} pools`)

  // Fetched after the early return: the backstop is only needed for the BLND
  // reward-token pricing below, and an empty catalogue has nothing to price.
  const backstop = await getBackstop({ version: Version.V2 })

  // Shared by every reserve below: BLND has no oracle feed of its own (see
  // getBlndPriceUsd), and the reward token itself is one BLND contract for
  // the whole backstop, not per-pool.
  const blndPriceUsd = getBlndPriceUsd(backstop)
  const blndToken = backstop.config?.blndTkn
    ? await getTokenMetadata(backstop.config.blndTkn)
    : undefined

  const snapshots: SpotPayload[] = []

  for (const poolId of poolIds) {
    try {
      const pool = await getPool({ version: Version.V2, poolId })

      // Hubble surfaces every historical `Deploy`, including superseded
      // redeployments still in `status: Setup` with no positions; skip them.
      // Do NOT filter statuses 4/5: pools frozen post-hack still hold real
      // user funds and must stay listed.
      if (pool.metadata?.status === 6) {
        console.log(
          `[cron:blend_v2] pool ${poolId} skipped: status 6 (setup / not launched)`
        )
        continue
      }

      // One request for the pool.s token metadata instead of one per reserve.
      await primeTokenMetadata([...pool.reserves.keys()])

      // A pool whose oracle is unreachable still yields rates — only its USD
      // columns go unknown. Skipping it would desync this enumeration from
      // `getProducts`, which lists the pool regardless.
      const oracleId = pool.metadata?.oracle
      let prices = new Map<string, number>()
      if (!oracleId) {
        console.warn(
          `[cron:blend_v2] Pool ${poolId} has no oracle — USD values unknown`
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
        const supplyAssetsUsd =
          priceUsd == null ? null : supplyAssets * priceUsd
        const borrowAssets = reserve.totalLiabilitiesFloat()
        const borrowAssetsUsd =
          priceUsd == null ? null : borrowAssets * priceUsd

        // ─── Supply side ──────────────────────────────────────────────────
        // reserve.supplyApr is already net of the backstop's cut of interest
        // (curIr * utilization * (1 - backstopTakeRate)). The gross rate before
        // that cut is curIr * utilization — reconstructed here as borrowApr *
        // utilization, since curIr itself isn't exposed on the reserve.
        const grossSupplyApr = reserve.borrowApr * utilizationRate
        const baseSupplyApy = aprToApyDaily(grossSupplyApr)
        const netSupplyApy = aprToApyDaily(reserve.supplyApr)
        const supplyFeesApy = Math.max(0, baseSupplyApy - netSupplyApy)

        // ─── Reward emissions (BLND) ──────────────────────────────────────
        const supplyRewardApr = computeEmissionsApr({
          emissions: reserve.supplyEmissions,
          supply: reserve.data.bSupply,
          decimals: reserve.config.decimals,
          rate: reserve.data.bRate,
          rateDecimals: reserve.rateDecimals,
          blndPriceUsd,
          assetPriceUsd: priceUsd,
        })
        const supplyRewardItems: RewardItem[] =
          supplyRewardApr > 0 && blndToken
            ? [
                {
                  token: {
                    symbol: blndToken.symbol,
                    address: blndToken.address,
                  },
                  apr: supplyRewardApr,
                  apy: aprToApyDaily(supplyRewardApr),
                  source: 'protocol',
                  program: null,
                },
              ]
            : []
        const totalSupplyRewardsApy = supplyRewardItems.reduce(
          (s, r) => s + r.apy,
          0
        )

        const borrowRewardApr = computeEmissionsApr({
          emissions: reserve.borrowEmissions,
          supply: reserve.data.dSupply,
          decimals: reserve.config.decimals,
          rate: reserve.data.dRate,
          rateDecimals: reserve.rateDecimals,
          blndPriceUsd,
          assetPriceUsd: priceUsd,
        })
        const borrowRewardItems: RewardItem[] =
          borrowRewardApr > 0 && blndToken
            ? [
                {
                  token: {
                    symbol: blndToken.symbol,
                    address: blndToken.address,
                  },
                  apr: borrowRewardApr,
                  apy: aprToApyDaily(borrowRewardApr),
                  source: 'protocol',
                  program: null,
                },
              ]
            : []
        const totalBorrowRewardsApy = borrowRewardItems.reduce(
          (s, r) => s + r.apy,
          0
        )

        snapshots.push({
          productId: buildProductId({
            poolId,
            assetId,
            kind: 'supply',
            version: Version.V2,
          }),
          kind: 'supply',
          protocol: BLEND_PROVIDER,
          chainId: -1,
          asset: token.symbol,
          apy: {
            base: baseSupplyApy,
            rewards: totalSupplyRewardsApy,
            fees: supplyFeesApy,
            net: netSupplyApy + totalSupplyRewardsApy,
            rewardItems: supplyRewardItems,
          },
          market: {
            supplyAssets,
            supplyAssetsUsd,
            utilizationRate,
            assetPriceUsd: priceUsd,
          } as SupplyMarketState,
        })

        // ─── Borrow side — borrower pays the full rate, no protocol cut ───
        const borrowApy = aprToApyDaily(reserve.borrowApr)

        snapshots.push({
          productId: buildProductId({
            poolId,
            assetId,
            kind: 'borrow',
            version: Version.V2,
          }),
          kind: 'borrow',
          protocol: BLEND_PROVIDER,
          chainId: -1,
          asset: token.symbol,
          apy: {
            base: borrowApy,
            rewards: totalBorrowRewardsApy,
            fees: 0,
            net: Math.max(0, borrowApy - totalBorrowRewardsApy),
            rewardItems: borrowRewardItems,
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
    } catch (err) {
      if (isRpcRefusal(err)) throw err // 500 → QStash replays
      console.error(
        `[cron:blend_v2] pool ${poolId} skipped: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  const borrows = snapshots.filter((s) => s.kind === 'borrow').length
  console.log(
    `[cron:blend_v2] Fetched ${snapshots.length} snapshots (${snapshots.length - borrows} supply + ${borrows} borrow)`
  )
  return snapshots
}
