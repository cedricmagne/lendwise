# LendWise MCP — Design Spec

Date: 2026-07-12
Status: implemented. Parts A and B shipped. Borrow read/compare added 2026-07-20 (Tier 1 — see Non-goals); borrow optimization still deferred to v2.

## Goal

An AI agent, given "I have $1K I want to place in DeFi for the next 6 months, what are the best markets?", answers it correctly against LendWise data in ~4 tool calls — without guessing asset names, without paging thousands of rows, and without being able to DoS Neon or the optimizer.

Two deliverables, shipped in order:

- **Part A — `lendwise/web`**: `/api/graphql` becomes a public contract (limits, rate limit, sortable, discoverable, latest-snapshot query). `/api/optimizer` becomes the enforced chokepoint in front of the CPU-bound solver.
- **Part B — `lendwise/mcp`**: a new public repo shipping `@lendwise/mcp`, an MCP server with 5 curated tools, in two transports (stdio + hosted Streamable HTTP).

Part A ships first. The MCP is worthless — and dangerous — against an unhardened API.

---

## Part A — web

### A0. Threat model

Today `/api/graphql` is: unauthenticated, `first` unbounded (`resolvers.ts:220` defaults to 100 but accepts any Int), no depth limit, no cost limit, no rate limit. `/api/optimizer` is: unauthenticated, no rate limit, no upstream timeout, no input size caps, fronting a CPU-expensive solver.

The moment an MCP exists, agents — ours and other people's — hammer both. The GraphQL endpoint stays public and introspectable (MCP codegen needs it; it is a read-only public API). What changes is that it becomes _bounded_.

### A1. Rate limiting — `src/lib/ratelimit.ts` (new)

`@upstash/ratelimit` + `@upstash/redis`, sliding window, keyed on `x-forwarded-for` (first hop).

- `graphqlLimiter`: 60 req / min / IP
- `optimizerLimiter`: 10 req / min / IP (solver is CPU-bound; this is the expensive path)

