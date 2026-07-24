# Protocol Adapters

How Lendwise ingests yield data, and how to contribute a new protocol.

## Architecture

One adapter per **protocol + version** (`aave_v3`, `morpho_v1`, `compound_v3`). There is no
abstraction layer between an adapter and the platform: **the Lendwise data model is the
contract**. An adapter transforms its source — a protocol GraphQL API, a subgraph, RPC calls,
anything — into the existing DB domain types (`SpotPayload`, `SupplyProduct`, `BorrowProduct`,
`HistoryDataPoint` from `src/lib/db/types.ts` / `core/types.ts`), and the pipeline takes it
from there.

```
src/lib/protocols/
├── core/                      # Lendwise-owned contract — an adapter imports FROM here
│   ├── types.ts               #   YieldAdapter, AppAdapter, FetchOpts, HistoryParams, …
│   ├── define.ts              #   defineYieldAdapter() — typed identity for inference
│   ├── validation.ts          #   zod schemas: soft (runtime) + strict (CI harness)
│   └── toolkit/               #   OPTIONAL helpers — use them or don't
│       ├── graphql-client.ts  #     createGraphQLClient (timeout, error normalization)
│       ├── batch.ts           #     processBatches (bounded concurrency)
│       ├── chain-registry.ts  #     createChainRegistry (per-chain module overrides)
│       ├── chain-slugs.ts     #     CHAIN_SLUG_MAP — canonical chainId → productId slug
│       └── merkl.ts           #     fetchMerklIncentives / lookupMerklIncentive
├── aave/v3/                   # one folder per adapter — flat, no offchain/onchain split
│   ├── index.ts               #   exports `adapter` (YieldAdapter) + `appAdapter` (AppAdapter)
│   ├── config.ts              #   AAVE_V3_API_URL, AAVE_V3_CHAINS
│   ├── listing.ts             #   THE listing predicate (see Conventions)
│   ├── products.ts            #   getProducts impl
│   ├── apy-spot.ts            #   getApySpot impl
│   ├── apy-history.ts         #   getApyHistory impl
│   ├── positions.ts           #   wallet positions (AppAdapter)
│   ├── queries.ts + generated/  # GraphQL documents + codegen output
│   └── …
├── morpho/v1/                 # same shape; config.ts also owns MORPHO_V1_INGESTION
└── compound/v3/               # same shape; per-chain subgraph overrides live in
    └── {ethereum,polygon,…}/  #   chain dirs consumed via createChainRegistry
```

Two registries wire adapters into the app:

- **`src/config/protocols-meta.ts`** — client-safe metadata (`PROTOCOLS_META`,
  `protocolVersionName()`, `adapterIdsForProvider()`). Zero server deps; UI components import
  this.
- **`src/config/protocols-server.ts`** — server-only loaders (`YIELD_ADAPTERS`,
  `APP_ADAPTERS`) that dynamic-import the heavy adapter modules. The pipeline (spot collector,
  products sync, heal, sync-history) and wallet features import this.

`YIELD_ADAPTERS` is typed `Record<ProtocolName, …>`, so every `PROTOCOLS_META` entry **must**
have a loader — the compiler enforces registry completeness. Registration is explicit; there
is no filesystem auto-discovery.

Every aggregation point uses `Promise.allSettled` — one failing adapter never blocks the
others.

## The contract

```ts
export interface YieldAdapter {
  id: string //  registry key = products.protocol_name  ('aave_v3')
  name: string //  display                                ('Aave v3')
  provider: string //  products.provider — groups versions    ('aave')
  version: string //                                          ('v3')
  chains: Record<number, AdapterChain> // chainId → { slug, …extras }
  ingestion?: IngestionFloors

  getProducts(opts?: FetchOpts): Promise<(SupplyProduct | BorrowProduct)[]>
  getApySpot(opts?: FetchOpts): Promise<SpotPayload[]>
  /** OPTIONAL — omit it and the repair job falls back to donor hours. */
  getApyHistory?(
    params: HistoryParams
  ): Promise<HistoryDataPoint[] | HistoryResult>
}
```

- `getProducts` — full catalogue of listed markets (hourly sync into the `products` table).
- `getApySpot` — one rate snapshot per product (10-minute collector into `apy_hourly`).
- `getApyHistory` — backfill source for gap healing and for `scripts/backfill-history.ts`.
  Optional, but **omitting it is expensive**: without it the heal job has no refetch
  path and fills every hole for that protocol by copying a neighbouring hour instead.
  Compound went 1,160 healed rows without a single real observation that way, purely
  because its subgraphs' hourly/daily accountings were never declared on the adapter
  (fixed 2026-07-24). Omit only when the protocol genuinely publishes no history.

