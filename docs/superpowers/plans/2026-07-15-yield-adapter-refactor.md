# Yield Adapter Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-15-yield-adapter-refactor-design.md`

**Goal:** One adapter per protocol+version (`aave_v3`, `morpho_v1`, `compound_v3`) implementing a Lendwise-owned `YieldAdapter` contract (`getProducts` / `getApySpot` / `getApyHistory?`), with the dead `offchain/`/`onchain/` split, the `DataSourceConfig`/`VersionAdapter` machinery, and productId parsing in heal all removed, plus a CI harness that validates any adapter (DefiLlama yield-server model).

**Architecture:** The Lendwise data model _is_ the interface — adapters transform their source (protocol API, subgraph, RPC) into the existing DB types (`SpotPayload`, `SupplyProduct`, `BorrowProduct`, `HistoryDataPoint`). A client-safe `PROTOCOLS_META` registry feeds the UI; a server-only `YIELD_ADAPTERS`/`APP_ADAPTERS` registry with dynamic imports feeds the pipeline and wallet features. Core provides an optional toolkit (graphql client, batching, Merkl, chain slugs) and zod validation with two severities (soft at runtime, strict in CI).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle/Neon, graphql-yoga + URQL, @graphql-codegen, zod 4, vitest, tsx.

## Global Constraints

- **No DB schema changes** — productIds, tables, repositories untouched (spec §11).
- **Never parse `productId`** — resolve provider by JOIN on `products.provider` (spec §8; CLAUDE.md rule).
- **Filter/group chains by `chain_id`, never chain name** — `chainIds?: number[]` replaces `chainFilter?: string` everywhere (spec §3).
- **No business-logic changes** in existing fetch/transform code: Merkl attribution, incentives, listing predicates, APR→APY math move but do not change (spec §11).
- **`Promise.allSettled`** kept at every aggregation point — one failed source never blocks others (spec §8).
- **Explicit registry, no filesystem auto-discovery** of adapters (spec §11).
- **Pipeline equivalence**: after each adapter migration, spot payload count and productId set must be identical to the pre-refactor baseline for that protocol (spec §10, §12).
- **Ingestion never drops finite data** (deviation from spec §6, see below): runtime soft validation checks shape + finiteness only; the `|apy_net| < 10` magnitude bound applies in the strict CI harness only. Dropping a finite extreme rate at ingestion manufactures the gap that the heal job then fills with the same value unguarded — the exact bug documented in `src/lib/apy-validation.ts` (all 479 rows above 100 in `apy_hourly` were `healed = true`). Display eligibility (`lib/display-eligibility.ts`) already handles extreme-but-finite rates on the read side.
- **`AppAdapter` includes `getSupplyProducts`/`getBorrowProducts`** (deviation from spec §7, which omitted them): `src/app/actions/products.actions.ts` — the live `/supply` and `/borrow` pages — consumes them through the legacy `ProtocolAdapter`. Dropping them would break both pages.
- **Compound keeps its history fetchers as plain module exports** (`fetchCompoundDailyHistory`, `fetchCompoundHourlyHistory`, used by `/api/cron/sync-history`) but its `YieldAdapter` omits `getApyHistory`, so the heal job keeps donor-based fallback for Compound (spec §3 decision).
- TypeScript strict, no `any`, no classes, functional only (CLAUDE.md).
- Do not push or open PRs; commit locally per task. Cedric decides integration.

---

## File Structure

| File                                                                                                                   | Responsibility                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/protocols/core/types.ts`                                                                                      | Contract types: `YieldAdapter`, `AppAdapter`, `AdapterChain`, `FetchOpts`, `HistoryParams`, `HistoryDataPoint`, `IngestionFloors`, `RateParams`.                           |
| `src/lib/protocols/core/define.ts`                                                                                     | `defineYieldAdapter()` typed identity helper.                                                                                                                              |
| `src/lib/protocols/core/validation.ts`                                                                                 | zod schemas for `SpotPayload` and products; strict (harness) and soft (runtime) parse helpers.                                                                             |
| `src/lib/protocols/core/toolkit/{graphql-client,batch,chain-registry,types,chain-slugs,merkl}.ts`                      | Optional adapter toolkit, moved from `shared/` + `chain-slugs.ts` + Merkl extracted from Aave.                                                                             |
| `src/config/protocols-meta.ts`                                                                                         | Client-safe metadata registry: `PROTOCOLS_META`, `ProtocolName`, `protocolVersionName()`, `adapterIdsForProvider()`.                                                       |
| `src/config/protocols-server.ts`                                                                                       | Server-only dynamic-import registries: `YIELD_ADAPTERS`, `APP_ADAPTERS`.                                                                                                   |
| `src/lib/protocols/aave/v3/{index,config,positions,...}.ts`                                                            | Aave adapter flattened: `offchain/` contents move up one level, `onchain/` deleted, `adapter` exported.                                                                    |
| `src/lib/protocols/morpho/v1/{index,config,positions,...}.ts`                                                          | Morpho adapter, same treatment.                                                                                                                                            |
| `src/lib/protocols/compound/v3/{index,config,positions,...}.ts`                                                        | Compound adapter: `onchain/` contents move up one level; chain-override subdirs (`ethereum/`, `polygon/`, …) stay as internal detail.                                      |
| `src/app/actions/{apy-snapshots,products-sync,user-*-positions,market-rates,products}.actions.ts`                      | Call sites rewired to the registries.                                                                                                                                      |
| `src/app/api/yield/apy/heal/route.ts`, `src/lib/db/repositories/gaps.ts`                                               | Heal groups gaps by provider via `products` JOIN, calls `adapter.getApyHistory?.()`.                                                                                       |
| `src/app/api/cron/sync-history/route.ts`, `src/app/api/yield/apy/spot/route.ts`, `src/app/api/yield/products/route.ts` | Via registry / meta.                                                                                                                                                       |
| `codegen.ts`                                                                                                           | Generated paths updated (`offchain/generated` → `generated`), dead aave/morpho onchain targets removed.                                                                    |
| `scripts/adapter-test.ts`, `package.json`                                                                              | CI harness `pnpm adapter:test <id>`.                                                                                                                                       |
| `src/lib/protocols/README.md`                                                                                          | Rewritten as "How to add a protocol" contributor guide.                                                                                                                    |
| Deleted                                                                                                                | `aave/v3/onchain/`, `morpho/v1/onchain/`, `src/lib/protocols/{types,utils}.ts` legacy machinery, `src/config/protocols.ts`, `src/hooks/useMarketStats.ts`, `shared/` shim. |

## Contract (single source of truth for every task)

```ts
// src/lib/protocols/core/types.ts
import type { Address } from 'viem'

import type {
  ApyBreakdown,
  BorrowMarketState,
  BorrowProduct,
  SpotPayload,
  SupplyMarketState,
  SupplyProduct,
} from '@/lib/db/types'
import type {
  BorrowPosition,
  MarketRate,
  SupplyPosition,
  TimeframeLabel,
  BorrowProduct as UiBorrowProduct,
  SupplyProduct as UiSupplyProduct,
} from '@/types'

/** Minimal chain config. Adapter-specific extras allowed. */
export interface AdapterChain {
  /** Canonical productId slug — must match CHAIN_SLUG_MAP. */
  slug: string
  /** Adapter-owned extras (subgraphUrl, marketName, …). */
  [key: string]: unknown
}

export interface FetchOpts {
  /** Filter by canonical chain_id. Replaces the old name-matching chainFilter. */
  chainIds?: number[]
}

export interface HistoryParams {
  startTimestamp: number // unix seconds
  endTimestamp: number // unix seconds
  interval: 'HOUR' | 'DAY'
  chainIds?: number[]
  onProgress?: (msg: string) => void
}

/** Moved from aave/v3/apy-history.ts — contract type, not an Aave detail. */
export type HistoryDataPoint = {
  timestamp: Date
  productId: string
  kind: 'supply' | 'borrow'
  apy: ApyBreakdown
  market: SupplyMarketState | BorrowMarketState
}

/**
 * Ingestion floors — moved verbatim from src/config/protocols.ts, including its
 * full doc comment (the "one irreversible filter" rationale).
 */
export interface IngestionFloors {
  minBorrowAssetsUsd?: number
  minTvlUsd?: number
}

export interface YieldAdapter {
  /** Unique. = registry key = protocol_name in DB. Ex: 'aave_v3'. */
  id: string
  /** Display name. Ex: 'Aave v3'. */
  name: string
  /** Groups versions. Ex: 'aave'. = provider column. */
  provider: string
  /** Ex: 'v3'. */
  version: string
  /** chainId → chain config. Source of truth for supported chains. */
  chains: Record<number, AdapterChain>
  ingestion?: IngestionFloors

  getProducts(opts?: FetchOpts): Promise<(SupplyProduct | BorrowProduct)[]>
  getApySpot(opts?: FetchOpts): Promise<SpotPayload[]>
  /** OPTIONAL — a protocol without a usable history source omits it; heal falls back to donors. */
  getApyHistory?(params: HistoryParams): Promise<HistoryDataPoint[]>
}

