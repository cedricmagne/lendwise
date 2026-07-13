import { isFiniteApyBlock } from '@/lib/apy-validation'
import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import type { HistoryDataPoint } from '@/lib/protocols/aave/v3/apy-history'
import { MORPHO_CONFIG } from '@/lib/protocols/morpho/config'
import {
  MARKETS_APY,
  MARKET_BORROW_HISTORY,
  VAULTS_APY,
  VAULT_SUPPLY_HISTORY,
} from '@/lib/protocols/morpho/v1/offchain/queries'
import { buildProductId } from '@/lib/protocols/morpho/v1/utils'
import { createGraphQLClient, processBatches } from '@/lib/protocols/shared'

// ─── Response types ───────────────────────────────────────────────────────────

type FloatDataPoint = { x: number; y: number | null }

type VaultHistoryQuery = {
  vaultByAddress: {
    address: string
    asset: {
      symbol: string
      chain: { id: number; network: string }
    }
    historicalState: {
      apy: FloatDataPoint[]
      netApy: FloatDataPoint[]
      fee: FloatDataPoint[]
      totalAssetsUsd: FloatDataPoint[]
      totalAssets: FloatDataPoint[]
    }
  } | null
}

type MarketBorrowHistoryQuery = {
  marketById: {
    historicalState: {
      borrowApy: FloatDataPoint[]
      netBorrowApy: FloatDataPoint[]
      dailyBorrowApy: FloatDataPoint[]
    }
  } | null
}

type VaultsApyItem = {
  address: string
  asset: {
    symbol: string
    chain: { id: number; network: string }
  }
}

type VaultsListQuery = {
  vaults: {
    items: VaultsApyItem[]
    pageInfo: { countTotal: number; count: number; limit: number; skip: number }
  }
}

type MarketsListItem = {
  id: string
  marketId: string
  loanAsset: {
    symbol: string
    chain: { id: number; network: string }
  }
  collateralAsset: { symbol: string } | null
}