When `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are unset, the module exports a no-op limiter that always allows. Local dev and CI must never depend on Redis.

New env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

### A2. Query cost limits — `src/app/api/graphql/route.ts`

Add `@escape.tech/graphql-armor` plugins to the yoga instance:

| plugin          | value        |
| --------------- | ------------ |
| `maxDepth`      | 8            |
| `maxAliases`    | 8            |
| `maxDirectives` | 10           |
| `maxTokens`     | 1000         |
| `costLimit`     | maxCost 5000 |

Introspection stays **on** — deliberately. It is a read-only public API and MCP codegen depends on it.

Rate limiting runs as a yoga plugin on `onRequest`, i.e. **before parse/validate**, so a rejected request never touches the schema. On rejection: HTTP 429 with a `Retry-After` header.

### A3. `first` clamp

`MAX_FIRST = 500`. Clamped in `resolvePg` (`src/lib/graphql/resolvers.ts`) and in `queryApy` (`src/lib/db/repositories/apy.ts`, whose current `Math.min(page.first, 10_000)` is tightened to the same constant). Default stays 100.

### A4. `orderBy` is honored (fixes `resolvers.ts:222`)

Today `orderBy` is declared in the schema and thrown away: `resolvePg` hardcodes `orderBy: grain === 'hourly' ? 'hour' : 'date'`. Sorting by APY is therefore impossible server-side, which is exactly what "top N best markets" needs.

- Schema: `orderBy: String` becomes two enums.
  - `SupplyApyOrderBy`: `time | apyNet | apyBase | supplyAssetsUsd | utilizationRate`
  - `BorrowApyOrderBy`: the above + `borrowAssetsUsd`
  - `time` maps to `hour` for hourly queries and `date` for daily ones, so one enum serves both grains.
- An invalid value is now rejected at validation instead of being silently ignored.
- `Page.orderBy` (`apy.ts`) changes from `'hour' | 'date'` to that union; `queryApy` maps it to the real drizzle column.
- **Every ordering gets `productId` as a tiebreaker**, otherwise pagination over ties (many products share an APY to float precision) is non-deterministic and pages repeat or skip rows.

### A5. New root queries

#### `products(filters, first, skip): ProductsResponse!`

Filters hit typed, indexed columns only — `kind`, `protocol`, `chainId`, `asset`, `market`, `active`. **No productId parsing** (the slug is irregular: morpho has no `:kind` suffix).

New `queryProducts()` in `src/lib/db/repositories/products.ts` (which today only exposes `listActiveProducts`).

#### `productFacets(filters): ProductFacets!`

```graphql
type ProductFacets {
  assets: [AssetFacet!]! # { symbol, count }
  chains: [ChainFacet!]! # { id, name, count }
  protocols: [ProtocolFacet!]! # { name, count }
}
```

One call, and the agent stops guessing `"USDC"` / `"arbitrum"`. This is the single highest-value addition for agent correctness.

Chains are grouped by `chain_id` — never `chain_name`, which is inconsistent across adapters (Aave writes `Ethereum`, Morpho/Compound write `ethereum` / `op mainnet`). The display name is resolved from `ALL_CHAINS` in `src/config/chains.ts` (viem chain objects, canonical `id` + `name`).

#### `latestSupplyApy` / `latestBorrowApy`

```graphql
latestSupplyApy(
  filters: HourlyFilters
  first: Int = 100
  skip: Int = 0
  orderBy: SupplyApyOrderBy = apyNet
  orderDirection: OrderDirection = desc
): SupplyHourlyResponse!
```

The missing "current best APY across ~700 products" query. Without it a client must page thousands of `supplyApyHourly` rows and reduce them itself.

New `queryLatestApy(kind, filters, page)` in `apy.ts`, next to the existing `latestHourlyNet` (which does the right `DISTINCT ON (product_id)` but takes explicit productIds, so it can't discover anything):

```sql
SELECT DISTINCT ON (product_id) *
FROM apy_hourly
WHERE hour >= now() - interval '6 hours'   -- bounds the scan
ORDER BY product_id, hour DESC
```

…as a CTE, joined to `products` for filtering, then ordered/paginated by the outer query. The 6-hour window bounds the scan and naturally excludes products whose pipeline has stalled.

Returns the existing `SupplyHourlyResponse` / `BorrowHourlyResponse` types, so current codegen output stays valid.

### A6. Optimizer proxy — `src/app/api/optimizer/route.ts`

The proxy is the _only_ rate-limit chokepoint in front of the solver. `optimizer.lendwise.fi` is never called directly by anything we ship.

- `optimizerLimiter` (10/min/IP) → 429 + `Retry-After`.
- Input validation with zod, before proxying: array lengths ≤ 200 (`apy`, `max_ltv`, `rates`, `liquidity`), all numbers finite, `diversification` ∈ [0,100]. Today an unbounded `apy: number[]` reaches the solver untouched.
- `AbortSignal.timeout(10_000)` on the upstream fetch — currently unbounded, so a hung solver holds a Vercel function open to its 300s ceiling.
- Endpoint whitelist stays as-is.
- PostHog capture stays as-is.

---

## Part B — `lendwise-mcp`

New public repo at `/Users/cedric/Projects/lendwise/mcp`. Publishes `@lendwise/mcp` (bin: `lendwise-mcp`). Hosted transport deployed to `mcp.lendwise.fi`.

### B1. Layout — one package, shared core, two entrypoints

```
mcp/
  package.json          # @lendwise/mcp, bin lendwise-mcp, ESM, node 24
  codegen.ts            # graphql-codegen against LENDWISE_API_URL introspection
  src/
    core/
      config.ts         # LENDWISE_API_URL, default https://lendwise.fi
      graphql/
        client.ts       # fetch wrapper: 15s timeout, 429 → retryable error
        queries.ts      # the 4 documents the tools need
        generated/      # codegen output
      optimizer.ts      # POST {LENDWISE_API_URL}/api/optimizer
      stats.ts          # mean / stddev / min / max over a daily series
      tools/
        list-market-universe.ts
        find-best-markets.ts
        get-market-details.ts
        get-market-history.ts
        optimize-allocation.ts
      server.ts         # createServer() → registers all 5 tools
    bin/stdio.ts        # StdioServerTransport
  api/mcp.ts            # Vercel function, `mcp-handler` (Streamable HTTP)
  vercel.json
```

Both entrypoints import the same `core/`. **The repo holds no secrets** — it speaks only HTTPS to `lendwise.fi`, which is what makes it safe to be public. `LENDWISE_API_URL` is overridable for local dev against `localhost:3000`.

### B2. Tools

Five curated, zod-validated tools. The agent never writes GraphQL — it cannot guess a filter value that doesn't exist, and it cannot emit an expensive query.

| tool                   | args                                                                                                                         | returns                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_market_universe` | `kind?`                                                                                                                      | facets: assets, chains, protocols + counts (`productFacets`)                                                                                  |
| `find_best_markets`    | `kind?` (default supply), `asset?`, `chainId?`, `protocol?`, `minTvlUsd?` (default 1_000_000), `limit?` (default 10, max 50) | latest snapshot rows, net APY desc: productId, asset, chain, protocol, net/base/rewards APY, TVL, utilization, quality (`latestSupplyApy`)    |
| `get_market_details`   | `productId`                                                                                                                  | product: collaterals, protocol meta, current APY breakdown incl. reward items                                                                 |
| `get_market_history`   | `productId`, `range` (7d\|30d\|90d\|180d)                                                                                    | daily net-APY series **+ computed mean / stddev / min / max** — the stability signal a 6-month horizon actually needs (`supplyApyDaily`)      |
| `optimize_allocation`  | `amountUsd`, `productIds[]`, `diversification?` (default 80)                                                                 | calls `/api/optimizer` `/optimize/vaults`, maps `vault_index` → productId, returns per-market $ amounts, blended APY, projected 6-month yield |