export interface RateParams {
  poolId: string
  chainId: number
  tokenId: Address
  interval: TimeframeLabel
  fromTimestamp: number
}

/**
 * Wallet positions + UI rates + live UI product lists. Optional per protocol —
 * a yield contributor does not have to provide it.
 *
 * getSupplyProducts/getBorrowProducts are REQUIRED here even though spec §7
 * omitted them: products.actions.ts (the /supply and /borrow pages) consumes
 * them today.
 */
export interface AppAdapter {
  getUserSupplyPositions(p: { addresses: Address[] }): Promise<SupplyPosition[]>
  getUserBorrowPositions(p: { addresses: Address[] }): Promise<BorrowPosition[]>
  getMarketSupplyHistoryRates(p: RateParams): Promise<MarketRate[]>
  getMarketBorrowHistoryRates(p: RateParams): Promise<MarketRate[]>
  getSupplyProducts(): Promise<UiSupplyProduct[]>
  getBorrowProducts(): Promise<UiBorrowProduct[]>
}
```

Note the two `SupplyProduct`s: `@/lib/db/types` (pipeline/DB shape, has `_id`) vs `@/types` (UI shape, has `productId`). Core aliases the UI ones as `UiSupplyProduct`/`UiBorrowProduct`. Do not confuse them in any task.

---

### Task 1: Core contract + client-safe meta registry

**Files:**

- Create: `src/lib/protocols/core/types.ts`
- Create: `src/lib/protocols/core/define.ts`
- Create: `src/config/protocols-meta.ts`
- Create: `src/lib/protocols/core/__tests__/define.test.ts`
- Create: `src/config/__tests__/protocols-meta.test.ts`

**Interfaces:**

- Produces every type in the **Contract** section above.
- Produces `defineYieldAdapter(adapter: YieldAdapter): YieldAdapter` (typed identity).
- Produces `PROTOCOLS_META`, `ProtocolName`, `protocolVersionName(id: string): string`, `protocolDisplayName(id: string): string`, `adapterIdsForProvider(provider: string): ProtocolName[]`.
- Touches nothing existing — old `src/config/protocols.ts` keeps compiling unchanged until Task 9.

- [ ] **Step 1: Write the failing tests.**

```ts
// src/lib/protocols/core/__tests__/define.test.ts
import { describe, expect, it } from 'vitest'

import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { YieldAdapter } from '@/lib/protocols/core/types'

describe('defineYieldAdapter', () => {
  it('returns the adapter unchanged (typed identity)', () => {
    const adapter: YieldAdapter = {
      id: 'test_v1',
      name: 'Test v1',
      provider: 'test',
      version: 'v1',
      chains: { 1: { slug: 'ethereum' } },
      getProducts: async () => [],
      getApySpot: async () => [],
    }
    expect(defineYieldAdapter(adapter)).toBe(adapter)
  })
})
```

```ts
// src/config/__tests__/protocols-meta.test.ts
import { describe, expect, it } from 'vitest'

import {
  PROTOCOLS_META,
  adapterIdsForProvider,
  protocolDisplayName,
  protocolVersionName,
} from '@/config/protocols-meta'