### The history contract — one method, one merged dataset

A `HistoryDataPoint` carries the rates AND as much `market` state (TVL, borrows,
utilization, asset price) as the protocol can source **for that day**. Rules:

- **NULL means unknown, never 0.** A zero is a claim — "this market holds nothing" —
  and backfilled rows are add-only, so a false zero never self-corrects. It renders as a
  flat $0 TVL line for the whole period.
- **If rates and market state come from different upstreams, the ADAPTER merges them**
  by (productId, day) before returning. Callers never see two datasets and never learn
  which protocol needs how many fetches. Aave is the case in point: its unified API has
  rates only, its per-pool subgraphs have state only, and `getAaveApyHistory` joins them.
  Compound's single subgraph entity carries both and needs no merge.
- **`params.productIds` means "these products, not your catalogue".** When it is
  present the adapter MUST drop its ingestion floors from the enumeration,
  intersect the result with the requested set, and fan out over that intersection
  only. A productId is timeless; a listing predicate is not — it describes what
  we collect TODAY, so applying it to a question about a past hour makes a
  market that has since been delisted, or that dipped under a floor,
  permanently unrepairable. One Morpho market oscillating between $10,766 and
  $10,990 of borrow was exactly that: under the floor the collector skipped it,
  and the refetch could not see it either, so its holes were filled by copying
  neighbouring hours. Absent = "everything you list", which is what the backfill
  wants.

  Honouring it is also what keeps a targeted repair under the upstream's rate
  limit: Aave was fetching ~1000 reserves to repair 216, and the API cut off the
  tail of the batch. **Ignoring the field leaves an adapter conforming but slow**
  — and slow here means silently incomplete.

- **`params.targets` is the same request with each product's catalogue row**,
  and supersedes `productIds` when present. Use it to reach what enumeration
  cannot: a product the protocol has stopped LISTING is absent from every
  `where` clause, floors or no floors — but its by-id endpoint still answers
  (Morpho's `marketById` returned 49 hourly points for a delisted market on
  2026-07-24). The identifier is in `target.meta`, because **your adapter put
  it there** at `getProducts` time (`underlyingToken` for Aave, `cToken` for
  Compound, `id` for Morpho). Reading back your own vocabulary is symmetric;
  the pipeline forwards the row untouched and never learns your shape.

  Derive the requested set with `requestedProducts(params)` rather than
  reading either field directly — it takes whichever form the caller used, so
  the two can never disagree.

- **Report what you could not answer.** Return `HistoryResult { points, failures }`
  rather than a bare array when you can attribute a miss to a product. A bare
  array stays valid (`toHistoryResult` normalizes both), but without failures a
  rate-limit storm is indistinguishable from a protocol with no history — which
  is how a heal run announced `success: true, errors: []` while neighbour copies
  filled everything in.
- **`params.includeMarket === false` is the cheap path**, for callers that only want
  rates (the hourly heal job, `/api/cron/sync-history`, `--skip-market`). An adapter with
  one combined source can ignore the flag. Never a correctness switch: an adapter with no
  market source emits NULLs either way.
- **USD conversion from another provider's price is NOT an adapter's job.** That lookup
  reads our own `apy_daily`, so it lives in `src/lib/backfill/enrich-usd.ts`, applied by
  the pipeline after the fetch.

`scripts/backfill-history.ts` consumes this and nothing else — it imports no
`@/lib/protocols/<name>/…` module. A new protocol becomes backfillable the moment its
adapter is registered, with zero edits to the script.

`AppAdapter` (also in `core/types.ts`) powers the app UI — wallet positions, market-rate
charts, and the live `/supply` / `/borrow` product lists. It is optional per protocol: a
yield-only contribution is a valid contribution.

## How to add a protocol

1. **Create `src/lib/protocols/{name}/{version}/`** with an `index.ts` exporting the adapter:

   ```ts
   // src/lib/protocols/acme/v2/index.ts
   import { defineYieldAdapter } from '@/lib/protocols/core/define'
   import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'

   import { fetchAcmeApySpot } from './apy-spot'
   import { fetchAcmeProducts } from './products'

   export const adapter = defineYieldAdapter({
     id: 'acme_v2',
     name: 'Acme v2',
     provider: 'acme',
     version: 'v2',
     chains: {
       1: { slug: CHAIN_SLUG_MAP[1] }, // extras allowed: subgraphUrl, marketName, …
     },
     getProducts: fetchAcmeProducts,
     getApySpot: fetchAcmeApySpot,
     // getApyHistory: optional
   })
   ```

