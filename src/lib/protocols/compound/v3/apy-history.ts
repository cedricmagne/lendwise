import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import type { HistoryDataPoint } from '@/lib/protocols/aave/v3/apy-history'
import { COMPOUND_V3_CHAINS } from '@/lib/protocols/compound/v3/config'
import {
  MARKET_DAILY_ACCOUNTING,
  MARKET_HOURLY_ACCOUNTING,
} from '@/lib/protocols/compound/v3/queries'
import { buildProductId } from '@/lib/protocols/compound/v3/utils'
import {
  createGraphQLClient,
  processBatches,
} from '@/lib/protocols/core/toolkit'

// ─── Response types ───────────────────────────────────────────────────────────

type AccountingSnapshot = {
  timestamp: string
  market: {
    id: string
    configuration: {
      symbol: string
      baseToken: { lastPriceUsd: string }
    }
  }
  accounting: {
    supplyApr: string
    netSupplyApr: string
    rewardSupplyApr: string
    borrowApr: string
    netBorrowApr: string
    rewardBorrowApr: string
    totalBaseSupply: string
    totalBaseSupplyUsd: string
    totalBaseBorrow: string
    totalBaseBorrowUsd: string
    utilization: string
    collateralBalanceUsd: string
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapshotToPoints(
  snapshot: AccountingSnapshot,
  chainId: number,
  chainName: string
): [HistoryDataPoint, HistoryDataPoint] {
  const ts = new Date(Number(snapshot.timestamp) * 1000)
  const marketId = snapshot.market.id
  const acc = snapshot.accounting

  const supplyProductId = buildProductId(
    marketId,
    { id: chainId, name: chainName },
    'supply'
  )
  const borrowProductId = buildProductId(
    marketId,
    { id: chainId, name: chainName },
    'borrow'
  )

  const supplyAssetsUsd = Number(acc.totalBaseSupplyUsd)
  const borrowAssetsUsd = Number(acc.totalBaseBorrowUsd)
  const assetPriceUsd = Number(
    snapshot.market.configuration.baseToken.lastPriceUsd
  )

  const supplyPoint: HistoryDataPoint = {
    timestamp: ts,
    productId: supplyProductId,
    kind: 'supply',
    apy: {
      base: Number(acc.supplyApr),
      rewards: Number(acc.rewardSupplyApr),
      fees: 0,
      net: Number(acc.netSupplyApr),
      rewardItems: [],
    },
    market: {
      supplyAssets: Number(acc.totalBaseSupply),
      supplyAssetsUsd,
      utilizationRate: Number(acc.utilization),
      assetPriceUsd,
    } as SupplyMarketState,
  }

  const borrowPoint: HistoryDataPoint = {
    timestamp: ts,
    productId: borrowProductId,
    kind: 'borrow',
    apy: {
      base: Number(acc.borrowApr),
      rewards: Number(acc.rewardBorrowApr),
      fees: 0,
      net: Number(acc.netBorrowApr),
      rewardItems: [],
    },
    market: {
      supplyAssets: Number(acc.totalBaseSupply),
      supplyAssetsUsd,
      borrowAssets: Number(acc.totalBaseBorrow),
      borrowAssetsUsd,
      utilizationRate: Number(acc.utilization),
      assetPriceUsd,
      collateralAssetsUsd: Number(acc.collateralBalanceUsd),
      priceCollateralInLoanAsset: null,
    } as BorrowMarketState,
  }

  return [supplyPoint, borrowPoint]
}

// ─── Paginated fetch ──────────────────────────────────────────────────────────

async function fetchAllSnapshots<T>(
  client: ReturnType<typeof createGraphQLClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  where: Record<string, unknown>,
  entityKey: string,
  orderBy: string,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = []
  let skip = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await client
      .query<Record<string, T[]>>(query, {
        where,
        first: pageSize,
        skip,
        orderBy,
        orderDirection: 'asc',
      })
      .toPromise()

    if (error) throw new Error(error.message)

    const items = data?.[entityKey]
    if (!items?.length) break

    all.push(...items)
    if (items.length < pageSize) {
      hasMore = false
    } else {
      skip += pageSize
    }
  }

  return all
}

// ─── Daily fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch historical Compound V3 daily APY data from on-chain subgraphs.
 *
 * Compound subgraphs store full accounting snapshots per day per market,
 * including supply/borrow APR, reward APR, TVL, and utilization.
 */
export async function fetchCompoundDailyHistory(opts?: {
  chainFilter?: string
  startTimestamp?: number
  endTimestamp?: number
  onProgress?: (msg: string) => void
}): Promise<HistoryDataPoint[]> {
  const log = opts?.onProgress ?? console.log
  const allPoints: HistoryDataPoint[] = []

  let chainIds = Object.keys(COMPOUND_V3_CHAINS).map(Number)

  if (opts?.chainFilter) {
    const found = Object.entries(COMPOUND_V3_CHAINS).find(
      ([, c]) => c.name.toLowerCase() === opts.chainFilter!.toLowerCase()
    )
    if (!found) {
      log(`[history:compound] Chain filter '${opts.chainFilter}' not found`)
      return []
    }
    chainIds = [Number(found[0])]
  }

  const validChains = chainIds
    .map((id) => ({ chainId: id, chainConfig: COMPOUND_V3_CHAINS[id] }))
    .filter((c) => c.chainConfig?.custom?.subgraphUrl)

  log(
    `[history:compound] Fetching daily snapshots for ${validChains.length} chains (in parallel batches)`
  )

  const chainPoints = await processBatches(
    validChains,
    async ({ chainId, chainConfig }) => {
      const chainClient = createGraphQLClient(
        chainConfig.custom!.subgraphUrl!,
        process.env.THEGRAPH_API_KEY,
        60_000
      )
      const chainName = chainConfig.name.toLowerCase()

      try {
        const where: Record<string, unknown> = {}
        if (opts?.startTimestamp)
          where.timestamp_gte = String(opts.startTimestamp)
        if (opts?.endTimestamp) where.timestamp_lte = String(opts.endTimestamp)

        const snapshots = await fetchAllSnapshots<AccountingSnapshot>(
          chainClient,
          MARKET_DAILY_ACCOUNTING,
          where,
          'dailyMarketAccountings',
          'timestamp'
        )

        const points: HistoryDataPoint[] = []
        for (const snapshot of snapshots) {
          const [supply, borrow] = snapshotToPoints(
            snapshot,
            chainId,
            chainName
          )
          points.push(supply, borrow)
        }

        log(
          `[history:compound] ${chainName}: ${snapshots.length} daily snapshots`
        )
        return points
      } catch (err) {
        log(
          `[history:compound] ${chainName} daily failed: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    }
  )

  for (const pts of chainPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  log(`[history:compound] Total daily: ${allPoints.length} data points`)
  return allPoints
}

// ─── Hourly fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch historical Compound V3 hourly APY data from on-chain subgraphs.
 *
 * Same as daily but at hourly granularity. Use for shorter lookback
 * periods (≤ 180 days) to avoid exceeding subgraph pagination limits.
 */
export async function fetchCompoundHourlyHistory(opts?: {
  chainFilter?: string
  startTimestamp?: number
  endTimestamp?: number
  onProgress?: (msg: string) => void
}): Promise<HistoryDataPoint[]> {
  const log = opts?.onProgress ?? console.log
  const allPoints: HistoryDataPoint[] = []

  let chainIds = Object.keys(COMPOUND_V3_CHAINS).map(Number)

  if (opts?.chainFilter) {
    const found = Object.entries(COMPOUND_V3_CHAINS).find(
      ([, c]) => c.name.toLowerCase() === opts.chainFilter!.toLowerCase()
    )
    if (!found) {
      log(`[history:compound] Chain filter '${opts.chainFilter}' not found`)
      return []
    }
    chainIds = [Number(found[0])]
  }

  const validChains = chainIds
    .map((id) => ({ chainId: id, chainConfig: COMPOUND_V3_CHAINS[id] }))
    .filter((c) => c.chainConfig?.custom?.subgraphUrl)

  log(
    `[history:compound] Fetching hourly snapshots for ${validChains.length} chains (in parallel batches)`
  )

  const chainPoints = await processBatches(
    validChains,
    async ({ chainId, chainConfig }) => {
      const chainClient = createGraphQLClient(
        chainConfig.custom!.subgraphUrl!,
        process.env.THEGRAPH_API_KEY,
        60_000
      )
      const chainName = chainConfig.name.toLowerCase()

      try {
        const where: Record<string, unknown> = {}
        if (opts?.startTimestamp)
          where.timestamp_gte = String(opts.startTimestamp)
        if (opts?.endTimestamp) where.timestamp_lte = String(opts.endTimestamp)

        const snapshots = await fetchAllSnapshots<AccountingSnapshot>(
          chainClient,
          MARKET_HOURLY_ACCOUNTING,
          where,
          'hourlyMarketAccountings',
          'timestamp'
        )

        const points: HistoryDataPoint[] = []
        for (const snapshot of snapshots) {
          const [supply, borrow] = snapshotToPoints(
            snapshot,
            chainId,
            chainName
          )
          points.push(supply, borrow)
        }

        log(
          `[history:compound] ${chainName}: ${snapshots.length} hourly snapshots`
        )
        return points
      } catch (err) {
        log(
          `[history:compound] ${chainName} hourly failed: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    }
  )

  for (const pts of chainPoints) {
    for (const pt of pts) allPoints.push(pt)
  }

  log(`[history:compound] Total hourly: ${allPoints.length} data points`)
  return allPoints
}
