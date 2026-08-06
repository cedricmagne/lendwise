import {
  Backstop,
  TokenMetadata as BlendTokenMetadata,
  FixedMath,
  Network,
  PoolV1,
  PoolV2,
  Version,
  getOracleDecimals,
  getOraclePrice,
} from '@blend-capital/blend-sdk'
import { Address, Networks, rpc as stellarRpc } from '@stellar/stellar-sdk'

import type { TokenMetadata } from './types'

const RPC = process.env.STELLAR_RPC ?? 'https://mainnet.sorobanrpc.com'
const BACKSTOP_ADDRESS = {
  [Version.V1]: process.env.NEXT_PUBLIC_BACKSTOP_V1 || '',
  [Version.V2]: process.env.NEXT_PUBLIC_BACKSTOP_V2 || '',
} as const

const network: Network = {
  rpc: RPC,
  passphrase: Networks.PUBLIC,
  opts: { allowHttp: true },
}

/**
 * Minimum gap between two Soroban RPC calls, in ms.
 *
 * Pacing, not retrying, is what keeps us under a rate limit: a 429 has already
 * spent the request. And the ceiling is a RATE, not a volume — the two entry
 * points prove it, measured 2026-08-06 with both versions in parallel:
 *
 *   getApySpot    80 requests, peak  9/s — never refused in production
 *   getProducts   32 requests, peak 11/s — refused every single run
 *
 * The heavier path by call count is the one that passes. So the endpoint's real
 * ceiling sits between 9 and 11 req/s, not the 15 this was first calibrated
 * for. Blend products were absent from the catalogue for hours because of it,
 * and every collector slot in between discarded its 78 Blend snapshots.
 *
 * This interval does NOT translate into a rate one-for-one: the SDK fires
 * several requests inside a single wrapped `load()` and those are not spaced
 * against each other, so the burst survives a small increase. Measured on the
 * products path, both versions in parallel:
 *
 *   80 ms → peak 11/s, 4.1s      150 ms → peak 9/s, 4.3s
 *  300 ms → peak  7/s, 6.2s      600 ms → peak 5/s, 11.6s
 *
 * Hence 300, not the 12.5/s that 80 ms nominally caps at: it is the first value
 * that buys real margin under the rate the spot path sustains, and it costs the
 * enumeration two seconds.
 *
 * `STELLAR_RPC_MIN_INTERVAL_MS` overrides it — raise it for a stricter endpoint
 * (the free public one needs far more and will 429 regardless), lower it on a
 * faster plan to shorten the run. Verify against the measured PEAK rate, never
 * against the total or the nominal cap.
 */
const RPC_MIN_INTERVAL_MS = Number(
  process.env.STELLAR_RPC_MIN_INTERVAL_MS ?? 300
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Whether a failure is the endpoint refusing us rather than the chain
 * answering.
 *
 * A 429 or a 5xx means the data exists and we simply were not served. A
 * contract trap (`Error(Contract, #2)`) or an undecodable result IS the
 * answer: that oracle carries no feed for the asset, today and on every retry.
 *
 * Everything downstream hangs off this line. A refusal must surface as a thrown
 * error so the route returns 500 and QStash re-runs the job; only a real
 * "no feed" may be recorded as an unknown price. Blur the two and a
 * rate-limited slot is persisted with null USD on live reserves while the job
 * reports success — nothing retries, and the gap is permanent.
 */
export function isRpcRefusal(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response
    ?.status
  if (typeof status === 'number') return status === 429 || status >= 500
  const msg = err instanceof Error ? err.message : String(err)
  return /429|too many requests|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(
    msg
  )
}

let rpcQueue: Promise<unknown> = Promise.resolve()
let lastCallAt = 0

/**
 * Serializes every Soroban RPC read in this module behind a minimum interval.
 *
 * There is deliberately NO retry here. QStash already retries the job — one
 * request per protocol, so a Blend failure re-runs Blend alone — and a second
 * retry ladder inside the process only stacks delays under a limiter whose
 * window outlasts any backoff we could afford to sit through.
 *
 * Module-level state on purpose: `getProducts` and `getApySpot` run
 * concurrently in the harness, and a per-call throttle would let them burst
 * past each other into the same limit.
 */
function pacedRpc<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = lastCallAt + RPC_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastCallAt = Date.now()
    return fn()
  }
  // Chained on both settle paths so one rejection cannot stall the queue.
  const result = rpcQueue.then(run, run)
  rpcQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/**
 * Fetches the backstop data.
 * @param enabled - Whether the query is enabled (optional - defaults to true)
 * @returns Query result with the backstop data.
 */
