# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DeFi yield optimization platform: aggregates and compares supply/borrow positions on Aave V3, Morpho Blue/MetaMorpho, and Compound V3 across 8 chains — Ethereum, Optimism, Polygon, Base, Arbitrum, Avalanche, Linea, BSC (the last three are Aave-only). ~700 active products / ~120 assets in the DB (July 2026). Production: https://lendwise.fi.

**Stack:** Next.js 16 (App Router) · TypeScript strict · Tailwind 4 + Radix UI · viem/wagmi · PostgreSQL (Neon) + Drizzle ORM · The Graph (GraphQL) · graphql-yoga · URQL · Zustand · QStash (cron)

---

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server → localhost:3000
pnpm build            # codegen + next build
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm format:check     # Prettier check
pnpm codegen          # Regenerate GraphQL types (from schema + protocol subgraphs)
pnpm codegen:clean    # Wipe generated/ folders then regenerate
pnpm db:generate      # Generate a Drizzle migration from schema.ts
pnpm db:migrate       # Apply migrations to Postgres (Neon)
pnpm run products:sync     # Sync products to DB
pnpm run test:collateral   # Manual collateral validation (Aave)
```

No test runner is configured — code quality relies on TypeScript strict mode and ESLint.

---

## Architecture

### Data pipeline

```
QStash cron (every 10 min)
  → POST /api/yield/apy/spot
  → collectApySpot() server action
  → Protocol adapters (Aave/Morpho/Compound GraphQL + on-chain)
  → Postgres upsert: apy_hourly (chunked multi-row, deduped per slot)

QStash cron (daily 00:10 UTC)
  → POST /api/yield/apy/daily
  → Aggregates apy_hourly → apy_daily (single GROUP BY) + prunes rows >180d

graphql-yoga at /api/graphql
  ← URQL client (React components)
```

### Protocol adapters (`src/lib/protocols/`)

Each protocol has `offchain/` (protocol GraphQL API) and/or `onchain/` (The Graph subgraph) adapters. Add a new protocol by:

1. Adding to `Protocol` union in `src/types/supplying.ts`
2. Creating `src/lib/protocols/{name}/index.ts` with `getAccountPositions`
3. Registering in `SUPPORTED_PROTOCOLS` in `src/config/protocols.ts`

`Promise.allSettled` is used everywhere multiple sources are aggregated — one failure doesn't block others. To disable a protocol temporarily, comment its entry in `SUPPORTED_PROTOCOLS`.

### Compound V3 chain overrides

Compound V3 subgraphs differ by chain (Messari vs Spencer schema). Override pattern: `src/lib/protocols/compound/v3/onchain/{chainName}/` with `queries.ts`, `transformers.ts`, `index.ts` calling `registerChain(...)`. Runtime uses the chain-specific version if present, else default.

---

## PostgreSQL (Neon)

Drizzle ORM. Schema in `src/lib/db/schema.ts`, client in `src/lib/db/postgres.ts` (neon-http), repositories in `src/lib/db/repositories/`. Migrations via drizzle-kit (`pnpm db:generate` → `pnpm db:migrate`).

**Rule — never parse `productId`.** Filters hit typed, indexed columns; provider/chain/asset/kind are resolved by JOIN to `products`. (The productId string is irregular — morpho has no `:kind` suffix — so regex/substring filtering is wrong.)

4 tables:

### `products` — static registry

- PK `id` = deterministic productId slug (e.g. `aave:v3:ethereum:reserve:0x…:supply`)
- Typed columns: `kind`, `provider`, `product_type`, `version`, `protocol_name`, `chain_id`, `chain_name`, `asset_*`, `protocol_address`
- `meta` (jsonb) — protocol-specific params · `collaterals` (jsonb) — borrow only
- Indexes: `(provider, asset_symbol, kind)`, `(protocol_name, asset_symbol, kind)`, `(active, chain_id)`
- **Rule — filter/group chains by `chain_id`, never `chain_name`.** `chain_name` is inconsistent across adapters for the same chain: Aave writes capitalized names (`Ethereum`, `Optimism`, `Arbitrum`), Morpho/Compound write viem-style lowercase (`ethereum`, `op mainnet`, `arbitrum one`). Only `chain_id` is canonical.

### `apy_hourly` — rolling average per `(product_id, hour)`

- PK `(product_id, hour)` · running mean via `INSERT … ON CONFLICT DO UPDATE` every 10 min
- Duplicate productIds within a slot are deduped (one observation/product — Compound emits one per collateral)
- All rates stored as **APY** · Net: Supply `base - fees + rewards` / Borrow `base + fees - rewards`
- Pruned > 180 days by the daily job (`pruneHourly`)

### `apy_daily` — daily aggregate

- PK `(product_id, date)` · one `GROUP BY` over the day's hourly rows (`avg()` per field; `reward_items` = last slot)
- `quality_completeness` = hourly rows present / 24 · `< 0.5` → unreliable
- Idempotent — reruns bump `quality_revision`

### `pipeline_reports`

- gap-detection + gap-healing run reports (`jsonb` payload), read by the heal job + `/status`

---

## GraphQL

- **Server:** `graphql-yoga` at `/api/graphql` — schema in `src/lib/graphql/schema.ts`, resolvers in `src/lib/graphql/resolvers.ts`
- **Client:** URQL (React, suspense-compatible)
- **Codegen:** `@graphql-codegen/cli` — generates types into `src/**/generated/` from schema + subgraph introspection. Run before build (`pnpm build` does this automatically).

---

## Token icons

Single component `<TokenIcon symbol="USDC" size={24} />`.

Resolution priority:

1. `/public/icons/native/{symbol}.svg` — instant
2. `localStorage` — client-side persistence
3. Server memory cache — 24h
4. CoinGecko API — fallback (50 calls/min, 1 call/token/24h)

Internal API: `GET /api/token-icon?symbol=BTC`

Fiat currencies: `<CurrencyIcon currency="USD" />` → financial-flag-icons.

---

## Code rules

- **TypeScript strict** — no `any`
- **Functional only** — no classes
- **RPC batching** — group on-chain calls as much as possible
- **Promise.allSettled** wherever multiple sources are aggregated
- **APR → APY**: always `(1 + APR/365)^365 - 1` before storage

---

## Known issues

**rsETH on AaveV3Arbitrum**: GraphQL API returns `canBeCollateral: false` while Aave UI shows `true`. Code is correct (trusts official API). See `docs/aave-collateral-discrepancies.md`.

---

## Environment variables

```env
# PostgreSQL (Neon)
DATABASE_URL=                       # pooled URL — app runtime
DATABASE_URL_UNPOOLED=              # direct URL — drizzle-kit migrations

# Cron security
CRON_SECRET=                        # Bearer token for /api/cron/sync-history
UPSTASH_QSTASH_TOKEN=               # QStash signature verification

# External APIs
THEGRAPH_API_KEY=
NEXT_PUBLIC_INFURA_API_KEY=
OPTIMIZER_API_URL=                  # External optimizer service (also used by codegen:optimizer)

# Wallet / frontend
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_ENABLE_TESTNETS=false
NEXT_PUBLIC_API_URL=
```
