import type { BorrowMarketState, SupplyMarketState } from '@/lib/db/types'
import { COMPOUND_V3_CHAINS } from '@/lib/protocols/compound/v3/config'
import {
  MARKETS_ALL,
  MARKET_DAILY_ACCOUNTING,
  MARKET_HOURLY_ACCOUNTING,
} from '@/lib/protocols/compound/v3/queries'
import { buildProductId } from '@/lib/protocols/compound/v3/utils'
import { requestedProducts } from '@/lib/protocols/core/history-result'
import {
  createGraphQLClient,
  processBatches,
} from '@/lib/protocols/core/toolkit'
import type {
  HistoryDataPoint,
  HistoryFailure,
  HistoryParams,
  HistoryResult,
  HistoryTarget,
} from '@/lib/protocols/core/types'

// ─── Response types ───────────────────────────────────────────────────────────

type AccountingSnapshot = {
  timestamp: string
  market: {
    id: string
    configuration: {
      symbol: string
      baseToken: {
        lastPriceUsd: string
        token?: { decimals?: number | string | null } | null
      }
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

  // Raw base units → whole tokens, the same conversion apy-spot applies. It has
  // to happen HERE too: without it, the apy_daily migration would re-introduce
  // raw amounts through its own re-fetch.
  const decimals = snapshot.market.configuration.baseToken.token?.decimals
  const whole = (raw: string): number => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return 0
    if (decimals == null) return n
    return n / 10 ** Number(decimals)
  }

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
      supplyAssets: whole(acc.totalBaseSupply),
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
      supplyAssets: whole(acc.totalBaseSupply),
      supplyAssetsUsd,
      borrowAssets: whole(acc.totalBaseBorrow),
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

// ─── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * The chain's market ids whose supply or borrow product was asked for.
 *
 * `MARKETS_ALL` is a single unpaginated query, so this is cheap next to the
 * snapshot pagination it narrows or avoids.
 */
async function marketsMatching(
  client: ReturnType<typeof createGraphQLClient>,
  chainId: number,
  chainName: string,
  wanted: Set<string>
): Promise<string[]> {
  const { data, error } = await client
    .query<{ markets: { id: string }[] }>(MARKETS_ALL, {})
    .toPromise()

  if (error || !data?.markets) return []

  const chain = { id: chainId, name: chainName }
  return data.markets
    .filter((m) =>
      (['supply', 'borrow'] as const).some((kind) =>
        wanted.has(buildProductId(m.id, chain, kind))
      )
    )
    .map((m) => m.id)
}

/**
 * The two accounting granularities the Compound subgraphs expose. Both entities
 * carry the SAME fields — rates, TVL, borrows, utilization and price in one
 * snapshot — so a single fetcher serves them; only the query and the entity key
 * differ.
 */
const GRANULARITY = {
  DAY: {
    query: MARKET_DAILY_ACCOUNTING,
    entityKey: 'dailyMarketAccountings',
    label: 'daily',
  },
  HOUR: {
    query: MARKET_HOURLY_ACCOUNTING,
    entityKey: 'hourlyMarketAccountings',
    label: 'hourly',
  },
} as const

export interface CompoundHistoryOpts {
  /** Canonical chain ids. Omitted = every Compound chain with a subgraph. */
  chainIds?: number[]
  /** Products to cover. Omitted = every market the subgraphs list. */
  productIds?: string[]
  targets?: HistoryTarget[]
  startTimestamp?: number
  endTimestamp?: number
  onProgress?: (msg: string) => void
}

/**
 * Fetch historical Compound V3 accounting snapshots from the on-chain subgraphs.
 *
 * Unlike Aave — whose rates and market state live in two different upstreams and
 * must be merged — one Compound snapshot already carries everything, so these
 * points come out of the box satisfying the history contract's market-state rule.
 *
 * Per-chain failures are logged and skipped: one unavailable subgraph never
 * costs the other chains their history.
 */
async function fetchCompoundHistory(
  granularity: keyof typeof GRANULARITY,
  opts?: CompoundHistoryOpts
): Promise<HistoryResult> {
  const log = opts?.onProgress ?? console.log
  const { query, entityKey, label } = GRANULARITY[granularity]

  let chainIds = Object.keys(COMPOUND_V3_CHAINS).map(Number)
  if (opts?.chainIds?.length) {
    chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
  }

  const validChains = chainIds
    .map((id) => ({ chainId: id, chainConfig: COMPOUND_V3_CHAINS[id] }))
    .filter((c) => c.chainConfig?.custom?.subgraphUrl)

  const wanted = requestedProducts(opts ?? {})?.ids ?? null

  if (validChains.length === 0) return { points: [], failures: [] }

  log(
    `[history:compound] Fetching ${label} snapshots for ${validChains.length} chains (in parallel batches)`
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

        // Targeted run: resolve which market ids matter from ONE cheap markets
        // query, then narrow the (paginated, heavy) snapshot fetch to them —
        // or skip this chain outright when none of them live here. Market ids
        // come from the subgraph and go through buildProductId; a productId is
        // never taken apart to get them.
        if (wanted) {
          const targetMarkets = await marketsMatching(
            chainClient,
            chainId,
            chainName,
            wanted
          )
          if (targetMarkets.length === 0) {
            log(
              `[history:compound] ${chainName}: no requested market — skipped`
            )
            return []
          }
          where.market_in = targetMarkets
        }

        const snapshots = await fetchAllSnapshots<AccountingSnapshot>(
          chainClient,
          query,
          where,
          entityKey,
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
          `[history:compound] ${chainName}: ${snapshots.length} ${label} snapshots`
        )
        return points
      } catch (err) {
        log(
          `[history:compound] ${chainName} ${label} failed: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    }
  )

  const collected: HistoryDataPoint[] = []
  for (const pts of chainPoints) {
    for (const pt of pts) collected.push(pt)
  }

  // One snapshot carries both sides, so a market fetched for its supply side
  // also yields a borrow point nobody asked for — drop it rather than write a
  // row the caller did not request.
  const allPoints = wanted
    ? collected.filter((p) => wanted.has(p.productId))
    : collected

  const failures: HistoryFailure[] = []
  if (wanted) {
    const returned = new Set(allPoints.map((p) => p.productId))
    for (const productId of wanted) {
      if (returned.has(productId)) continue
      failures.push({ productId, reason: 'no Compound market carries it' })
    }
  }

  log(
    `[history:compound] Total ${label}: ${allPoints.length} data points${failures.length > 0 ? `, ${failures.length} unanswered` : ''}`
  )
  return { points: allPoints, failures }
}

export function fetchCompoundDailyHistory(
  opts?: CompoundHistoryOpts
): Promise<HistoryResult> {
  return fetchCompoundHistory('DAY', opts)
}

export function fetchCompoundHourlyHistory(
  opts?: CompoundHistoryOpts
): Promise<HistoryResult> {
  return fetchCompoundHistory('HOUR', opts)
}

// ─── Contract mapping ─────────────────────────────────────────────────────────

/**
 * YieldAdapter.getApyHistory implementation for Compound V3.
 *
 * The subgraphs have exposed hourly and daily accountings all along; until
 * 2026-07-24 the adapter simply did not declare them, so the heal job had no
 * refetch path for Compound and filled EVERY Compound hole by copying a
 * neighbouring hour instead (1,160 rows, not one of them a real observation).
 * Wiring the contract turns those copies into fetched values.
 *
 * `includeMarket` is ignored: one snapshot carries rates and market state
 * together, so there is no cheaper rates-only path to offer.
 */
export function getCompoundApyHistory(
  params: HistoryParams
): Promise<HistoryResult> {
  return fetchCompoundHistory(params.interval, {
    chainIds: params.chainIds,
    productIds: params.productIds,
    targets: params.targets,
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    onProgress: params.onProgress,
  })
}