export async function getBackstop({
  version,
  rpc,
}: {
  version?: Version
  rpc?: string
}): Promise<Backstop> {
  return await pacedRpc(() =>
    Backstop.load(
      { ...network, rpc: rpc ?? network.rpc },
      BACKSTOP_ADDRESS[version ?? Version.V1]
    )
  )
}

/**
 * Fetches the backstop data.
 * @param enabled - Whether the query is enabled (optional - defaults to true)
 * @returns Query result with the backstop data.
 */
export async function getPool({
  version,
  poolId,
}: {
  version?: Version
  poolId: string
}): Promise<PoolV1 | PoolV2> {
  if (version === Version.V2) {
    return await pacedRpc(() => PoolV2.load(network, poolId))
  }
  return await pacedRpc(() => PoolV1.load(network, poolId))
}

/**
 * Process-lifetime cache. A token contract's name, symbol and decimals are
 * immutable, and the same asset recurs across pools AND across the two entry
 * points — `getProducts` and `getApySpot` were each paying for the same reads
 * behind their own local caches. Halving that traffic is the cheapest thing we
 * can do about the rate limit.
 */
const tokenMetadataCache = new Map<string, TokenMetadata>()

/**
 * Warms the cache for a whole pool's assets in ONE `getLedgerEntries` call.
 *
 * `TokenMetadata.load` sends a single key per request, so a pool's assets cost
 * a request each. The RPC accepts as many keys as we send, and the SDK exposes
 * both halves of the round trip — `ledgerKey` to build it, `fromLedgerEntryData`
 * to parse it — so the whole set fits in one.
 *
 * This only works because the app pins @stellar/stellar-sdk to the SAME exact
 * version blend-sdk pins (16.0.0, no caret). With two copies resolved, pnpm
 * hands each its own XDR namespace, and blend's `decodeEntryKey` — which
 * `switch`es on `entryKey.switch()`, comparing by object identity — matches
 * none of its own `case`s against an entry parsed by ours, and throws. That
 * failed on every asset, one key or ten, while `TokenMetadata.load` on the same
 * asset succeeded because it never left blend's copy.
 *
 * So the version alignment in package.json is load-bearing, not cosmetic: relax
 * it to a caret and this silently breaks at runtime. More generally, never hand
 * an XDR value built by one copy to a parser from another.
 *
 * Entries all come back under the same `ContractInstance` key, so they are
 * matched to their asset by contract address, not by position — the RPC does
 * not promise to echo the order it was given, and omits keys it cannot find.
 * Best-effort: an asset the batch misses stays uncached and `getTokenMetadata`
 * falls back to loading it alone.
 */
export async function primeTokenMetadata(
  assetIds: string[],
  rpc?: string
): Promise<void> {
  const missing = assetIds.filter((id) => !tokenMetadataCache.has(id))
  if (missing.length === 0) return

  const server = new stellarRpc.Server(rpc ?? network.rpc, network.opts)
  const keys = missing.map((id) => BlendTokenMetadata.ledgerKey(id))
  const { entries } = await pacedRpc(() => server.getLedgerEntries(...keys))

  for (const entry of entries) {
    const assetId = Address.fromScAddress(
      entry.val.contractData().contract()
    ).toString()
    const meta = BlendTokenMetadata.fromLedgerEntryData(entry.val)
    tokenMetadataCache.set(assetId, {
      address: assetId,
      symbol: meta.symbol,
      name: humanTokenName(meta.name, meta.symbol),
      decimals: meta.decimals,
    })
  }
}