describe('PROTOCOLS_META', () => {
  it('exposes the three live protocols with complete metadata', () => {
    expect(Object.keys(PROTOCOLS_META).sort()).toEqual([
      'aave_v3',
      'compound_v3',
      'morpho_v1',
    ])
    for (const meta of Object.values(PROTOCOLS_META)) {
      expect(meta.displayName).toBeTruthy()
      expect(meta.versionName).toBeTruthy()
      expect(meta.provider).toBeTruthy()
    }
  })

  it('resolves names and providers without parsing ids', () => {
    expect(protocolVersionName('aave_v3')).toBe('Aave v3')
    expect(protocolVersionName('nope')).toBe('n/a')
    expect(protocolDisplayName('morpho_v1')).toBe('Morpho')
    expect(adapterIdsForProvider('compound')).toEqual(['compound_v3'])
    expect(adapterIdsForProvider('unknown')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm test -- src/lib/protocols/core/__tests__/define.test.ts src/config/__tests__/protocols-meta.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement `core/types.ts` and `core/define.ts`.**

`core/types.ts` = the **Contract** section verbatim. Move the full `IngestionFloors` doc comment from `src/config/protocols.ts:36-57` with it (copy now, the original is deleted in Task 9).

```ts
// src/lib/protocols/core/define.ts
import type { YieldAdapter } from './types'

/**
 * Typed identity — anchors inference and documentation for adapter authors.
 * An adapter is a plain object; this function only pins its type.
 */
export function defineYieldAdapter(adapter: YieldAdapter): YieldAdapter {
  return adapter
}
```

- [ ] **Step 4: Implement `src/config/protocols-meta.ts`.**

```ts
// src/config/protocols-meta.ts — importable from client components, zero server deps
export const PROTOCOLS_META = {
  aave_v3: { displayName: 'Aave', versionName: 'Aave v3', provider: 'aave' },
  morpho_v1: {
    displayName: 'Morpho',
    versionName: 'Morpho v1',
    provider: 'morpho',
  },
  compound_v3: {
    displayName: 'Compound',
    versionName: 'Compound v3',
    provider: 'compound',
  },
} as const

export type ProtocolName = keyof typeof PROTOCOLS_META

function metaFor(id: string) {
  return id in PROTOCOLS_META ? PROTOCOLS_META[id as ProtocolName] : undefined
}

/** 'aave_v3' → 'Aave v3'. Replaces getProtocolVersionNameById (which parsed the id). */
export function protocolVersionName(id: string): string {
  return metaFor(id)?.versionName ?? 'n/a'
}

/** 'aave_v3' → 'Aave'. Replaces getProtocolGlobalNameById. */
export function protocolDisplayName(id: string): string {
  return metaFor(id)?.displayName ?? 'n/a'
}

/** DB provider column value → adapter ids. Used by heal to map gaps to adapters. */
export function adapterIdsForProvider(provider: string): ProtocolName[] {
  return (Object.keys(PROTOCOLS_META) as ProtocolName[]).filter(
    (id) => PROTOCOLS_META[id].provider === provider
  )
}
```

- [ ] **Step 5: Run tests, typecheck, lint.**

Run: `pnpm test -- src/lib/protocols/core/__tests__/define.test.ts src/config/__tests__/protocols-meta.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/protocols/core src/config/protocols-meta.ts src/config/__tests__
git commit -m "feat: add YieldAdapter contract and client-safe protocol meta registry"
```

### Task 2: Move the toolkit (`shared/` → `core/toolkit/`, `chain-slugs.ts`)

**Files:**

- Move: `src/lib/protocols/shared/graphql-client.ts` → `src/lib/protocols/core/toolkit/graphql-client.ts`
- Move: `src/lib/protocols/shared/batch.ts` → `src/lib/protocols/core/toolkit/batch.ts`
- Move: `src/lib/protocols/shared/chain-registry.ts` → `src/lib/protocols/core/toolkit/chain-registry.ts`
- Move: `src/lib/protocols/shared/types.ts` → `src/lib/protocols/core/toolkit/types.ts`
- Move: `src/lib/protocols/chain-slugs.ts` → `src/lib/protocols/core/toolkit/chain-slugs.ts`
- Create: `src/lib/protocols/core/toolkit/index.ts`
- Modify: `src/lib/protocols/shared/index.ts` (becomes a temporary re-export shim)
- Modify: every importer of `@/lib/protocols/chain-slugs` (found via grep: `src/config/protocols.ts`, `src/lib/protocols/utils.ts`, `src/lib/protocols/{aave,morpho,compound}/config.ts`, plus any others grep finds)

**Interfaces:**

- Produces `@/lib/protocols/core/toolkit` exporting exactly what `shared/index.ts` exports today (`processBatches`, `createGraphQLClient`, `DEFAULT_SUBGRAPH_TIMEOUT`, `createChainRegistry`, chain-registry types, base chain types) plus `CHAIN_SLUG_MAP`, `RegisteredChainId`.
- `@/lib/protocols/shared` keeps working as a shim until Task 9 deletes it — per-protocol tasks migrate their own imports.

- [ ] **Step 1: Move files with git mv, content unchanged.**

```bash
mkdir -p src/lib/protocols/core/toolkit
git mv src/lib/protocols/shared/graphql-client.ts src/lib/protocols/core/toolkit/graphql-client.ts
git mv src/lib/protocols/shared/batch.ts src/lib/protocols/core/toolkit/batch.ts
git mv src/lib/protocols/shared/chain-registry.ts src/lib/protocols/core/toolkit/chain-registry.ts
git mv src/lib/protocols/shared/types.ts src/lib/protocols/core/toolkit/types.ts
git mv src/lib/protocols/chain-slugs.ts src/lib/protocols/core/toolkit/chain-slugs.ts
```

Fix any relative imports _between_ the moved files (they moved together, so most stay valid).

- [ ] **Step 2: Create the toolkit barrel and turn `shared/index.ts` into a shim.**

```ts
// src/lib/protocols/core/toolkit/index.ts
export { processBatches } from './batch'
export { createGraphQLClient, DEFAULT_SUBGRAPH_TIMEOUT } from './graphql-client'
export { createChainRegistry } from './chain-registry'
export type {
  ChainImporter,
  ChainRegistry,
  ChainRegistryOptions,
} from './chain-registry'
export type {
  BaseChainClient,
  BaseChainTransformers,
  ChainConfig,
} from './types'
export { CHAIN_SLUG_MAP } from './chain-slugs'
export type { RegisteredChainId } from './chain-slugs'
```

```ts
// src/lib/protocols/shared/index.ts — TEMPORARY shim, deleted in Task 9.
// Adapters migrate to '@/lib/protocols/core/toolkit' in Tasks 5-7.
export * from '../core/toolkit'
```

- [ ] **Step 3: Update all `@/lib/protocols/chain-slugs` importers.**

Run `grep -rln "protocols/chain-slugs" src codegen.ts` and point every hit at `@/lib/protocols/core/toolkit/chain-slugs` (or the barrel). No shim for this one — the importer list is short and static.

- [ ] **Step 4: Verify.**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Also `grep -rn "from '\.\./shared'\|protocols/shared" src | wc -l` — nonzero is fine (shim consumers), but `grep -rn "protocols/chain-slugs'" src` must return 0.

- [ ] **Step 5: Commit.**

```bash
git add -A src/lib/protocols src/config codegen.ts
git commit -m "refactor: move shared protocol utilities to core/toolkit"
```

### Task 3: Zod validation schemas (two severities)

**Files:**

- Create: `src/lib/protocols/core/validation.ts`
- Create: `src/lib/protocols/core/__tests__/validation.test.ts`

**Interfaces:**

- Produces `spotPayloadSoftSchema` (runtime: shape + finiteness, NO magnitude bound), `spotPayloadStrictSchema(chainIds: number[])` (harness: soft rules + `|net| < 10` + chainId ∈ adapter.chains), `productStrictSchema(adapter: { id: string; provider: string; version: string })` (harness: shape + provider/version coherence).
- Consumed by Task 8 (runtime soft-skip in collector/products-sync) and Task 10 (harness strict).

- [ ] **Step 1: Write the failing tests.**

```ts
// src/lib/protocols/core/__tests__/validation.test.ts
import { describe, expect, it } from 'vitest'

import {
  spotPayloadSoftSchema,
  spotPayloadStrictSchema,
} from '@/lib/protocols/core/validation'

const payload = {
  productId: 'aave:v3:ethereum:reserve:0xabc:supply',
  kind: 'supply',
  protocol: 'aave',
  chainId: 1,
  asset: 'USDC',
  apy: { base: 0.03, rewards: 0.01, fees: 0, net: 0.04, rewardItems: [] },
  market: {
    supplyAssets: 1,
    supplyAssetsUsd: 1,
    utilizationRate: 0,
    assetPriceUsd: 1,
  },
}

describe('spot payload validation', () => {
  it('soft: accepts a finite extreme rate (ingestion never drops finite data)', () => {
    const extreme = {
      ...payload,
      apy: { ...payload.apy, base: 2979.95, net: 2979.95 },
    }
    expect(spotPayloadSoftSchema.safeParse(extreme).success).toBe(true)
  })

  it('soft: rejects non-finite components and empty productId', () => {
    const nan = { ...payload, apy: { ...payload.apy, net: NaN } }
    expect(spotPayloadSoftSchema.safeParse(nan).success).toBe(false)
    expect(
      spotPayloadSoftSchema.safeParse({ ...payload, productId: '' }).success
    ).toBe(false)
  })

  it('strict: additionally bounds |net| < 10 and requires a known chainId', () => {
    const strict = spotPayloadStrictSchema([1, 137])
    expect(strict.safeParse(payload).success).toBe(true)
    const spike = { ...payload, apy: { ...payload.apy, net: 12 } }
    expect(strict.safeParse(spike).success).toBe(false)
    const wrongChain = { ...payload, chainId: 999 }
    expect(strict.safeParse(wrongChain).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `pnpm test -- src/lib/protocols/core/__tests__/validation.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `core/validation.ts`.**

```ts
// src/lib/protocols/core/validation.ts
import { z } from 'zod'

/**
 * Two severities, two rule sets (spec §6, amended):
 *
 * - SOFT (runtime, collector + products-sync): shape + finiteness only. A payload
 *   failing it is logged and skipped; the slot never crashes. It must NOT bound
 *   magnitude — dropping a finite extreme rate at ingestion manufactures the gap
 *   that heal then fills with the same value unguarded (see lib/apy-validation.ts).
 * - STRICT (CI harness): soft rules + |net| < 10 (1000%) + chainId declared by the
 *   adapter. A brand-new community adapter quoting >1000% is almost always a unit
 *   bug (raw percentage vs decimal), and CI is where that must die.
 */

const finite = z.number().finite()

const rewardItemSchema = z.object({
  token: z.object({ symbol: z.string(), address: z.string() }),
  apr: finite,
  apy: finite,
  source: z.string(),
  program: z.unknown().nullable(),
})

const apyBlockSchema = z.object({
  base: finite,
  rewards: finite,
  fees: finite,
  net: finite,
  rewardItems: z.array(rewardItemSchema),
})

export const spotPayloadSoftSchema = z.object({
  productId: z.string().min(1),
  kind: z.enum(['supply', 'borrow']),
  protocol: z.string().min(1),
  chainId: z.number().int().positive(),
  asset: z.string().min(1),
  apy: apyBlockSchema,
  market: z.record(z.string(), z.unknown()),
})

export function spotPayloadStrictSchema(chainIds: number[]) {
  return spotPayloadSoftSchema
    .refine((p) => Math.abs(p.apy.net) < 10, {
      message: 'net APY magnitude >= 10 (1000%) — probable unit bug',
    })
    .refine((p) => chainIds.includes(p.chainId), {
      message: 'chainId not declared in adapter.chains',
    })
}

export function productStrictSchema(adapter: {
  id: string
  provider: string
  version: string
}) {
  return z
    .object({
      _id: z.string().min(1),
      kind: z.enum(['supply', 'borrow']),
      provider: z.literal(adapter.provider),
      version: z.literal(adapter.version),
      protocolName: z.literal(adapter.id),
    })
    .loose()
}
```

Before finalizing, check the real field names on one DB `SupplyProduct` in `src/lib/db/types.ts:123-184` and align `productStrictSchema` keys exactly (e.g. if the provider/version live under different property names, match them — do not guess).

- [ ] **Step 4: Run tests, typecheck, lint.**

Run: `pnpm test -- src/lib/protocols/core/__tests__/validation.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/protocols/core/validation.ts src/lib/protocols/core/__tests__/validation.test.ts
git commit -m "feat: add two-severity zod validation for adapter payloads"
```

### Task 4: Extract Merkl into the toolkit

**Files:**

- Create: `src/lib/protocols/core/toolkit/merkl.ts`
- Modify: `src/lib/protocols/aave/v3/apy-spot.ts:16-158` (remove the extracted block, import instead)

**Interfaces:**

- Produces `fetchMerklIncentives(opts: { name: string; chainIds: number[]; logPrefix?: string }): Promise<MerklIncentives>`, `lookupMerklIncentive(map, marketSlug, tokenAddress)`, and types `MerklIncentives`, `MerklIncentiveMap`.
- `AAVE_MARKET_TO_MERKL_SLUG` stays in `aave/v3/apy-spot.ts` — it is Aave knowledge, not toolkit.

- [ ] **Step 1: Move the Merkl block.**

Move from `aave/v3/apy-spot.ts` into `core/toolkit/merkl.ts`, logic unchanged:
`MerklOpportunity`, `MerklIncentiveMap`, `MerklIncentives`, `extractDepositUrlParams`, `incentiveKey`, `fetchMerklIncentives`, `lookupMerklIncentive`.

Two parameterizations only:

1. The URL `https://api.merkl.xyz/v4/opportunities/?name=aave&chainId=...` — `aave` becomes `opts.name` (URL-encoded).
2. Log prefixes `[cron:aave:merkl]` become `` `[${opts.logPrefix ?? opts.name}:merkl]` ``.

New signature:

```ts
export async function fetchMerklIncentives(opts: {
  name: string
  chainIds: number[]
  logPrefix?: string
}): Promise<MerklIncentives>
```

Move the `aprToApyDaily` import with it (keep whatever module it comes from today — check the current import in `apy-spot.ts` and reuse the path).

- [ ] **Step 2: Rewire `aave/v3/apy-spot.ts`.**

Import `fetchMerklIncentives`, `lookupMerklIncentive`, and the types from `@/lib/protocols/core/toolkit/merkl`; call site becomes `fetchMerklIncentives({ name: 'aave', chainIds, logPrefix: 'cron:aave' })`. Keep `AAVE_MARKET_TO_MERKL_SLUG` and `extractDepositUrlParams` usage identical — if `extractDepositUrlParams` is only used inside the moved function, it does not need to be exported.

- [ ] **Step 3: Verify.**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/protocols/core/toolkit/merkl.ts src/lib/protocols/aave/v3/apy-spot.ts
git commit -m "refactor: extract Merkl incentives fetcher to core toolkit"
```

### Task 5: Migrate the Aave adapter

**Files:**

- Create: `src/lib/protocols/aave/v3/config.ts` (new adapter config)
- Create: `src/lib/protocols/aave/v3/positions.ts` (from `offchain/index.ts`)
- Create: `src/lib/protocols/aave/v3/__tests__/history-window.test.ts`
- Move: `offchain/queries.ts` → `v3/queries.ts`, `offchain/generated/` → `v3/generated/`, `offchain/market-rates.ts` → `v3/market-rates.ts`, `offchain/supply-products.ts` → `v3/supply-products.ts`, `offchain/borrow-products.ts` → `v3/borrow-products.ts`
- Modify: `src/lib/protocols/aave/v3/index.ts`, `apy-spot.ts`, `apy-history.ts`, `products.ts`, `listing.ts`
- Modify: `codegen.ts` (aave offchain path → `v3/generated/`; DELETE the aave onchain target)
- Delete: `src/lib/protocols/aave/v3/onchain/` (whole folder — zero imports, verified)

**Interfaces:**

- Produces `export const adapter: YieldAdapter` and `export const appAdapter: AppAdapter` from `@/lib/protocols/aave/v3`.
- Keeps `aaveV3Adapter` (legacy `createVersionAdapter` export) and the `fetchAaveV3ApySpot`/`fetchAaveHistory`/`fetchAaveV3Products` named exports compiling until Task 9 — `aave/index.ts` and the old call sites still import them.
- `HistoryDataPoint` in `apy-history.ts` becomes `export type { HistoryDataPoint } from '@/lib/protocols/core/types'` (re-export, so `heal/route.ts`'s current import path keeps working until Task 8).
- Produces pure `aaveWindowForRange(startTimestamp: number, nowTimestamp: number): 'LAST_DAY' | 'LAST_WEEK' | 'LAST_YEAR'`.

- [ ] **Step 1: Capture the pre-refactor baseline.**

```bash
dotenv -- npx tsx -e "
import('./src/lib/protocols/aave/v3/apy-spot').then(async (m) => {
  const p = await m.fetchAaveV3ApySpot()
  const ids = p.map((x) => x.productId).sort()
  const { writeFileSync } = await import('node:fs')
  writeFileSync('/private/tmp/claude-501/-Users-cedric-Projects-lendwise-web/08c35d26-4d2d-4432-8d08-660e95f4b9a9/scratchpad/aave-baseline.json', JSON.stringify({ count: p.length, ids }, null, 1))
  console.log('aave baseline:', p.length)
})"
```

Expected: a count near the current production payload volume and a JSON file with the sorted productId set.

- [ ] **Step 2: Write the failing window-mapping test.**

```ts
// src/lib/protocols/aave/v3/__tests__/history-window.test.ts
import { describe, expect, it } from 'vitest'

import { aaveWindowForRange } from '@/lib/protocols/aave/v3/apy-history'

const now = 1_760_000_000 // any fixed unix-seconds anchor
const h = 3600

describe('aaveWindowForRange', () => {
  it('picks the smallest Aave API window covering the requested lookback', () => {
    expect(aaveWindowForRange(now - 6 * h, now)).toBe('LAST_DAY')
    expect(aaveWindowForRange(now - 24 * h, now)).toBe('LAST_DAY')
    expect(aaveWindowForRange(now - 25 * h, now)).toBe('LAST_WEEK')
    expect(aaveWindowForRange(now - 7 * 24 * h, now)).toBe('LAST_WEEK')
    expect(aaveWindowForRange(now - 8 * 24 * h, now)).toBe('LAST_YEAR')
  })
})
```

Run: `pnpm test -- src/lib/protocols/aave/v3/__tests__/history-window.test.ts`
Expected: FAIL — `aaveWindowForRange` not exported.

- [ ] **Step 3: Flatten `offchain/` and create the new config.**

```bash
git mv src/lib/protocols/aave/v3/offchain/queries.ts src/lib/protocols/aave/v3/queries.ts
git mv src/lib/protocols/aave/v3/offchain/generated src/lib/protocols/aave/v3/generated
git mv src/lib/protocols/aave/v3/offchain/market-rates.ts src/lib/protocols/aave/v3/market-rates.ts
git mv src/lib/protocols/aave/v3/offchain/supply-products.ts src/lib/protocols/aave/v3/supply-products.ts
git mv src/lib/protocols/aave/v3/offchain/borrow-products.ts src/lib/protocols/aave/v3/borrow-products.ts
git mv src/lib/protocols/aave/v3/offchain/index.ts src/lib/protocols/aave/v3/positions.ts
```

Fix relative imports inside the moved files (`../../config` etc.) and every `@/lib/protocols/aave/v3/offchain/...` importer (`apy-spot.ts`, `apy-history.ts`, `products.ts`, `listing.ts` — grep `aave/v3/offchain`).

New `v3/config.ts`:

```ts
// src/lib/protocols/aave/v3/config.ts
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  linea,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'

import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'
import type { AdapterChain } from '@/lib/protocols/core/types'

export const AAVE_V3_API_URL = 'https://api.v3.aave.com/graphql'

/** Lightweight chain map — no more viem Chain spread. subgraphUrl extras died with onchain/. */
export const AAVE_V3_CHAINS: Record<number, AdapterChain> = Object.fromEntries(
  [mainnet, polygon, arbitrum, base, optimism, linea, avalanche, bsc].map(
    (c) => [c.id, { slug: CHAIN_SLUG_MAP[c.id] }]
  )
)
```

Match the chain list to what `AAVE_CONFIG.aave_v3.chains` actually enables today (some chains are commented out in `aave/config.ts` — replicate exactly, do not add or drop a chain). Internal fetchers (`apy-spot.ts`, `apy-history.ts`, `products.ts`, `positions.ts`) switch from `AAVE_CONFIG.aave_v3.offchainApiUrl` / `.chains` to `AAVE_V3_API_URL` / `AAVE_V3_CHAINS`. Where positions code used `AAVE_CONFIG.aave_v3.id`, use the literal `'aave_v3'` (or `adapter.id` where import cycles allow). The old `aave/config.ts` stays untouched — it still feeds `PROTOCOL_REGISTRY` until Task 9.

- [ ] **Step 4: Convert `chainFilter` → `chainIds` and add `getApyHistory` mapping.**

In `apy-spot.ts`, `products.ts`, `apy-history.ts`: replace the `chainFilter?: string` name-matching block with

```ts
let chainIds = Object.keys(AAVE_V3_CHAINS).map(Number)
if (opts?.chainIds?.length) {
  chainIds = chainIds.filter((id) => opts.chainIds!.includes(id))
}
```

In `apy-history.ts`, add the pure mapper and the contract wrapper (existing `fetchAaveHistory` logic unchanged underneath):

```ts
export function aaveWindowForRange(
  startTimestamp: number,
  nowTimestamp: number
): 'LAST_DAY' | 'LAST_WEEK' | 'LAST_YEAR' {
  const lookbackHours = (nowTimestamp - startTimestamp) / 3600
  if (lookbackHours <= 24) return 'LAST_DAY'
  if (lookbackHours <= 7 * 24) return 'LAST_WEEK'
  return 'LAST_YEAR'
}

export async function getAaveApyHistory(
  params: HistoryParams
): Promise<HistoryDataPoint[]> {
  const window = aaveWindowForRange(
    params.startTimestamp,
    Math.floor(Date.now() / 1000)
  )
  const points = await fetchAaveHistory({
    window,
    chainIds: params.chainIds,
    onProgress: params.onProgress,
  })
  // The API windows are anchored to now — trim to the requested range.
  return points.filter((p) => {
    const t = p.timestamp.getTime() / 1000
    return t >= params.startTimestamp && t <= params.endTimestamp
  })
}
```

- [ ] **Step 5: Expose the adapters in `v3/index.ts`.**

```ts
// src/lib/protocols/aave/v3/index.ts
import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { AppAdapter } from '@/lib/protocols/core/types'

// ─── Legacy exports — removed in Task 9 ──────────────────────────────────────
import { createVersionAdapter } from '../../utils'
import { getAaveApyHistory } from './apy-history'
import { fetchAaveV3ApySpot } from './apy-spot'
import { getBorrowProducts } from './borrow-products'
import { AAVE_V3_CHAINS } from './config'
import {
  getMarketBorrowHistoryRates,
  getMarketSupplyHistoryRates,
} from './market-rates'
import {
  aaveV3OffchainAdapter,
  // legacy DataAdapter object — Task 9 deletes it
  getUserBorrowPositions,
  getUserSupplyPositions,
} from './positions'
import { fetchAaveV3Products } from './products'
import { getSupplyProducts } from './supply-products'

export const adapter = defineYieldAdapter({
  id: 'aave_v3',
  name: 'Aave v3',
  provider: 'aave',
  version: 'v3',
  chains: AAVE_V3_CHAINS,
  getProducts: fetchAaveV3Products,
  getApySpot: fetchAaveV3ApySpot,
  getApyHistory: getAaveApyHistory,
})

export const appAdapter: AppAdapter = {
  getUserSupplyPositions,
  getUserBorrowPositions,
  getMarketSupplyHistoryRates,
  getMarketBorrowHistoryRates,
  getSupplyProducts,
  getBorrowProducts,
}

export const aaveV3Adapter = createVersionAdapter('v3', {
  positions: aaveV3OffchainAdapter,
  rates: aaveV3OffchainAdapter,
})
```

`positions.ts` (ex `offchain/index.ts`) exports its position functions individually AND keeps the `aaveV3OffchainAdapter: DataAdapter` object export so the legacy block compiles.

- [ ] **Step 6: Update `codegen.ts` and regenerate.**

- Aave offchain target: `'src/lib/protocols/aave/v3/offchain/generated/'` → `'src/lib/protocols/aave/v3/generated/'`; documents → `'src/lib/protocols/aave/v3/queries.ts'`; `schema` imports `AAVE_V3_API_URL` from `./src/lib/protocols/aave/v3/config`.
- DELETE the aave onchain generates entry and the now-unused `aaveV3EthereumSubgraphUrl` extraction + its guard.

Run: `pnpm codegen`
Expected: regenerates cleanly into `aave/v3/generated/`.

- [ ] **Step 7: Delete `onchain/` and verify against baseline.**

```bash
grep -rn "aave/v3/onchain" src codegen.ts   # must return 0 hits
git rm -r src/lib/protocols/aave/v3/onchain
```

Run: `pnpm test -- src/lib/protocols/aave/v3/__tests__/history-window.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

Re-run the Step 1 baseline command against the new module path (`m.fetchAaveV3ApySpot` still exists), writing `aave-after.json`, then:

```bash
diff <(python3 -c "import json;print('\n'.join(json.load(open('/private/tmp/claude-501/-Users-cedric-Projects-lendwise-web/08c35d26-4d2d-4432-8d08-660e95f4b9a9/scratchpad/aave-baseline.json'))['ids']))") \
     <(python3 -c "import json;print('\n'.join(json.load(open('/private/tmp/claude-501/-Users-cedric-Projects-lendwise-web/08c35d26-4d2d-4432-8d08-660e95f4b9a9/scratchpad/aave-after.json'))['ids']))")
```

Expected: empty diff (a handful of drift lines are acceptable only if a market genuinely listed/delisted between runs — rerun to confirm).

- [ ] **Step 8: Commit.**

```bash
git add -A src/lib/protocols/aave codegen.ts
git commit -m "refactor: migrate Aave v3 to the YieldAdapter contract"
```

### Task 6: Migrate the Morpho adapter

**Files:**

- Create: `src/lib/protocols/morpho/v1/config.ts`, `src/lib/protocols/morpho/v1/positions.ts`
- Move: `offchain/queries.ts` → `v1/queries.ts`, `offchain/generated/` → `v1/generated/`, `offchain/supply-products.ts` → `v1/supply-products.ts`, `offchain/borrow-products.ts` → `v1/borrow-products.ts`, `offchain/index.ts` → `v1/positions.ts`
- Modify: `v1/index.ts`, `apy-spot.ts`, `apy-history.ts`, `products.ts`, `listing.ts`, `utils.ts`
- Modify: `codegen.ts` (morpho offchain path → `v1/generated/`; DELETE the morpho onchain target)
- Delete: `src/lib/protocols/morpho/v1/onchain/` (only import is a commented line in `v1/index.ts`)

**Interfaces:**

- Produces `export const adapter: YieldAdapter` (WITH `getApyHistory`) and `export const appAdapter: AppAdapter` from `@/lib/protocols/morpho/v1`.
- Keeps `morphoV1Adapter` legacy export + `fetchMorphoV1ApySpot`/`fetchMorphoV1Products`/`fetchMorphoHistory` named exports until Task 9.
- Ingestion floors move: `v1/config.ts` exports `MORPHO_V1_INGESTION: IngestionFloors` with the exact current value `{ minBorrowAssetsUsd: 10_000 }` from `morpho/config.ts:15-20`; `listing.ts` reads it from there.

- [ ] **Step 1: Capture the baseline** — same command as Task 5 Step 1 with `morpho/v1/apy-spot` / `fetchMorphoV1ApySpot` / `morpho-baseline.json`.

- [ ] **Step 2: Flatten and create config.**

Same `git mv` pattern as Task 5 Step 3. New config:

```ts
// src/lib/protocols/morpho/v1/config.ts
import { arbitrum, base, mainnet, optimism, polygon } from 'viem/chains'

import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'
import type { AdapterChain, IngestionFloors } from '@/lib/protocols/core/types'

export const MORPHO_V1_API_URL = 'https://api.morpho.org/graphql'

export const MORPHO_V1_CHAINS: Record<number, AdapterChain> =
  Object.fromEntries(
    [mainnet, base /* …replicate morpho/config.ts EXACTLY… */].map((c) => [
      c.id,
      { slug: CHAIN_SLUG_MAP[c.id] },
    ])
  )

/** Moved verbatim from morpho/config.ts — the one irreversible filter. Keep LOW. */
export const MORPHO_V1_INGESTION: IngestionFloors = {
  minBorrowAssetsUsd: 10_000,
}
```

Read `morpho/config.ts` first and replicate its exact chain list and exact `offchainApiUrl` string. Rewire `apy-spot.ts`, `apy-history.ts`, `products.ts`, `listing.ts`, `positions.ts`, `utils.ts` to the new consts; convert `chainFilter` → `chainIds` exactly as in Task 5 Step 4.

- [ ] **Step 3: Contract wrapper for history (passthrough).**

```ts
// in v1/apy-history.ts
export async function getMorphoApyHistory(
  params: HistoryParams
): Promise<HistoryDataPoint[]> {
  return fetchMorphoHistory({
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    interval: params.interval,
    chainIds: params.chainIds,
    onProgress: params.onProgress,
  })
}
```

`HistoryDataPoint` import switches to `@/lib/protocols/core/types`.

- [ ] **Step 4: Expose adapters in `v1/index.ts`** — same shape as Task 5 Step 5, with `ingestion: MORPHO_V1_INGESTION` on the yield adapter, legacy `morphoV1Adapter` block kept. Morpho's `positions.ts` (ex `offchain/index.ts`) contains positions AND market-rates functions inline — export them individually plus the legacy DataAdapter object.

- [ ] **Step 5: Update `codegen.ts`** — morpho offchain target path → `'src/lib/protocols/morpho/v1/generated/'`, documents → `v1/queries.ts`, schema imports `MORPHO_V1_API_URL` from `./src/lib/protocols/morpho/v1/config`; DELETE the morpho onchain target and `morphoV1EthereumSubgraphUrl` extraction + guard. Run `pnpm codegen`.

- [ ] **Step 6: Delete `onchain/`, verify, compare baseline.**

```bash
grep -rn "morpho/v1/onchain" src codegen.ts   # only the commented import in v1/index.ts may remain — remove that line too, then 0 hits
git rm -r src/lib/protocols/morpho/v1/onchain
```

Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS. Baseline diff (`morpho-after.json`) → empty.

Note: `src/hooks/useMarketStats.ts` may reference the morpho onchain adapter transitively — grep confirmed `morpho/v1/onchain/ethereum` holds a `getMarketStats` impl. If deleting `onchain/` breaks `useMarketStats`, delete the hook now instead of Task 9 (it has zero consumers besides the barrel `src/hooks/index.ts:3` — remove that line too).

- [ ] **Step 7: Commit.**

```bash
git add -A src/lib/protocols/morpho src/hooks codegen.ts
git commit -m "refactor: migrate Morpho v1 to the YieldAdapter contract"
```

### Task 7: Migrate the Compound adapter

**Files:**

- Create: `src/lib/protocols/compound/v3/config.ts`, `src/lib/protocols/compound/v3/positions.ts`
- Move: everything under `compound/v3/onchain/` up one level: `onchain/queries.ts` → `v3/queries.ts`, `onchain/generated/` → `v3/generated/`, `onchain/supply-products.ts` → `v3/supply-products.ts`, `onchain/borrow-products.ts` → `v3/borrow-products.ts`, `onchain/index.ts` → `v3/positions.ts`, `onchain/config.ts` → fold into new `v3/config.ts`, chain dirs `onchain/{ethereum,polygon,optimism,base,arbitrum}/` → `v3/{ethereum,...}/`
- Modify: `v3/index.ts`, `apy-spot.ts`, `apy-history.ts`, `products.ts`, `utils.ts`
- Modify: `codegen.ts` (compound target path → `v3/generated/`, documents → `v3/queries.ts`, schema urls import from new `v3/config.ts`)

**Interfaces:**

- Produces `export const adapter: YieldAdapter` — **NO `getApyHistory`** (spec decision: heal uses donor fallback for Compound) — and `export const appAdapter: AppAdapter` from `@/lib/protocols/compound/v3`.
- Keeps `compoundV3Adapter` legacy export + `fetchCompoundV3ApySpot`/`fetchCompoundV3Products`/`fetchCompoundDailyHistory`/`fetchCompoundHourlyHistory` named exports. The history fetchers remain plain module exports for `/api/cron/sync-history` — deliberately outside the contract.
- Chain-override machinery (`createChainRegistry` + `registerChain` + per-chain dirs) stays intact as an internal detail — only paths move.
- `v3/config.ts` exports `COMPOUND_V3_CHAINS: Record<number, AdapterChain>` where extras carry what the subgraph layer needs (`subgraphUrl`, plus whatever `custom.*` fields the current `compound/config.ts` and `onchain/config.ts` expose — replicate exactly).

- [ ] **Step 1: Capture the baseline** — same pattern, `compound/v3/apy-spot` / `fetchCompoundV3ApySpot` / `compound-baseline.json`.

- [ ] **Step 2: Flatten `onchain/` with git mv, build `v3/config.ts`.**

Read `compound/config.ts` and `compound/v3/onchain/config.ts` first. The new `v3/config.ts` merges them: chain map keyed by chainId with `slug` + `subgraphUrl` + any other `custom` extras as `AdapterChain` extras, replicating values exactly. Update all internal relative imports (chain dirs import `../queries`, `../../config`, etc.) and the chain-registry `clientPath` mechanics if paths are embedded (check `createChainRegistry` usage in ex-`onchain/index.ts` for how chain modules are imported — dynamic import specifiers must be updated to the new location).

- [ ] **Step 3: Expose adapters in `v3/index.ts`.**

```ts
export const adapter = defineYieldAdapter({
  id: 'compound_v3',
  name: 'Compound v3',
  provider: 'compound',
  version: 'v3',
  chains: COMPOUND_V3_CHAINS,
  getProducts: fetchCompoundV3Products,
  getApySpot: fetchCompoundV3ApySpot,
  // no getApyHistory: subgraph history serves the one-time sync route only;
  // heal deliberately uses nearest-neighbor donors for Compound (spec §3).
})
```

Plus `appAdapter` from `positions.ts` functions and the legacy `compoundV3Adapter` block. Convert `chainFilter` → `chainIds` in the three fetchers.

- [ ] **Step 4: Update `codegen.ts`** — compound target `'src/lib/protocols/compound/v3/onchain/generated/'` → `'src/lib/protocols/compound/v3/generated/'`, documents → `v3/queries.ts`, the two subgraph-url extractions import `COMPOUND_V3_CHAINS` from `./src/lib/protocols/compound/v3/config`. Run `pnpm codegen`.

- [ ] **Step 5: Verify.**

```bash
grep -rn "compound/v3/onchain" src codegen.ts   # 0 hits
```

Run: `pnpm typecheck && pnpm lint && pnpm test` → PASS. Baseline diff (`compound-after.json`) → empty. THEGRAPH_API_KEY must be set for the live fetch.

- [ ] **Step 6: Commit.**

```bash
git add -A src/lib/protocols/compound codegen.ts
git commit -m "refactor: migrate Compound v3 to the YieldAdapter contract"
```

### Task 8: Server registry + pipeline call sites (collector, products-sync, heal, sync-history)

**Files:**

- Create: `src/config/protocols-server.ts`
- Modify: `src/app/actions/apy-snapshots.actions.ts`
- Modify: `src/app/actions/products-sync.actions.ts`
- Modify: `src/app/api/yield/apy/spot/route.ts`, `src/app/api/yield/products/route.ts`
- Modify: `src/app/api/yield/apy/heal/route.ts`
- Modify: `src/app/api/cron/sync-history/route.ts`
- Modify: `src/lib/db/repositories/gaps.ts` (add `productProviders`)
- Modify: `scripts/products-sync.ts` (`ProtocolName` import path only)

**Interfaces:**

- Produces `YIELD_ADAPTERS: Record<ProtocolName, () => Promise<YieldAdapter>>` and `APP_ADAPTERS: Partial<Record<ProtocolName, () => Promise<AppAdapter>>>`.
- Produces `productProviders(productIds: string[]): Promise<Map<string, string>>` in the gaps repository.
- Consumes `adapterIdsForProvider` from Task 1, `adapter`/`appAdapter` exports from Tasks 5-7, `spotPayloadSoftSchema` from Task 3.

- [ ] **Step 1: Create `src/config/protocols-server.ts`.**

```ts
// src/config/protocols-server.ts — server only: loaders dynamic-import heavy adapter modules
import type { ProtocolName } from '@/config/protocols-meta'
import type { AppAdapter, YieldAdapter } from '@/lib/protocols/core/types'

export const YIELD_ADAPTERS: Record<ProtocolName, () => Promise<YieldAdapter>> =
  {
    aave_v3: () => import('@/lib/protocols/aave/v3').then((m) => m.adapter),
    morpho_v1: () => import('@/lib/protocols/morpho/v1').then((m) => m.adapter),
    compound_v3: () =>
      import('@/lib/protocols/compound/v3').then((m) => m.adapter),
  }

export const APP_ADAPTERS: Partial<
  Record<ProtocolName, () => Promise<AppAdapter>>
> = {
  aave_v3: () => import('@/lib/protocols/aave/v3').then((m) => m.appAdapter),
  morpho_v1: () =>
    import('@/lib/protocols/morpho/v1').then((m) => m.appAdapter),
  compound_v3: () =>
    import('@/lib/protocols/compound/v3').then((m) => m.appAdapter),
}
```

`Record<ProtocolName, …>` makes "every meta entry has a yield loader" a compile-time guarantee. Disabling a protocol = commenting its entries in BOTH `PROTOCOLS_META` and here (document in README, Task 10).

- [ ] **Step 2: Rewire the collector with soft validation.**

`apy-snapshots.actions.ts`: delete `PROTOCOL_TASKS` and the three fetcher imports. Task list becomes:

```ts
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { spotPayloadSoftSchema } from '@/lib/protocols/core/validation'

const ids = (Object.keys(YIELD_ADAPTERS) as ProtocolName[]).filter(
  (id) => !protocol || id === protocol
)
const results = await Promise.allSettled(
  ids.map(async (id) => (await YIELD_ADAPTERS[id]()).getApySpot())
)
```

After each fulfilled result, soft-validate per payload before pushing:

```ts
const valid: SpotPayload[] = []
for (const payload of result.value) {
  const parsed = spotPayloadSoftSchema.safeParse(payload)
  if (parsed.success) valid.push(payload)
  else
    console.warn(
      `[cron:${protoId}] Skipping invalid payload ${payload?.productId ?? '<no id>'}: ${parsed.error.issues[0]?.message}`
    )
}
```

Keep everything else (slot normalization, `writeApySlot`, result shape, logging) identical.

- [ ] **Step 3: Rewire products-sync.**

Same registry iteration for `adapter.getProducts()`. Replace the provider derivation `tasks[i][0].split('_')[0]` with `PROTOCOLS_META[protoId].provider` — no more id parsing. Soft-validate products only for non-crashing shape (a `_id`-less product would corrupt the upsert): skip+warn any product failing `z.object({ _id: z.string().min(1) }).loose()` — do not apply magnitude rules here. `syncProviderProducts` call semantics unchanged (only providers whose enumeration fulfilled).

- [ ] **Step 4: Rewire the two QStash routes.**

`spot/route.ts` and `products/route.ts`: `getProtocolIds()` → `Object.keys(PROTOCOLS_META)`, `type ProtocolName` from `@/config/protocols-meta`. Behavior identical.

- [ ] **Step 5: Fix heal — provider via JOIN, generic history.**

Add to `src/lib/db/repositories/gaps.ts` (follow the file's existing drizzle/raw-SQL idiom):

```ts
/** productId → products.provider, resolved by exact id — NEVER by parsing. */
export async function productProviders(
  productIds: string[]
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map()
  const rows = await db
    .select({ id: products.id, provider: products.provider })
    .from(products)
    .where(inArray(products.id, productIds))
  return new Map(rows.map((r) => [r.id, r.provider]))
}
```

In `heal/route.ts`:

1. Delete `detectProtocol`.
2. `const providerOf = await productProviders([...new Set(allEntries.map((e) => e.productId))])`.
3. Group entries by provider (`providerOf.get(id) ?? 'unknown'`); compute min/max timestamps as today.
4. Phase 1 becomes generic — for each provider group, for each adapter id from `adapterIdsForProvider(provider)`:

```ts
const adapter = await YIELD_ADAPTERS[adapterId]()
if (!adapter.getApyHistory) continue // Compound → donor fallback, unchanged
const points = await adapter.getApyHistory({
  startTimestamp: Math.floor(minTs / 1000) - 3600,
  endTimestamp: Math.floor(maxTs / 1000) + 3600,
  interval: 'HOUR',
  onProgress: (m) => console.log(`[cron:heal] ${m}`),
})
for (const [k, v] of buildHistoryLookup(points)) historyLookup.set(k, v)
```

Wrap per-adapter in try/catch pushing to `errors` (same as today's per-protocol catches). `HistoryDataPoint` import moves to `@/lib/protocols/core/types`. Behavior check: Aave gap ranges within the last week map to `LAST_WEEK` via `aaveWindowForRange` — same window the route hardcodes today; Morpho gets the same HOUR/min/max call it gets today.

5. Phases 2-3 (donors, `writeHealed`) untouched.

- [ ] **Step 6: Rewire sync-history.**

`aave`/`morpho` branches: load via `YIELD_ADAPTERS`, call `adapter.getApyHistory!({ startTimestamp: now - 365 * 86400, endTimestamp: now, interval: 'DAY' })` (now = `Math.floor(Date.now() / 1000)`); this reproduces today's defaults (Aave `LAST_YEAR` window, Morpho `DAY` interval). `compound` branch: keep calling `fetchCompoundDailyHistory()` imported directly from `@/lib/protocols/compound/v3/apy-history` — documented exception, the contract has no history for Compound.

- [ ] **Step 7: Update `scripts/products-sync.ts`** — `ProtocolName` import from `@/config/protocols-meta`.

- [ ] **Step 8: Verify end-to-end.**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Live check: `pnpm dev`, then (heal route has a dev bypass; spot/products verify QStash signatures — exercise the ACTIONS instead):

```bash
dotenv -- npx tsx -e "import('./src/app/actions/apy-snapshots.actions').then(m => m.collectApySpot()).then(r => console.log(JSON.stringify(r.counts)))"
```

Expected: three per-protocol counts matching the Task 5-7 baselines, `errors: []`.

- [ ] **Step 9: Commit.**

```bash
git add src/config/protocols-server.ts src/app/actions/apy-snapshots.actions.ts src/app/actions/products-sync.actions.ts src/app/api/yield/apy/spot/route.ts src/app/api/yield/products/route.ts src/app/api/yield/apy/heal/route.ts src/app/api/cron/sync-history/route.ts src/lib/db/repositories/gaps.ts scripts/products-sync.ts
git commit -m "refactor: route pipeline jobs through the adapter registry"
```

### Task 9: App call sites + legacy deletion

**Files:**

- Modify: `src/app/actions/user-supply-positions.actions.ts`, `src/app/actions/user-borrow-positions.actions.ts`, `src/app/actions/market-rates.actions.ts`, `src/app/actions/products.actions.ts`
- Modify: `src/components/badge/ProtocolBadge.tsx`, `src/components/products/SupplyTableClient.tsx`, `src/components/products/BorrowTableClient.tsx`, `src/components/portfolio/SupplyingTable.tsx`, `src/components/portfolio/Portfolio.tsx`, `src/components/portfolio/BorrowingTable.tsx`
- Modify: `src/types/index.ts`, `src/config/index.ts`
- Modify: `src/lib/protocols/{aave/v3,morpho/v1,compound/v3}/index.ts` and `positions.ts` (drop legacy exports), delete `src/lib/protocols/{aave,morpho,compound}/index.ts` + `{aave,morpho,compound}/config.ts` (protocol-level, superseded by v-level configs)
- Delete: `src/config/protocols.ts`, `src/lib/protocols/types.ts`, `src/lib/protocols/utils.ts`, `src/lib/protocols/shared/` (shim), `src/hooks/useMarketStats.ts` (if not already gone in Task 6)

**Interfaces:**

- Consumes `APP_ADAPTERS` (Task 8) and meta helpers (Task 1).
- After this task: `grep -r "DataSourceConfig\|VersionAdapter\|dataSourceType\|createProtocolAdapter\|createVersionAdapter\|getProtocolAdapter\|PROTOCOL_REGISTRY" src/` → 0 results (spec success criterion 4).

- [ ] **Step 1: Rewire positions actions.**

Both `user-supply-positions.actions.ts` and `user-borrow-positions.actions.ts` iterate `APP_ADAPTERS` instead of `getProtocolIds()` + `getProtocolAdapter()`:

```ts
import { type ProtocolName } from '@/config/protocols-meta'
import { APP_ADAPTERS } from '@/config/protocols-server'

const entries = Object.entries(APP_ADAPTERS) as [
  ProtocolName,
  () => Promise<AppAdapter>,
][]
const results = await Promise.allSettled(
  entries.map(async ([, load]) =>
    (await load()).getUserSupplyPositions({ addresses })
  )
)
```

Keep the empty-positions scaffolding, `Promise.allSettled`, per-protocol error logging, and `cache()` wrappers exactly. `version?: string` arguments disappear (version lives in the registry key).

- [ ] **Step 2: Rewire `market-rates.actions.ts`.**

```ts
const load = APP_ADAPTERS[protocolId as ProtocolName]
if (!load) throw new Error(`No app adapter for protocol ${protocolId}`)
const adapter = await load()
const rates = await adapter.getMarketBorrowHistoryRates({
  chainId,
  poolId,
  tokenId,
  interval,
  fromTimestamp,
})
```

- [ ] **Step 3: Rewire `products.actions.ts`.**

`_loadSupplyProducts` / `_loadBorrowProducts`: same `APP_ADAPTERS` iteration calling `getSupplyProducts()` / `getBorrowProducts()`. Enrichment, `eligibleForDisplay`, sorting, `unstable_cache` wrappers untouched.

- [ ] **Step 4: Client components → meta helpers.**

Every `getProtocolVersionNameById` import (ProtocolBadge, SupplyTableClient, BorrowTableClient, SupplyingTable, Portfolio — note Portfolio imports from `'@/config'`) becomes `protocolVersionName` from `@/config/protocols-meta`. Check `BorrowingTable.tsx` too (it imports from config/protocols per grep). Call sites are drop-in (`getProtocolVersionNameById(x)` → `protocolVersionName(x)`).

- [ ] **Step 5: Update the barrels, then delete legacy.**

- `src/config/index.ts`: `export * from './protocols'` → `export * from './protocols-meta'` (NOT protocols-server — that would drag server imports into client bundles).
- `src/types/index.ts`: re-export `ProtocolName` from `@/config/protocols-meta`; delete the `ProtocolChain`/`ProtocolConfig` re-exports and the `getProtocolAdapter`/`getProtocolConfig`/`getProtocolIds` re-exports; delete the now-orphaned `MarketStats` interface if `grep -rn "MarketStats" src` shows no remaining consumer.
- Strip the legacy blocks from the three adapter `index.ts`/`positions.ts` files (`aaveV3Adapter`, `morphoV1Adapter`, `compoundV3Adapter`, `*OffchainAdapter`/`*OnchainAdapter` DataAdapter objects, old `fetch*` re-export barrels in `{aave,morpho,compound}/index.ts`).
- Delete files:

```bash
git rm src/config/protocols.ts src/lib/protocols/types.ts src/lib/protocols/utils.ts
git rm -r src/lib/protocols/shared
git rm src/lib/protocols/aave/index.ts src/lib/protocols/aave/config.ts
git rm src/lib/protocols/morpho/index.ts src/lib/protocols/morpho/config.ts
git rm src/lib/protocols/compound/index.ts src/lib/protocols/compound/config.ts
git rm src/hooks/useMarketStats.ts   # + its line in src/hooks/index.ts
```

`CHAIN_NAME_MAPPING` (alias of `CHAIN_SLUG_MAP` in the deleted `utils.ts`) — grep its consumers first and point them at `CHAIN_SLUG_MAP` from the toolkit.

- [ ] **Step 6: Verify the purge.**

```bash
grep -rn "DataSourceConfig\|VersionAdapter\|dataSourceType\|createProtocolAdapter\|createVersionAdapter\|getProtocolAdapter\|getProtocolIds\|getProtocolConfig\|getProtocolVersionNameById\|getProtocolGlobalNameById\|PROTOCOL_REGISTRY\|useMarketStats\|protocols/shared" src/
```

Expected: 0 hits.

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: PASS — the build proves no client component transitively imports a server-only module.

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "refactor: delete legacy protocol adapter machinery"
```

### Task 10: CI harness + contributor docs

**Files:**

- Create: `scripts/adapter-test.ts`
- Modify: `package.json` (add `"adapter:test": "dotenv -- tsx scripts/adapter-test.ts"`)
- Rewrite: `src/lib/protocols/README.md`

**Interfaces:**

- Consumes `YIELD_ADAPTERS`, `PROTOCOLS_META`, `spotPayloadStrictSchema`, `productStrictSchema`.
- Produces `pnpm adapter:test <id>` exiting non-zero on: any strict validation failure, products/spot productId set drift, empty result set.

- [ ] **Step 1: Implement the harness.**

```ts
// scripts/adapter-test.ts
/**
 * CI harness for YieldAdapters — the mechanized products/spot invariant
 * (the drift lesson: ~18,500 orphan apy_hourly rows/week from aave listing skew).
 *
 * Usage: pnpm adapter:test aave_v3   (network + THEGRAPH_API_KEY required)
 */
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import {
  productStrictSchema,
  spotPayloadStrictSchema,
} from '@/lib/protocols/core/validation'

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

async function main(): Promise<void> {
  const id = process.argv[2] as ProtocolName | undefined
  if (!id || !(id in PROTOCOLS_META)) {
    console.error(
      `Usage: pnpm adapter:test <${Object.keys(PROTOCOLS_META).join('|')}>`
    )
    process.exit(2)
  }

  const adapter = await YIELD_ADAPTERS[id]()
  const chainIds = Object.keys(adapter.chains).map(Number)
  let failures = 0

  console.log(
    `\n▶ ${adapter.name} (${adapter.id}) — chains: ${chainIds.join(', ')}\n`
  )

  const [products, spots] = await Promise.all([
    adapter.getProducts(),
    adapter.getApySpot(),
  ])

  if (products.length === 0 || spots.length === 0) {
    console.error(
      `✗ empty result set (products=${products.length}, spots=${spots.length})`
    )
    process.exit(1)
  }

  // 1. Strict validation — any failure fails the run.
  const productSchema = productStrictSchema(adapter)
  for (const p of products) {
    const r = productSchema.safeParse(p)
    if (!r.success) {
      failures++
      console.error(
        `✗ product ${(p as { _id?: string })._id}: ${r.error.issues[0]?.message}`
      )
    }
  }
  const spotSchema = spotPayloadStrictSchema(chainIds)
  for (const s of spots) {
    const r = spotSchema.safeParse(s)
    if (!r.success) {
      failures++
      console.error(`✗ spot ${s.productId}: ${r.error.issues[0]?.message}`)
    }
  }

  // 2. products/spot productId set diff — drift is a hard failure.
  const productIds = new Set(products.map((p) => p._id))
  const spotIds = new Set(spots.map((s) => s.productId))
  const onlyProducts = [...productIds].filter((x) => !spotIds.has(x))
  const onlySpots = [...spotIds].filter((x) => !productIds.has(x))
  for (const x of onlyProducts)
    console.error(`✗ in products, missing from spot: ${x}`)
  for (const x of onlySpots)
    console.error(`✗ in spot, missing from products: ${x}`)
  failures += onlyProducts.length + onlySpots.length

  // 3. Human-review summary (DefiLlama-style).
  const byChainKind = new Map<string, number>()
  for (const s of spots) {
    const slug = adapter.chains[s.chainId]?.slug ?? `chain:${s.chainId}`
    const key = `${slug} × ${s.kind}`
    byChainKind.set(key, (byChainKind.get(key) ?? 0) + 1)
  }
  const nets = spots.map((s) => s.apy.net)
  const tvl = spots.reduce(
    (acc, s) =>
      acc + ((s.market as { supplyAssetsUsd?: number }).supplyAssetsUsd ?? 0),
    0
  )
  console.log('\nchain × kind:')
  for (const [k, v] of [...byChainKind].sort()) console.log(`  ${k}: ${v}`)
  console.log(
    `\nAPY net min/median/max: ${Math.min(...nets).toFixed(4)} / ${median(nets).toFixed(4)} / ${Math.max(...nets).toFixed(4)}`
  )
  console.log(`TVL (supply, USD): ${Math.round(tvl).toLocaleString('en-US')}`)
  console.log(
    `\n${failures === 0 ? '✓' : '✗'} ${products.length} products, ${spots.length} spots, ${failures} failure(s)\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

If `tsx` does not resolve the `@/` alias from `scripts/`, mirror how `scripts/products-sync.ts` runs today (it already imports `@/app/actions/...` via `dotenv -- tsx`) — same mechanism, no new config.

- [ ] **Step 2: Add the package script and run all three adapters.**

Run: `pnpm adapter:test aave_v3 && pnpm adapter:test morpho_v1 && pnpm adapter:test compound_v3`
Expected: exit 0 for all three, summary tables printed. A drift failure here is a real pre-existing bug — report it, don't paper over it.

- [ ] **Step 3: Rewrite `src/lib/protocols/README.md` as the contributor guide.**

Sections (all content must be real, drawn from the finished code — no stubs):

1. **Architecture** — one adapter per protocol+version; the Lendwise DB types are the contract; core vs toolkit vs adapters diagram (the spec §5 tree, as-built).
2. **How to add a protocol** — create `src/lib/protocols/{name}/{version}/` with `index.ts` exporting `adapter = defineYieldAdapter({...})`; add one `PROTOCOLS_META` entry + one `YIELD_ADAPTERS` loader; `APP_ADAPTERS` optional. Full minimal adapter example.
3. **Conventions** — `listing.ts` as the single enumeration predicate (products and spot must enumerate the same productId set); `chainIds` filtering by chain_id; `IngestionFloors` kept low with the irreversibility warning; APR→APY `(1 + APR/365)^365 - 1`.
4. **Validation** — soft (runtime skip+log, finiteness only) vs strict (harness, `|net| < 10`); why the magnitude bound must never run at ingestion (link `lib/apy-validation.ts`).
5. **PR checklist** — `pnpm adapter:test <id>` green, `pnpm typecheck && pnpm lint && pnpm build` green, summary table pasted in the PR description.
6. **Disabling a protocol** — comment its `PROTOCOLS_META` + `YIELD_ADAPTERS`/`APP_ADAPTERS` entries.

- [ ] **Step 4: Full verification suite.**

Run: `pnpm codegen && pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/adapter-test.ts package.json src/lib/protocols/README.md
git commit -m "feat: add adapter CI harness and contributor guide"
```

## Verification Checklist (spec §13 + risks §12)

- [ ] One protocol = one folder; `grep -rn "offchain\|onchain" src/lib/protocols --include="*.ts" -l` returns 0 files (comments about history may mention the words — check paths, not prose).
- [ ] `grep -r "DataSourceConfig\|VersionAdapter\|dataSourceType" src/` → 0 results.
- [ ] `pnpm adapter:test aave_v3|morpho_v1|compound_v3` all pass.
- [ ] Per-protocol spot baseline diffs were empty at Tasks 5, 6, 7 (same counts, same productId sets).
- [ ] `collectApySpot()` returns the same three counts as pre-refactor with `errors: []`.
- [ ] heal route: no `detectProtocol`, provider resolved by `products` JOIN; Compound gaps still heal via donors; Aave heal still uses a LAST_WEEK-equivalent window for ≤7-day ranges.
- [ ] A finite extreme APY (e.g. net = 29) passes soft validation and reaches `apy_hourly`; a `NaN` payload is skipped with a warn log.
- [ ] `/supply`, `/borrow`, portfolio, and market-rate charts render (products/positions/rates via `APP_ADAPTERS`); protocol badges show 'Aave v3' etc. via `protocolVersionName`.
- [ ] `pnpm build` green — proves no server-only import leaked into client components via `@/config` or `@/types`.
- [ ] No DB schema or repository query changes beyond the added `productProviders` read.

## Plan Self-Review

- **Coverage:** spec §3 contract (Task 1), §4 registry (Tasks 1, 8), §5 layout + Merkl (Tasks 2, 4, 5-7), §6 validation + harness (Tasks 3, 10), §7 AppAdapter (Tasks 5-7, 9), §8 call sites + heal fix (Tasks 8-9), §9 deletions (Tasks 5-7, 9), §10 verification-per-stage (baseline steps), §13 criteria (checklist).
- **Deviations from spec, all deliberate and stated in Global Constraints:** (1) `AppAdapter` gains `getSupplyProducts`/`getBorrowProducts` — live consumers exist; (2) runtime zod omits the `|net| < 10` bound — it would recreate the heal-backdoor bug; the bound lives in the strict harness; (3) Compound history fetchers survive as module exports for sync-history despite no `getApyHistory` on the contract; (4) small named helpers in `protocols-meta.ts` instead of raw lookups at 6 call sites — DRY.
- **Type consistency:** `adapter`/`appAdapter` export names, `YIELD_ADAPTERS`/`APP_ADAPTERS`, `HistoryParams`, `FetchOpts`, `productProviders`, `adapterIdsForProvider`, `protocolVersionName` are used with identical signatures across Tasks 1, 5-9. `UiSupplyProduct` vs DB `SupplyProduct` distinction carried through.
- **Sequencing:** `protocols-server.ts` is deliberately created in Task 8, after Tasks 5-7 exposed the `adapter` exports it dynamic-imports — every task leaves `pnpm typecheck` green.
- **PR mapping (spec §10):** PR1 ≈ Tasks 1-4, PR2 ≈ Tasks 5-8, PR3 ≈ Task 9, PR4 ≈ Task 10 — commits are grouped so Cedric can slice branches at those boundaries.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-yield-adapter-refactor.md`.

Recommended execution mode: **Subagent-Driven** — one task per fresh subagent, diff + test review between tasks. Tasks 5-7 need network + `THEGRAPH_API_KEY` for baseline capture.
