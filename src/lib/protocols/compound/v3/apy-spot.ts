import type {
  BorrowMarketState,
  SpotPayload,
  SupplyMarketState,
} from '@/lib/db/types'
import { MarketsApyQuery } from '@/lib/protocols/compound/v3/generated/graphql'
import { MARKETS_APY } from '@/lib/protocols/compound/v3/queries'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'
import type { FetchOpts } from '@/lib/protocols/core/types'

import { COMPOUND_V3_CHAINS } from './config'
import { buildProductId } from './utils'

/**
 * Fetch current supply and borrow APY for all Compound V3 markets across all chains.
 *
 * Compound uses on-chain subgraphs per chain, so we query each chain's subgraph
 * independently and aggregate the results.
 */
export async function fetchCompoundV3ApySpot(
  opts?: FetchOpts
): Promise<SpotPayload[]> {
  const snapshots: SpotPayload[] = []

  let chainIds = Object.keys(COMPOUND_V3_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  const results = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      const chainConfig = COMPOUND_V3_CHAINS[chainId]
      if (!chainConfig?.custom.subgraphUrl) {
        console.warn(`[products:compound] No subgraph URL for chain ${chainId}`)
        return []
      }

      const chainClient = createGraphQLClient(
        chainConfig.custom.subgraphUrl,
        process.env.THEGRAPH_API_KEY
      )

      const { data, error } = await chainClient
        .query<MarketsApyQuery>(MARKETS_APY, {})
        .toPromise()

      if (error) {
        throw new Error(
          `[cron:compound_v3] Failed to fetch ${chainConfig.name} rates: ${error.message}`
        )
      }

      if (!data?.markets?.length) {
        return []
      }

      const chain = {
        id: chainId,
        name: chainConfig.name.toLowerCase(),
      }

      for (const market of data.markets) {
        // Compound's accounting totals are RAW base units; the pipeline stores
        // whole tokens so that no reader needs the provider to interpret an
        // amount. Aave already publishes human units — this is what aligns the
        // three providers on one convention.
        const decimals = market.configuration.baseToken.token?.decimals
        const whole = (raw: unknown): number => {
          const n = Number(raw ?? 0)
          if (!Number.isFinite(n)) return 0
          // Unknown decimals: leave the amount alone rather than guess a scale.
          if (decimals == null) return n
          return n / 10 ** Number(decimals)
        }

        // ─── Supply payload ──────────────────────────────────────────────────────
        const supplyProductId = buildProductId(market.id, chain, 'supply')
        const supplyPayload: SpotPayload = {
          productId: supplyProductId,
          kind: 'supply',
          protocol: 'compound',
          chainId,
          asset: market.configuration.symbol,
          apy: {
            base: Number(market.accounting.supplyApr),
            rewards: Number(market.accounting.rewardSupplyApr),
            fees: 0,
            net: Number(market.accounting.netSupplyApr),
            rewardItems: [],
          },
          market: {
            supplyAssets: whole(market.accounting.totalBaseSupply),
            supplyAssetsUsd: Number(market.accounting.totalBaseSupplyUsd),
            utilizationRate: Number(market.accounting.utilization),
            assetPriceUsd: Number(market.configuration.baseToken.lastPriceUsd),
          } as SupplyMarketState,
        }

        // ─── Borrow payload ────────────────────────────────────────────────────
        const borrowProductId = buildProductId(market.id, chain, 'borrow')
        const borrowPayload: SpotPayload = {
          productId: borrowProductId,
          kind: 'borrow',
          protocol: 'compound',
          chainId,
          asset: market.configuration.symbol,
          apy: {
            base: Number(market.accounting.borrowApr),
            rewards: Number(market.accounting.rewardBorrowApr),
            fees: 0,
            net: Number(market.accounting.netBorrowApr),
            rewardItems: [],
          },
          market: {
            supplyAssets: whole(market.accounting.totalBaseSupply),
            supplyAssetsUsd: Number(market.accounting.totalBaseSupplyUsd),
            borrowAssets: whole(market.accounting.totalBaseBorrow),
            borrowAssetsUsd: Number(market.accounting.totalBaseBorrowUsd),
            utilizationRate: Number(market.accounting.utilization),
            assetPriceUsd: Number(market.configuration.baseToken.lastPriceUsd),
            collateralAssetsUsd: Number(market.accounting.collateralBalanceUsd),
            priceCollateralInLoanAsset: null, // TODO: derive from collateral state
          } as BorrowMarketState,
        }

        snapshots.push(supplyPayload, borrowPayload)
      }
      return snapshots
    })
  )

  const chainErrors: string[] = []
  for (const result of results) {
    if (result.status === 'rejected') {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      chainErrors.push(msg)
    } else {
      snapshots.push(...result.value)
    }
  }

  if (chainErrors.length > 0) {
    throw new Error(chainErrors.join(' | '))
  }

  console.log(`[cron:compound_v3] Fetched ${snapshots.length} APY snapshots`)
  return snapshots
}
