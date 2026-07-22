# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DeFi yield aggregator: supply/borrow markets on Aave V3 (21 chains), Morpho Blue + MetaMorpho (12 chains), and Compound V3 (5 chains) — 27 standardized chains total, 16 of them wallet-transactable. ~940 active products / ~130 assets (July 2026). Chain identity lives in the registry `src/lib/protocols/core/toolkit/chain-slugs.ts` (slug/chainId/caip2; non-EVM = negative chainId), adapter configs pick coverage from it, `src/config/chains.ts` holds the execution (RPC/wagmi) subset. Counts are derived — `STANDARDIZED_CHAIN_COUNT` (`src/config/chains-coverage.ts`), `TX_CHAIN_COUNT` (`src/config/chains.ts`), live market/asset counts from `/api/stats` — never hardcode them in copy. Production: https://lendwise.fi.

**Stack:** Next.js 16 (App Router) · TypeScript strict · Tailwind 4 + Radix UI · viem/wagmi · PostgreSQL (Neon) + Drizzle ORM · graphql-yoga + URQL + GraphQL codegen · The Graph · QStash (cron) · Vitest

---

## Commands

```bash
pnpm install
pnpm dev              # Dev server → localhost:3000
pnpm codegen          # Regenerate GraphQL types — REQUIRED before typecheck/test
                      # after a fresh clone (needs THEGRAPH_API_KEY)
pnpm build            # codegen + next build
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest
pnpm format:check     # Prettier check
pnpm adapter:test <id>     # Live adapter harness (aave_v3 | morpho_v1 | compound_v3)
pnpm db:generate           # Drizzle migration from schema.ts
pnpm db:migrate            # Apply migrations (Neon)
pnpm run products:sync     # Sync products to DB
```

CI (`.github/workflows/ci.yml`) runs format + lint, then codegen + test + typecheck (needs the `THEGRAPH_API_KEY` repo secret).

---

## Architecture

### Data pipeline

```
QStash cron (every 10 min, signature-verified)
  → POST /api/yield/apy/spot
  → adapters (Aave/Morpho/Compound) → Postgres upsert: apy_hourly

QStash cron (daily 00:10 UTC)
  → POST /api/yield/apy/daily
  → aggregates apy_hourly → apy_daily + prunes rows >180d

Gap detection + healing: /api/yield/apy/gaps + /api/yield/apy/heal
  → reports in pipeline_reports (see ../../agent/references/lendwise/apy-pipeline-gap-heal.md)

graphql-yoga at /api/graphql ← URQL client (React)
```

### Protocol adapters (`src/lib/protocols/`)

**Read `src/lib/protocols/README.md` before touching adapters** — it is the authoritative guide (contract, conventions, validation, how to add a protocol).

Essentials:

- One adapter per protocol+version at `src/lib/protocols/{name}/{version}/`, built with `defineYieldAdapter()` — implements `getProducts` + `getApySpot` (+ optional `getApyHistory`).
- Two registries wire adapters in: `src/config/protocols-meta.ts` (client-safe metadata) and `src/config/protocols-server.ts` (server-only dynamic imports). `Record<ProtocolName, …>` typing forces them to stay in sync. Disable a protocol = comment its entries in **both**.
- `listing.ts` is the single enumeration predicate per adapter — `getProducts` and `getApySpot` must emit the exact same productId set.
- Compound V3 has per-chain subgraph overrides (chain dirs + `createChainRegistry` from `core/toolkit`).
- `Promise.allSettled` everywhere multiple sources aggregate — one failure never blocks the others.

---

## PostgreSQL (Neon)

Drizzle ORM. Schema `src/lib/db/schema.ts`, client `src/lib/db/postgres.ts` (neon-http), repositories `src/lib/db/repositories/`.

**Rule — never parse `productId`.** It is an opaque key; provider/chain/asset/kind are typed columns on `products` — resolve by JOIN.

**Rule — filter/group chains by `chain_id`, never `chain_name`.** Names are inconsistent across adapters (`Ethereum` vs `ethereum` vs `op mainnet`); only the numeric id is canonical.

4 tables:

- **`products`** — static registry. PK `id` = productId slug. Typed columns (`kind`, `provider`, `chain_id`, `asset_*`, …), `meta`/`collaterals` jsonb.
- **`apy_hourly`** — PK `(product_id, hour)`. Running mean via `ON CONFLICT DO UPDATE` every 10 min. All rates stored as **APY**; net = supply `base − fees + rewards`, borrow `base + fees − rewards`. Pruned >180 days.
- **`apy_daily`** — PK `(product_id, date)`. One GROUP BY over the day's hourly rows. `quality_completeness` = hourly rows / 24; `< 0.5` → unreliable. Idempotent reruns.
- **`pipeline_reports`** — gap-detection/heal run reports (jsonb).

Schema field semantics: `../../agent/references/lendwise/PRODUCTS_SCHEMA.md`, `../../agent/references/lendwise/APY_DAILY_SCHEMA.md`.

---

## GraphQL

- **Server:** graphql-yoga at `/api/graphql` — schema `src/lib/graphql/schema.ts`, resolvers `src/lib/graphql/resolvers.ts`. Protected by graphql-armor (cost limit scales with `first`).
- **Client:** URQL (suspense-compatible).
- **Codegen:** types generated into `src/**/generated/` (gitignored) from schema + subgraph introspection.

Beware: subgraph `BigDecimal` fields come back as **strings** (`any` in codegen) — wrap in `toNumber()`.

---

## Token icons

`<TokenIcon symbol="USDC" size={24} />` (`src/components/icon/`). Resolution: `/public/icons/native/{symbol}.svg` → localStorage → server cache 24h → CoinGecko API. Server action: `getTokenIcon(symbol)` (`src/app/actions/token-icon.actions.ts`). Details: `../../agent/references/lendwise/COINGECKO_TOKEN_ICONS.md`.

---

## Code rules

- **TypeScript strict** — no `any`
- **Functional only** — no classes
- **RPC batching** — group on-chain calls (multicall) where possible
- **`Promise.allSettled`** wherever multiple sources are aggregated
- **APR → APY**: always `(1 + APR/365)^365 − 1` before storage (helpers in `src/lib/utils.ts`)

---

## Known issues

**rsETH on AaveV3Arbitrum**: GraphQL API returns `canBeCollateral: false` while the Aave UI shows `true`. Code is correct (trusts the official API). See `../../agent/references/lendwise/aave-collateral-discrepancies.md`.

---

## Environment variables

```env
# PostgreSQL (Neon)
DATABASE_URL=                       # pooled — app runtime
DATABASE_URL_UNPOOLED=              # direct — drizzle-kit migrations

# Cron security
CRON_SECRET=                        # Bearer token for /api/cron/sync-history
QSTASH_CURRENT_SIGNING_KEY=         # QStash signature verification (apy/spot, apy/daily)
QSTASH_NEXT_SIGNING_KEY=

# Rate limiting — public endpoints (/api/graphql 60/min/IP, /api/optimizer 10/min/IP)
UPSTASH_REDIS_REST_URL=             # unset → limiter is a no-op (allows everything)
UPSTASH_REDIS_REST_TOKEN=           # REQUIRED in prod; fails OPEN if Redis unreachable

# External APIs
THEGRAPH_API_KEY=                   # codegen + Compound V3 subgraph
NEXT_PUBLIC_INFURA_API_KEY=
OPTIMIZER_API_URL=                  # external optimizer service

# Frontend
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=  # analytics (optional)
NEXT_PUBLIC_POSTHOG_HOST=
```