2. **Register it** — one entry in each registry:

   ```ts
   // src/config/protocols-meta.ts
   acme_v2: { displayName: 'Acme', versionName: 'Acme v2', provider: 'acme' },

   // src/config/protocols-server.ts
   acme_v2: () => import('@/lib/protocols/acme/v2').then((m) => m.adapter),
   ```

   `APP_ADAPTERS` entry only if you also implement `AppAdapter`.

3. **Prove it** — `pnpm adapter:test acme_v2` (see Validation below).

That's it. No DB migration: productIds, tables, and repositories are protocol-agnostic.

## Conventions

- **`listing.ts` is the single enumeration predicate.** `getProducts` and `getApySpot` run
  independently on different schedules — they MUST enumerate the exact same productId set.
  When two callers each carried their own "is this market listed?" rule, Aave's drifted three
  ways and wrote ~18,500 orphan `apy_hourly` rows a week for markets that had no `products`
  row (invisible to every read path — they all INNER JOIN `products`). One module answers the
  question; every caller imports it. Read `aave/v3/listing.ts` for the full war story.
- **Filter by `chainIds` (canonical `chain_id`), never by chain name.** `FetchOpts.chainIds`
  is the only filter shape. Chain names are inconsistent across adapters (`Ethereum` vs
  `ethereum` vs `op mainnet`); only the numeric id is canonical. The productId slug comes from
  `CHAIN_SLUG_MAP`.
- **`IngestionFloors` exist to skip noise, not to curate.** Ingestion is the one irreversible
  filter in the pipeline — a skipped market is a permanent hole in history that healing cannot
  fill. Keep floors LOW (Morpho: `minBorrowAssetsUsd: 10_000`, just enough to skip the
  thousands of permissionless markets that never saw a borrow). Display-side curation belongs
  in `src/lib/display-eligibility.ts`, which is revisable retroactively.
- **Rates are stored as APY.** Convert APR before emitting: `(1 + APR/365)^365 - 1`
  (helpers in `src/lib/utils.ts`: `aprToApyDaily`, `aprToApyPerSecond`, `aprToApyMorpho`).
  Net APY: supply `base - fees + rewards`, borrow `base + fees - rewards`.
- **Never parse a productId.** It is an opaque key. Provider/chain/asset/kind live as typed
  columns on `products` — resolve by JOIN (see `productProviders()` in
  `src/lib/db/repositories/gaps.ts`).
- TypeScript strict, no `any`, no classes, functional only. Group RPC calls into multicalls
  where possible.

## Validation — two severities

`core/validation.ts` defines both:

- **Soft (runtime)** — `spotPayloadSoftSchema`. Shape + finiteness ONLY. The collector and
  products-sync skip-and-warn a failing payload; a slot never crashes. It deliberately has
  **no magnitude bound**: dropping a finite extreme rate at ingestion manufactures the exact
  gap that the heal job then fills with the same value unguarded (see
  `src/lib/apy-validation.ts` — every `apy_hourly` row above 100 was `healed = true`).
  Extreme-but-finite rates are handled on the read side by `lib/display-eligibility.ts`.
- **Strict (CI harness)** — `spotPayloadStrictSchema` + `productStrictSchema`. Soft rules
  plus `|net| < 10` (1000%) and `chainId ∈ adapter.chains`. A new adapter quoting >1000% is
  almost always a unit bug (raw percentage vs decimal) — CI is where that dies. One exemption:
  markets at `utilizationRate >= 0.999` legitimately quote the protocol's rate-curve maximum
  (drained Morpho markets hit ~298,000% APY, reporting utilization 0.9999997…), so
  effectively-drained markets skip the bound.

The harness (`scripts/adapter-test.ts`) runs `getProducts` + `getApySpot` live and fails on:

- any strict validation failure,
- **products/spot productId set drift** (each side must cover the other exactly),
- an empty result set.

```bash
pnpm adapter:test aave_v3     # needs network; compound_v3 also needs THEGRAPH_API_KEY
```

It ends with a DefiLlama-style human-review summary — market counts per chain × kind, net APY
min/median/max, supply TVL — paste it in your PR.

## PR checklist

- [ ] `pnpm adapter:test <id>` exits 0
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green
- [ ] Harness summary table pasted in the PR description
- [ ] New protocol: `PROTOCOLS_META` + `YIELD_ADAPTERS` entries added together
- [ ] `getApyHistory` honours `productIds` (fans out over the requested products
      only, floors dropped) — or the PR says why the upstream cannot filter

## Disabling a protocol

Comment out its entries in **both** `PROTOCOLS_META` and `YIELD_ADAPTERS` (and
`APP_ADAPTERS` if present) — the `Record<ProtocolName, …>` typing forces them to move in
lockstep. Existing DB rows are untouched; the pipeline simply stops collecting.
