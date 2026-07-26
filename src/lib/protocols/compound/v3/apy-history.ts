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

/** What the listing knew about the requested products, on one chain. */
interface ListingMatch {
  /** Market ids whose supply or borrow product was asked for. */
  marketIds: string[]
  /** Requested productIds this chain's listing recognised. */
  listed: Set<string>
  /** Set when the listing query itself failed — "unknown", not "absent". */
  error?: string
}

/**
 * The chain's market ids whose supply or borrow product was asked for, and the
 * requested productIds the listing recognised.
 *
 * `MARKETS_ALL` is a single unpaginated query, so this is cheap next to the
 * snapshot pagination it narrows or avoids.
 *
 * It returns the recognised productIds too, because a product that is LISTED
 * but unanswered and a product NO listing knows are different incidents, and
 * only this function can tell them apart.
 */
async function marketsMatching(
  client: ReturnType<typeof createGraphQLClient>,
  chainId: number,
  chainName: string,
  wanted: Set<string>
): Promise<ListingMatch> {
  const { data, error } = await client
    .query<{ markets: { id: string }[] }>(MARKETS_ALL, {})
    .toPromise()

  if (error || !data?.markets) {
    return {
      marketIds: [],
      listed: new Set(),
      error: error?.message ?? 'no markets returned',
    }
  }

  const chain = { id: chainId, name: chainName }
  const marketIds: string[] = []
  const listed = new Set<string>()

  for (const m of data.markets) {
    const sides = (['supply', 'borrow'] as const)
      .map((kind) => buildProductId(m.id, chain, kind))
      .filter((id) => wanted.has(id))
    if (sides.length === 0) continue
    marketIds.push(m.id)
    for (const id of sides) listed.add(id)
  }

  return { marketIds, listed }
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

  const chainOutcomes = await processBatches(
    validChains,
    async ({ chainId, chainConfig }) => {
      const chainClient = createGraphQLClient(
        chainConfig.custom!.subgraphUrl!,
        process.env.THEGRAPH_API_KEY,
        60_000
      )
      const chainName = chainConfig.name.toLowerCase()
      let listedHere = new Set<string>()

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
          const match = await marketsMatching(
            chainClient,
            chainId,
            chainName,
            wanted
          )
          if (match.error) {
            log(
              `[history:compound] ${chainName}: listing failed — ${match.error}`
            )
            return { points: [], listed: match.listed, failedChain: chainName }
          }
          if (match.marketIds.length === 0) {
            log(
              `[history:compound] ${chainName}: no requested market — skipped`
            )
            return { points: [], listed: match.listed }
          }
          listedHere = match.listed
          where.market_in = match.marketIds
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
        return { points, listed: listedHere }
      } catch (err) {
        log(
          `[history:compound] ${chainName} ${label} failed: ${err instanceof Error ? err.message : String(err)}`
        )
        // NOT null: a chain that blew up must still be able to say so, or its
        // products come back indistinguishable from products Compound has
        // never carried.
        return { points: [], listed: listedHere, failedChain: chainName }
      }
    }
  )

  const collected: HistoryDataPoint[] = []
  const listedAnywhere = new Set<string>()
  const failedChains: string[] = []
  for (const outcome of chainOutcomes) {
    for (const pt of outcome.points) collected.push(pt)
    if (outcome.failedChain) {
      // A chain that broke knows nothing reportable about its products: it may
      // have listed them a moment before failing, and "listed, no snapshot"
      // would read as a quiet upstream gap rather than the outage it is.
      failedChains.push(outcome.failedChain)
      continue
    }
    for (const id of outcome.listed) listedAnywhere.add(id)
  }

  // One snapshot carries both sides, so a market fetched for its supply side
  // also yields a borrow point nobody asked for — drop it rather than write a
  // row the caller did not request.
  const allPoints = wanted
    ? collected.filter((p) => wanted.has(p.productId))
    : collected

  // Three ways to go unanswered, and they are not the same incident.
  //
  // Reporting all of them as a missing market sent a reader after a delisting
  // that had not happened: on 2026-07-26 the nine markets so reported were
  // active, catalogued and collected normally — only the HOUR was absent
  // upstream. Compound's subgraph writes an accounting row when a market saw
  // activity in the hour, not every hour (measured: 23 rows over a 48-hour
  // window), so a listed market with no row is the norm and the neighbour
  // fallback is the correct outcome, not a bug to chase.
  const failures: HistoryFailure[] = []
  if (wanted) {
    const returned = new Set(allPoints.map((p) => p.productId))
    for (const productId of wanted) {
      if (returned.has(productId)) continue
      failures.push({
        productId,
        reason: listedAnywhere.has(productId)
          ? 'market listed but no accounting snapshot in the window'
          : failedChains.length > 0
            ? `Compound could not answer on ${failedChains.join(', ')} — cannot tell whether it carries this product`
            : 'no Compound market carries it',
      })
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