type MarketsListQuery = {
  markets: {
    items: MarketsListItem[]
    pageInfo: { countTotal: number; count: number; limit: number; skip: number }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyBorrowMarket(): BorrowMarketState {
  return {
    supplyAssets: 0,
    supplyAssetsUsd: 0,
    borrowAssets: 0,
    borrowAssetsUsd: 0,
    utilizationRate: 0,
    assetPriceUsd: 0,
    collateralAssetsUsd: null,
    priceCollateralInLoanAsset: null,
  }
}

/**
 * Build a map of timestamp → value from a FloatDataPoint timeseries.
 * x is a Unix timestamp in seconds.
 */
function toMap(series: FloatDataPoint[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const pt of series) {
    if (pt.y != null) map.set(pt.x, pt.y)
  }
  return map
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch historical Morpho APY data.
 *
 * - Supply (MetaMorpho vaults): uses vaultByAddress → historicalState timeseries
 * - Borrow (Morpho Blue markets): uses market → historicalState timeseries
 *
 * The Morpho API supports custom start/end timestamps with configurable interval.
 */
export async function fetchMorphoHistory(opts?: {
  chainFilter?: string
  startTimestamp?: number
  endTimestamp?: number
  interval?: string
  onProgress?: (msg: string) => void
}): Promise<HistoryDataPoint[]> {
  const log = opts?.onProgress ?? console.log
  const config = MORPHO_CONFIG.morpho_v1
  const client = createGraphQLClient(config.offchainApiUrl!, undefined, 60_000)

  let chainIds = Object.keys(config.chains).map(Number)

  if (opts?.chainFilter) {
    const found = Object.entries(config.chains).find(
      ([, c]) => c.name.toLowerCase() === opts.chainFilter!.toLowerCase()
    )
    if (!found) {
      log(`[history:morpho] Chain filter '${opts.chainFilter}' not found`)
      return []
    }
    chainIds = [Number(found[0])]
  }

  const timeseriesOptions: Record<string, unknown> = {}
  if (opts?.startTimestamp)
    timeseriesOptions.startTimestamp = opts.startTimestamp
  if (opts?.endTimestamp) timeseriesOptions.endTimestamp = opts.endTimestamp
  timeseriesOptions.interval = opts?.interval ?? 'DAY'

  const allPoints: HistoryDataPoint[] = []

  // ─── Phase 1: Supply (MetaMorpho vaults) ──────────────────────────────────

  // First, list all vaults to get their addresses
  const vaultAddresses: {
    address: string
    chainId: number
    network: string
    symbol: string
  }[] = []
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<VaultsListQuery>(VAULTS_APY, {
        first: 100,
        skip,
        where: { listed: true, chainId_in: chainIds },
      })
      .toPromise()

    if (error) {
      log(`[history:morpho] Failed to list vaults: ${error.message}`)
      break
    }

    if (!data?.vaults?.items?.length) break

    for (const vault of data.vaults.items) {
      vaultAddresses.push({
        address: vault.address,
        chainId: vault.asset.chain.id,
        network: vault.asset.chain.network.toLowerCase().replaceAll(' ', ''),
        symbol: vault.asset.symbol,
      })
    }

    const pageInfo = data.vaults.pageInfo
    if (pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  log(
    `[history:morpho] Found ${vaultAddresses.length} vaults (fetching in parallel batches)`
  )

  // Fetch history for each vault (batched)
  const vaultPoints = await processBatches(vaultAddresses, async (vault) => {
    try {
      const { data, error } = await client
        .query<VaultHistoryQuery>(VAULT_SUPPLY_HISTORY, {
          address: vault.address,
          options: timeseriesOptions,
        })
        .toPromise()

      if (error || !data?.vaultByAddress) {
        log(
          `[history:morpho] vault ${vault.symbol}@${vault.network}: ${error?.message ?? 'no data'}`
        )
        return null
      }

      const hist = data.vaultByAddress.historicalState
      const apyMap = toMap(hist.apy)
      const netApyMap = toMap(hist.netApy)
      const feeMap = toMap(hist.fee)
      const totalAssetsUsdMap = toMap(hist.totalAssetsUsd)

      const productId = buildProductId(vault.chainId, vault.address, 'supply')

      // Use netApy timestamps as reference (most complete)
      const timestamps = new Set([...apyMap.keys(), ...netApyMap.keys()])
      const points: HistoryDataPoint[] = []

      for (const ts of timestamps) {
        const baseApy = apyMap.get(ts) ?? 0
        const netApy = netApyMap.get(ts) ?? 0
        const fee = feeMap.get(ts) ?? 0
        const rewards = netApy - baseApy * (1 - fee)
        const totalAssetsUsd = totalAssetsUsdMap.get(ts) ?? 0

        const apy = {
          base: baseApy,
          rewards: Math.max(0, rewards),
          // fee is the 0–1 fee rate → store fee-APY (= base × fee rate).
          fees: baseApy * fee,
          net: netApy,
          rewardItems: [],
        }
        // Same finite-only contract as the spot job. Healed rows land in
        // apy_hourly exactly like collected ones, so an unguarded heal was the
        // one path by which a NaN could reach the table.
        if (!isFiniteApyBlock(apy)) continue

        points.push({
          timestamp: new Date(ts * 1000),
          productId,
          kind: 'supply',
          apy,
          market: {
            supplyAssets: 0,
            supplyAssetsUsd: totalAssetsUsd,
            utilizationRate: 0,
            assetPriceUsd: 0,
          } as SupplyMarketState,
        })
      }

      log(
        `[history:morpho] vault ${vault.symbol}@${vault.network}: ${timestamps.size} points`
      )
      return points
    } catch (err) {
      log(
        `[history:morpho] vault ${vault.symbol}@${vault.network}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  })
  for (const pts of vaultPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  // ─── Phase 2: Borrow (Morpho Blue markets) ───────────────────────────────

  const marketKeys: {
    id: string
    marketId: string
    chainId: number
    network: string
    loanSymbol: string
  }[] = []
  skip = 0
  hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<MarketsListQuery>(MARKETS_APY, {
        first: 100,
        skip,
        where: {
          listed: true,
          chainId_in: chainIds,
          borrowAssetsUsd_gte: 10000,
        },
      })
      .toPromise()

    if (error) {
      log(`[history:morpho] Failed to list markets: ${error.message}`)
      break
    }

    if (!data?.markets?.items?.length) break

    for (const market of data.markets.items) {
      marketKeys.push({
        id: market.id,
        marketId: market.marketId,
        chainId: market.loanAsset.chain.id,
        network: market.loanAsset.chain.network
          .toLowerCase()
          .replaceAll(' ', ''),
        loanSymbol: market.loanAsset.symbol,
      })
    }

    const pageInfo = data.markets.pageInfo
    if (pageInfo.countTotal > skip + pageInfo.limit) {
      skip += pageInfo.limit
    } else {
      hasMore = false
    }
  }

  log(
    `[history:morpho] Found ${marketKeys.length} borrow markets (fetching in parallel batches)`
  )

  const marketPoints = await processBatches(marketKeys, async (market) => {
    try {
      const { data, error } = await client
        .query<MarketBorrowHistoryQuery>(MARKET_BORROW_HISTORY, {
          marketId: market.marketId,
          chainId: market.chainId,
          options: timeseriesOptions,
        })
        .toPromise()

      if (error || !data?.marketById) {
        log(
          `[history:morpho] market ${market.loanSymbol}@${market.network}: ${error?.message ?? 'no data'}`
        )
        return null
      }

      const hist = data.marketById.historicalState
      const borrowApyMap = toMap(hist.borrowApy)
      const netBorrowApyMap = toMap(hist.netBorrowApy)

      const productId = buildProductId(
        market.chainId,
        market.marketId,
        'borrow'
      )
      const timestamps = new Set([
        ...borrowApyMap.keys(),
        ...netBorrowApyMap.keys(),
      ])

      const points: HistoryDataPoint[] = []
      for (const ts of timestamps) {
        const borrowApy = borrowApyMap.get(ts) ?? 0
        const netBorrowApy = netBorrowApyMap.get(ts) ?? borrowApy

        const apy = {
          base: borrowApy,
          // Reward total derived from Morpho's own net (netBorrow = borrow −
          // reward) so base − rewards === net exactly, matching the spot job.
          rewards: Math.max(0, borrowApy - netBorrowApy),
          // The market fee is taken from supplier interest, not a borrower cost.
          fees: 0,
          net: netBorrowApy,
          rewardItems: [],
        }
        if (!isFiniteApyBlock(apy)) continue

        points.push({
          timestamp: new Date(ts * 1000),
          productId,
          kind: 'borrow',
          apy,
          market: emptyBorrowMarket(),
        })
      }

      log(
        `[history:morpho] market ${market.loanSymbol}@${market.network}: ${timestamps.size} points`
      )
      return points
    } catch (err) {
      log(
        `[history:morpho] market ${market.loanSymbol}@${market.network}: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  })
  for (const pts of marketPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  log(
    `[history:morpho] Total: ${allPoints.length} data points (${allPoints.filter((p) => p.kind === 'supply').length} supply, ${allPoints.filter((p) => p.kind === 'borrow').length} borrow)`
  )
  return allPoints
}