/**
 * A Stellar asset contract's `name` is its canonical ledger identifier, not a
 * label for a human: a classic asset reads `CODE:GISSUER…` and the lumen reads
 * `native`. The SDK normalizes `symbol` (`native` → `XLM`) but leaves `name`
 * verbatim, so it reached `products.asset_name` — and the tables — as
 * `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`.
 *
 * Stripping the issuer leaves the asset code, which is what every other
 * protocol's `asset_name` already holds. The issuer is not lost: it is the
 * contract address, carried in `asset.address`.
 */
function humanTokenName(rawName: string, symbol: string): string {
  if (rawName === 'native') return 'Stellar Lumens'
  const code = rawName.split(':')[0]
  return code || symbol
}

/**
 * Fetches static token metadata (name, symbol, decimals) for a reserve asset,
 * read directly off the ledger — not a simulated contract invocation.
 *
 * Call `primeTokenMetadata` for the pool first: this then serves every asset
 * from cache, and only an asset the batch missed costs its own request.
 */
export async function getTokenMetadata(
  assetId: string,
  rpc?: string
): Promise<TokenMetadata> {
  const cached = tokenMetadataCache.get(assetId)
  if (cached) return cached

  const meta = await pacedRpc(() =>
    BlendTokenMetadata.load({ ...network, rpc: rpc ?? network.rpc }, assetId)
  )
  const token: TokenMetadata = {
    address: assetId,
    symbol: meta.symbol,
    name: humanTokenName(meta.name, meta.symbol),
    decimals: meta.decimals,
  }
  tokenMetadataCache.set(assetId, token)
  return token
}

/**
 * Fetches oracle prices for a pool's reserve assets, in the pool's oracle
 * denomination (USD for every Blend pool live today). Returns assetId → price;
 * an asset the oracle cannot price is simply ABSENT from the map.
 *
 * Deliberately not `PoolOracle.load`: that one runs `Promise.all` over the
 * assets, so a single unpriceable asset rejects the whole call and costs the
 * pool every other price it did have. Two of the five V1 pools hit exactly
 * that — FxDAO's oracle traps with `Error(Contract, #2)` on one asset, and
 * ClickPesa's returns a `None` the SDK reports as "Unable to decode oracle
 * price result". Losing those two pools entirely also broke the rule that
 * `getProducts` and `getApySpot` enumerate the same productIds.
 *
 * A missing FEED is not fatal here because rates do not come from the oracle:
 * the IRM gives `supplyApr`/`borrowApr` regardless. Only the USD conversions
 * need a price, and those columns are nullable precisely so "unknown" can be
 * said out loud.
 *
 * A REFUSAL is fatal, and rethrows. The job must fail so QStash re-runs it:
 * swallowing a 429 into a null price persists the slot, reports success, and
 * leaves a live reserve's USD permanently blank with nothing left to retry.
 */
export async function getPoolPrices({
  oracleId,
  assetIds,
  rpc,
}: {
  oracleId: string
  assetIds: string[]
  rpc?: string
}): Promise<Map<string, number>> {
  const net = { ...network, rpc: rpc ?? network.rpc }

  const { decimals } = await pacedRpc(() => getOracleDecimals(net, oracleId))

  const prices = new Map<string, number>()
  for (const assetId of assetIds) {
    try {
      const { price } = await pacedRpc(() =>
        getOraclePrice(net, oracleId, assetId)
      )
      prices.set(assetId, FixedMath.toFloat(price, decimals))
    } catch (err) {
      if (isRpcRefusal(err)) throw err
      // Structural: this oracle carries no feed for the asset. Logged rather
      // than silent, because an asset that starts failing is worth noticing.
      console.warn(
        `[blend] No oracle feed for ${assetId} from ${oracleId}: ${err}`
      )
    }
  }
  return prices
}
