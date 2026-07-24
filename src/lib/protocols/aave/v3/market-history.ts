/**
 * Historical MARKET STATE (deposits, borrows, utilization, oracle price) for
 * Aave V3 pools, from the official subgraphs on The Graph — the complement of
 * apy-history.ts, whose unified-API source carries rates only.
 *
 * One subgraph = one Pool. AAVE_V3_SUBGRAPH_URLS is keyed by product network
 * slug (ethereum / ethereum-lido / ethereum-etherfi); ethereum-horizon has no
 * published subgraph and is simply absent.
 *
 * Strategy — one closing state per reserve per UTC day: the LAST
 * `reserveParamsHistoryItem` before midnight, which matches the apy_daily
 * convention for stocks (APY_DAILY_SCHEMA.md §4). Days are batched ~30 per
 * request via GraphQL aliases. Days with no event carry the previous state
 * forward (the reserve did not move) — except the price, which is an
 * observation, not a state, and is never carried.
 *
 * Utilization is RECOMPUTED as borrows / aToken supply — the same definition as
 * the live spot pipeline (borrowAssetsUsd / supplyAssetsUsd in apy-spot.ts) so
 * the two eras cannot drift at the seam. It differs from the interest-rate
 * model's `debt / (availableLiquidity + debt)` by accruedToTreasury only
 * (~0.02% measured). The entity's own `utilizationRate` field is NOT used: it
 * derives from a running internal `totalLiquidity` counter that drifts and goes
 * negative on the Lido/EtherFi subgraphs (observed −1.11 for GHO).
 */
import { AAVE_V3_SUBGRAPH_URLS } from '@/lib/protocols/aave/v3/config'
import { processBatches } from '@/lib/protocols/core/toolkit'

const DAY = 86_400
/** Aave V3's oracle base currency is USD with 8 decimals. */
const ORACLE_USD_DECIMALS = 8

// ─── Types ────────────────────────────────────────────────────────────────────

/** Closing market state of one reserve on one UTC day, in human token units. */
export interface AaveMarketDayState {
  supplyAssets: number
  borrowAssets: number
  utilizationRate: number
  /** Subgraph oracle price that day, or null when it records none. */
  priceUsd: number | null
  /** True when no event happened that day and the previous state was reused. */
  carried: boolean
}

export interface AaveMarketHistoryOpts {
  /** Inclusive UTC-day window. */
  from: Date
  to: Date
  /** Restrict to some pools; default = every slug with a known subgraph. */
  networkSlugs?: string[]
  /** UTC days per GraphQL request (aliases). Default 30. */
  batchDays?: number
  /** Reserves fetched in parallel per pool. Default 4. */
  concurrency?: number
  onProgress?: (msg: string) => void
}

/**
 * Join key for a (productId, UTC day) pair — the same key the rates side of
 * getApyHistory builds, so the two datasets merge without either knowing the
 * other's shape.
 */
export function marketDayKey(productId: string, day: Date): string {
  return `${productId}|${Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())}`
}

interface SubgraphReserve {
  id: string
  underlyingAsset: string
  symbol: string
  decimals: number
}

interface ParamsItem {
  timestamp: number
  totalATokenSupply: string
  totalCurrentVariableDebt: string
  totalPrincipalStableDebt: string
  priceInUsd: string
}

type DayState = AaveMarketDayState

// ─── Transport ────────────────────────────────────────────────────────────────

/**
 * POST a query to the gateway with backoff.
 *
 * Plain fetch rather than the shared `createGraphQLClient`: that helper builds
 * `AbortSignal.timeout()` ONCE inside a static `fetchOptions` object, so the
 * deadline starts at client creation and would abort every request a long
 * backfill makes after the first minute. Here each attempt gets its own signal.
 */