**Index mapping is the load-bearing detail.** `VaultAllocationRequest` is `{ apy: number[], diversification: number }` and `VaultAllocationResult` is `{ vault_index, allocation, allocation_percent }` — positional. `optimize_allocation` builds `apy[]` from the latest snapshot in the caller's `productIds` order, then maps `vault_index` back through that same array. Get this wrong and the agent confidently recommends the wrong market. It gets a unit test.

`minTvlUsd` defaults to $1M: with $1K to place, a thin market's headline APY is noise, and steering a user into one is the most likely real-world harm this tool can do.

Every tool response carries the snapshot timestamp, the `quality` status (`quality_completeness < 0.5` is flagged unreliable), and a not-financial-advice note.

### B3. The target flow

"I have $1K for 6 months, what are the best markets?"

1. `list_market_universe` → real assets/chains/protocols
2. `find_best_markets({ asset: 'USDC', minTvlUsd: 1e6 })` → top 10 by net APY
3. `get_market_history({ productId, range: '180d' })` on the top 3–5 → mean/stddev separates a durable 6% from a 12% reward spike that ends next week
4. `optimize_allocation({ amountUsd: 1000, productIds: [...], diversification: 80 })` → the split

### B4. Error handling & data quality

- Every tool: zod-validated args, 15s fetch timeout.
- Upstream 429 is surfaced as an explicitly retryable error (with `Retry-After`), not swallowed — the agent must back off, not retry-storm the endpoint we just spent Part A protecting.
- `Promise.allSettled` wherever multiple fetches are aggregated (project convention).
- Non-finite APY values (Postgres `double precision` can hold `NaN` from a bad upstream APR) are dropped from series and never returned as `NaN`.

### B5. Testing

vitest. Unit: optimizer index mapping (both directions), `stats.ts`, argument validation, non-finite filtering. Integration: one network test against prod GraphQL, skipped unless a flag is set.

---

## Non-goals (v1)

- Borrow tools — split on the 2026-07-20 revision once the tool shape was proven:
  - **Tier 1, borrow read/compare — SHIPPED (2026-07-20).** Not new tools: `find_best_markets` and `get_market_history` gained a `kind: supply | borrow` param (default supply), joining `list_market_universe` (already had `kind`) and `get_market_details` (already kind-agnostic). Still 5 tools. `find_best_markets` also gained a borrow-only `collateral?` filter, whose valid values the agent discovers from the `collaterals` carried on returned borrow rows. The load-bearing detail: borrow net APY is a cost (`base + fees − rewards`), so borrow ranks lowest-first, and the MCP sends `orderDirection: asc` explicitly for it. `latestBorrowApy` / `borrowApyDaily` from Part A already carried the data the tools need.
    - **Follow-on Part A fix (2026-07-20):** `latestBorrowApy`'s default `orderDirection` was `desc` — inherited symmetrically from `latestSupplyApy` but wrong for a cost, so a direct GraphQL caller fetching "best borrow" without a direction got the *most expensive* first. Flipped the default to `asc` (`resolveLatest` is now kind-aware; schema SDL + description updated). Zero internal consumers; the MCP keeps its explicit `asc` as defense in depth. It is a public-contract behavior change — external clients relying on the old desc ordering will see it flip.
  - **Tier 2, borrow optimization (`optimize_borrow`, `optimize_collateral`) — still v2.** These need collateral modelling (deriving per-market `max_ltv` across Aave/Compound multi-collateral vs Morpho single `lltv`) and the two `/optimize/borrow` + `/optimize/collateral` endpoints. The proxy already whitelists both; the modelling is the open work.
- Any write/transaction capability. The MCP is read-only. It recommends; it never signs.
- API keys / per-user tiers on `/api/graphql`. IP-based limits first; keys only if abuse appears.
- A raw `graphql_query` escape hatch. It reintroduces the expensive-query surface Part A exists to close.

## Risks

- **Upstash Redis is a new hard dependency on the request path.** Mitigated by the no-op fallback: if Redis is unreachable the limiter allows the request rather than 503-ing the site. This fails open by design — availability of lendwise.fi outranks rate-limit enforcement.
- **`graphql-armor` cost limits can reject legitimate queries from the existing web UI.** The existing URQL documents must be checked against the limits before the plugin ships.
- **`latestSupplyApy`'s 6-hour window hides stalled products** rather than reporting them as stale. That is the intent (a stale APY is worse than a missing one), but it means a pipeline outage looks like "fewer markets" to an agent, not like an error. `/status` remains the place that surfaces gaps.
