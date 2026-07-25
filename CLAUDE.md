# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DeFi yield aggregator: supply/borrow markets on Aave V3 (21 chains), Morpho Blue + MetaMorpho (12 chains), and Compound V3 (5 chains) — 27 standardized chains total, 16 of them wallet-transactable. ~940 active products / ~130 assets (July 2026). Chain identity lives in the registry `src/lib/protocols/core/toolkit/chain-slugs.ts` (slug/chainId/caip2; non-EVM = negative chainId), adapter configs pick coverage from it, `src/config/chains.ts` holds the execution (RPC/wagmi) subset. Counts are derived — `STANDARDIZED_CHAIN_COUNT` (`src/config/chains-coverage.ts`), `TX_CHAIN_COUNT` (`src/config/chains.ts`), live market/asset counts from `/api/stats` — never hardcode them in copy. Production: https://lendwise.fi.

---

## Commands

Standard scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `format:check`)
are in `package.json`. The ones with a catch:

```bash
pnpm codegen          # Regenerate GraphQL types — REQUIRED before typecheck/test
                      # after a fresh clone (needs THEGRAPH_API_KEY)
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

QStash cron (daily 00:30 UTC)
  → POST /api/yield/apy/reconcile   { days: 7 }
  → 1. detect   gaps + incomplete slots over the window
    2. repair   targeted refetch by productId, nearest-neighbour as fallback
    3. aggregate apy_hourly → apy_daily, oldest day first
    4. prune    hourly rows >180d
  → report in pipeline_reports (see ../../agent/docs/lendwise/apy-pipeline-reconcile.md)

QStash cron (hourly)
  → POST /api/yield/products      (catalogue sync + availability periods)
  → POST /api/yield/apy/eligibility (display flags, hysteresis 3/12)

graphql-yoga at /api/graphql ← URQL client (React)
```

**The order in reconcile is the point.** Repair, aggregation and pruning used to
be three independently scheduled jobs, so a row repaired at 01:00 was never seen
by the aggregation that had run at 00:10 — a repaired hour never reached
`apy_daily`. One job in one sequence is what makes the repair converge.

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
- **`pipeline_reports`** — job run reports (jsonb). Type `reconcile` since 2026-07-24; `gap-detection` / `gap-healing` are legacy rows from the jobs it replaced.

Schema field semantics: `../../agent/docs/lendwise/PRODUCTS_SCHEMA.md`, `../../agent/docs/lendwise/APY_DAILY_SCHEMA.md`.

---

## GraphQL

- **Server:** graphql-yoga at `/api/graphql` — schema `src/lib/graphql/schema.ts`, resolvers `src/lib/graphql/resolvers.ts`. Protected by graphql-armor (cost limit scales with `first`).
- **Client:** URQL (suspense-compatible).
- **Codegen:** types generated into `src/**/generated/` (gitignored) from schema + subgraph introspection.

Beware: subgraph `BigDecimal` fields come back as **strings** (`any` in codegen) — wrap in `toNumber()`.

---

## Token icons

`<TokenIcon symbol="USDC" size={24} />` (`src/components/icon/`). Resolution: `/public/icons/native/{symbol}.svg` → localStorage → server cache 24h → CoinGecko API. Server action: `getTokenIcon(symbol)` (`src/app/actions/token-icon.actions.ts`). Details: `../../agent/docs/lendwise/COINGECKO_TOKEN_ICONS.md`.

---

## Code rules

- **TypeScript strict** — no `any`
- **Functional only** — no classes
- **RPC batching** — group on-chain calls (multicall) where possible
- **`Promise.allSettled`** wherever multiple sources are aggregated
- **APR → APY**: always `(1 + APR/365)^365 − 1` before storage (helpers in `src/lib/utils.ts`)

---

## Known issues

**rsETH on AaveV3Arbitrum**: GraphQL API returns `canBeCollateral: false` while the Aave UI shows `true`. Code is correct (trusts the official API). See `../../agent/docs/lendwise/aave-collateral-discrepancies.md`.

---

## Environment variables

The full list is `.env.example`.

Behaviour you cannot infer from the names:

- `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` gate every `/api/yield/*` job; unset means the pipeline returns 401 to QStash and silently stops ingesting.

- `UPSTASH_REDIS_REST_URL` unset → the rate limiter becomes a no-op and allows everything.
- `UPSTASH_REDIS_REST_TOKEN` is REQUIRED in prod, and the limiter fails **OPEN** if Redis is unreachable.
- `THEGRAPH_API_KEY` is needed by codegen, not only at runtime — a fresh clone cannot typecheck without it.
- Rate limits on public endpoints: `/api/graphql` 60/min/IP, `/api/optimizer` 10/min/IP.