async function gql<T>(
  url: string,
  apiKey: string,
  query: string,
  attempt = 1
): Promise<T> {
  const MAX_ATTEMPTS = 4
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

    const json = (await res.json()) as {
      data?: T
      errors?: { message: string }[]
    }
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '))
    }
    if (!json.data) throw new Error('empty response')
    return json.data
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err
    // 429 and gateway hiccups are the expected failures — back off and retry.
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    return gql<T>(url, apiKey, query, attempt + 1)
  }
}

const ITEM_FIELDS =
  'timestamp totalATokenSupply totalCurrentVariableDebt totalPrincipalStableDebt priceInUsd'

/**
 * One request covering a chunk of UTC days, plus (optionally) the last event
 * BEFORE the window — the seed the carry-forward starts from, so day 1 is not
 * blank just because nothing happened that particular day.
 *
 * Aliases are keyed by the day's start timestamp (`t<start>`) rather than by
 * index, so responses from split retries (see fetchDays) merge unambiguously.
 */
function daysQuery(
  reserveId: string,
  dayStarts: number[],
  seedBefore?: number
): string {
  const parts = dayStarts.map(
    (start) =>
      `t${start}: reserveParamsHistoryItems(where: {reserve: "${reserveId}", timestamp_gte: ${start}, timestamp_lt: ${start + DAY}}, first: 1, orderBy: timestamp, orderDirection: desc) { ${ITEM_FIELDS} }`
  )
  if (seedBefore !== undefined) {
    parts.unshift(
      `seed: reserveParamsHistoryItems(where: {reserve: "${reserveId}", timestamp_lt: ${seedBefore}}, first: 1, orderBy: timestamp, orderDirection: desc) { ${ITEM_FIELDS} }`
    )
  }
  return `query { ${parts.join('\n')} }`
}

/**
 * Fetch a chunk of days, bisecting on failure. Some pools' subgraphs are served
 * by few, weak indexers (Lido rejects 30-alias batches with "bad indexers" /
 * BadResponse(400) while the main pool takes them fine) — halving the batch
 * until it fits beats hardcoding the lowest common denominator for everyone.
 */
async function fetchDays(
  url: string,
  apiKey: string,
  reserveId: string,
  dayStarts: number[],
  seedBefore?: number
): Promise<Record<string, ParamsItem[]>> {
  try {
    return await gql<Record<string, ParamsItem[]>>(
      url,
      apiKey,
      daysQuery(reserveId, dayStarts, seedBefore)
    )
  } catch (err) {
    if (dayStarts.length <= 1) throw err
    const mid = Math.ceil(dayStarts.length / 2)
    const first = await fetchDays(
      url,
      apiKey,
      reserveId,
      dayStarts.slice(0, mid),
      seedBefore
    )
    const second = await fetchDays(url, apiKey, reserveId, dayStarts.slice(mid))
    return { ...first, ...second }
  }
}

// ─── Per-reserve daily series ─────────────────────────────────────────────────

function toDayState(
  item: ParamsItem,
  decimals: number
): Omit<DayState, 'carried'> {
  const scale = 10 ** decimals
  const supplyAssets = Number(item.totalATokenSupply) / scale
  const borrowAssets =
    (Number(item.totalCurrentVariableDebt) +
      Number(item.totalPrincipalStableDebt)) /
    scale
  const utilizationRate = supplyAssets > 0 ? borrowAssets / supplyAssets : 0
  const rawPrice = Number(item.priceInUsd) / 10 ** ORACLE_USD_DECIMALS

  return {
    supplyAssets,
    borrowAssets,
    utilizationRate,
    priceUsd: Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null,
  }
}

async function fetchReserveSeries(
  url: string,
  apiKey: string,
  reserve: SubgraphReserve,
  dayStarts: number[],
  batchDays: number
): Promise<Map<number, DayState>> {
  const series = new Map<number, DayState>()
  let last: Omit<DayState, 'carried'> | null = null

  for (let i = 0; i < dayStarts.length; i += batchDays) {
    const chunk = dayStarts.slice(i, i + batchDays)
    const data = await fetchDays(
      url,
      apiKey,
      reserve.id,
      chunk,
      i === 0 ? dayStarts[0] : undefined
    )

    if (i === 0 && data.seed?.[0]) {
      last = toDayState(data.seed[0], reserve.decimals)
    }

    chunk.forEach((start) => {
      const item = data[`t${start}`]?.[0]
      if (item) {
        last = toDayState(item, reserve.decimals)
        series.set(start, { ...last, carried: false })
      } else if (last) {
        // No event that day — carry forward, except the price (see header).
        series.set(start, { ...last, priceUsd: null, carried: true })
      }
      // else: before this reserve's first event — leave the day unknown.
    })
  }

  return series
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch the daily closing market state of every reserve of every requested
 * Aave V3 pool over [from, to], keyed by `marketDayKey(productId, day)`.
 *
 * A reserve yields BOTH product ids (`…:supply` and `…:borrow`) with the same
 * underlying state — the caller keeps whichever ids its rate points actually
 * carry, so a non-borrowable reserve simply never matches its borrow key.
 * Reserves that fail after retries are logged and skipped — one bad reserve
 * never blocks the rest.
 */
export async function fetchAaveMarketHistory(
  opts: AaveMarketHistoryOpts
): Promise<Map<string, AaveMarketDayState>> {
  const log = opts.onProgress ?? console.log
  const batchDays = opts.batchDays ?? 30
  const concurrency = opts.concurrency ?? 4

  const apiKey = process.env.THEGRAPH_API_KEY
  if (!apiKey) {
    throw new Error(
      '[market-history:aave] THEGRAPH_API_KEY is required (The Graph gateway)'
    )
  }

  let entries = Object.entries(AAVE_V3_SUBGRAPH_URLS)
  if (opts.networkSlugs?.length) {
    entries = entries.filter(([slug]) => opts.networkSlugs!.includes(slug))
  }

  const dayStarts: number[] = []
  for (let t = opts.from.getTime(); t <= opts.to.getTime(); t += DAY * 1000) {
    dayStarts.push(Math.floor(t / 1000))
  }

  const states = new Map<string, AaveMarketDayState>()

  for (const [slug, url] of entries) {
    const { reserves } = await gql<{ reserves: SubgraphReserve[] }>(
      url,
      apiKey,
      `query { reserves(first: 1000) { id underlyingAsset symbol decimals } }`
    )
    log(
      `[market-history:aave] ${slug}: ${reserves.length} reserves, ${dayStarts.length} days (~${Math.ceil(dayStarts.length / batchDays)} requests each)`
    )

    let done = 0
    const perReserve = await processBatches(
      reserves,
      async (reserve) => {
        try {
          const series = await fetchReserveSeries(
            url,
            apiKey,
            reserve,
            dayStarts,
            batchDays
          )
          done++
          log(
            `[market-history:aave] ${slug} [${String(done).padStart(3)}/${reserves.length}] ${reserve.symbol.padEnd(20)} ${series.size} days`
          )
          return { reserve, series }
        } catch (err) {
          done++
          log(
            `[market-history:aave] ${slug} [${String(done).padStart(3)}/${reserves.length}] ${reserve.symbol.padEnd(20)} FAILED: ${err instanceof Error ? err.message : String(err)}`
          )
          return null
        }
      },
      concurrency
    )

    for (const { reserve, series } of perReserve) {
      const asset = reserve.underlyingAsset.toLowerCase()
      for (const [start, state] of series) {
        const day = new Date(start * 1000)
        // Constructing a productId is an adapter's prerogative; PARSING one
        // anywhere is not (see CLAUDE.md — resolve by JOIN, never by split).
        for (const kind of ['supply', 'borrow'] as const) {
          states.set(
            marketDayKey(`aave:v3:${slug}:reserve:${asset}:${kind}`, day),
            state
          )
        }
      }
    }
  }

  log(
    `[market-history:aave] Total: ${states.size} (product, day) market states`
  )
  return states
}
