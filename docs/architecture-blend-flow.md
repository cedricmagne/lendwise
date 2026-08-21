# LendWise — Protocol Processing Flow & Blend Integration

> **Legend** — <span style="color:#16a34a">green = NEW bricks added for Stellar/Blend</span> ·
> blue = existing EVM pipeline (unchanged) · grey = shared core (unchanged).

---

## 1. Spot market data — current EVM protocols + Blend addition

```mermaid
flowchart TD
    %% ---------- Triggers ----------
    Cron["QStash cron<br/>every 10 min"] --> SpotRoute["POST /api/yield/apy/spot<br/>app/api/yield/apy/spot/route.ts"]
    SpotRoute --> Collect["collectApySpot()<br/>app/actions/apy-snapshots.actions.ts"]

    %% ---------- Registry ----------
    Collect --> Registry{{"YIELD_ADAPTERS<br/>src/config/protocols-server.ts<br/>lazy per-protocol dynamic import"}}

    %% ---------- EVM adapters (existing, GraphQL path) ----------
    subgraph EVM["EVM adapters — existing (GraphQL path)"]
        direction TB
        Aave["aave_v3<br/>aave/v3/apy-spot.ts"]
        Morpho["morpho_v1<br/>morpho/v1/apy-spot.ts"]
        Compound["compound_v3<br/>compound/v3/apy-spot.ts"]
        GqlClient["core/toolkit createGraphQLClient()<br/>(URQL)"]
        TheGraph[("The Graph subgraphs<br/>GraphQL")]
        Aave --> GqlClient
        Morpho --> GqlClient
        Compound --> GqlClient
        GqlClient --> TheGraph
    end

    %% ---------- Blend adapters (already implemented, non-GraphQL path, same uniform per-version layout as EVM) ----------
    subgraph STELLAR["Blend adapters — no subgraph, no GraphQL"]
        direction TB
        BlendV1["blend_v1<br/>blend/v1/apy-spot.ts<br/>fetchBlendV1ApySpot()"]
        BlendV2["blend_v2<br/>blend/v2/apy-spot.ts<br/>fetchBlendV2ApySpot()"]
        BlendSvc["blend/common/api.ts<br/>getBackstop · getPool · getPoolPrices"]
        BlendSDK["@blend-capital/blend-sdk<br/>+ @stellar/stellar-sdk"]
        SorobanRPC[("Soroban RPC<br/>paced ~300ms/call<br/>Backstop.load · PoolV1/V2.load")]
        BlendV1 --> BlendSvc
        BlendV2 --> BlendSvc
        BlendSvc --> BlendSDK --> SorobanRPC
    end

    Registry -->|"aave_v3"| Aave
    Registry -->|"morpho_v1"| Morpho
    Registry -->|"compound_v3"| Compound
    Registry -->|"blend_v1"| BlendV1
    Registry -->|"blend_v2"| BlendV2

    %% ---------- Per-reserve market data — each adapter returns SpotPayload[] already normalized ----------
    SorobanRPC --> BlendFields["Per reserve, live today:<br/>supply/borrow APY (aprToApyDaily)<br/>total supplied/borrowed liquidity · utilization<br/><br/>1.1a hardening adds:<br/>ir_mod · util · r_base · r_one · r_two · r_three · reactivity<br/>+ tests for no-oracle-pool and RPC-refusal paths"]
    TheGraph --> EvmFields["SpotPayload[]<br/>normalized inside each EVM adapter"]

    %% ---------- Persistence (shared, unchanged) ----------
    EvmFields --> Validate["spotPayloadSoftSchema<br/>soft-validate shape + finiteness"]
    BlendFields --> Validate
    Validate --> ApyRepo["upsertHourlySlots()<br/>repositories/apy.ts — running mean"]
    ApyRepo --> Hourly[("apy_hourly<br/>PK (product_id, hour)")]

    ReconcileCron["QStash cron<br/>nightly"] --> ReconcileRoute["POST /api/yield/apy/reconcile<br/>runReconcile() — 7-day sliding window"]
    ReconcileRoute --> Aggregate["aggregateDaily() + pruneHourly()<br/>+ gap/incomplete detection + donor/history healing"]
    Hourly --> Aggregate --> Daily[("apy_daily<br/>PK (product_id, date)")]
    ReconcileRoute --> Reports[("pipeline_reports<br/>insertReport('reconcile', …)")]

    %% ---------- Serving (shared, unchanged) ----------
    Hourly --> GraphQLServer["graphql-yoga /api/graphql"]
    Daily --> GraphQLServer
    GraphQLServer --> UI["URQL client<br/>Dashboard: EVM + Blend yields"]

    %% ---------- Styles ----------
    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef evm fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;

    class Cron,SpotRoute,Collect,Registry,Validate,ApyRepo,Hourly,ReconcileCron,ReconcileRoute,Aggregate,Daily,Reports,GraphQLServer,UI core;
    class Aave,Morpho,Compound,GqlClient,TheGraph,EvmFields evm;
    class BlendV1,BlendV2,BlendSvc,BlendSDK,SorobanRPC,BlendFields stellar;
```

**Reading the diagram** — matches the code as implemented, not a future design.

- The trigger, registry, `apy_hourly`/`apy_daily`, the nightly reconcile job, and the GraphQL
  serving layer are **shared and unchanged** — protocol-agnostic by design. `YIELD_ADAPTERS` in
  `src/config/protocols-server.ts` is the actual registry: a plain record of lazy dynamic imports
  keyed by protocol id (`aave_v3`, `morpho_v1`, `compound_v3`, `blend_v1`, `blend_v2`).
  `collectApySpot()` calls `getApySpot()` on every registered id via `Promise.allSettled`.
- Existing EVM protocols read through **The Graph subgraphs** via `createGraphQLClient()`.
- **Blend has no subgraph**, so `blend_v1`/`blend_v2` bypass GraphQL entirely, reading **Soroban
  contracts** through the **Blend SDK**. Both share `blend/common/api.ts`, which discovers the
  live pool set from `Backstop.load(...).config.rewardZone` rather than a hardcoded list, and
  serializes every RPC read behind a ~300ms pacing queue to stay under Soroban RPC's rate limit.
  This is the same uniform `<protocol>/<version>/apy-spot.ts` layout every EVM adapter already
  follows (`aave/v3/`, `morpho/v1/`, `compound/v3/`) — not a Blend-specific exception.
- **Already live:** supply/borrow APY, total supplied/borrowed liquidity, and utilization per
  reserve. **Not yet captured — this is 1.1a's hardening deliverable:** the interest rate modifier
  (`ir_mod`) and rate parameters (`util`, `r_base`, `r_one`, `r_two`, `r_three`, `reactivity`),
  plus test coverage for the no-oracle-pool and RPC-refusal failure paths already handled in code.
- Each adapter — EVM or Blend — returns `SpotPayload[]` **already normalized internally**; there is
  no separate shared normalization stage. `collectApySpot()` only soft-validates
  (`spotPayloadSoftSchema`) and upserts via `upsertHourlySlots()`.
- There is no separate daily cron: a single **nightly `/api/yield/apy/reconcile`** job
  (`runReconcile()`, 7-day sliding window) detects gaps/incomplete hours, heals them from donor
  products or via `adapter.getApyHistory()`, aggregates `apy_hourly` into `apy_daily`, prunes old
  hourly rows, and logs one row per run into `pipeline_reports`.

---

## 2. Historical market data — Stellar Hubble reconstruction (NEW)

```mermaid
flowchart TD
    BackfillScript["scripts/backfill-history.ts<br/>pnpm backfill:history -- --protocol blend_v2 --write<br/>PROTOCOL-BLIND — knows only adapter.getApyHistory"] --> Registry3{{"YIELD_ADAPTERS<br/>same registry as spot — no script changes"}}
    Registry3 --> BlendHistory["blend_v1 / blend_v2<br/>getApyHistory() — NEW<br/>blend/v1/apy-history.ts · blend/v2/apy-history.ts"]

    Hubble[("Stellar Hubble<br/>historical Blend reserve states")] --> BlendHistory
    BlendHistory --> Reconstruct["Historical-state reconstruction — NEW<br/>reserve states → one point per (product, day):<br/>supply/borrow APY · total supplied/borrowed liquidity<br/>utilization · ir_mod · util · r_base · r_one · r_two · r_three · reactivity"]

    Reconstruct --> Enrich["enrichPointsWithUsd()<br/>backfill/enrich-usd.ts — prices points missing USD<br/>from another provider's same-day observation"]
    Enrich --> Insert["backfillDailyRows()<br/>INSERT add-only, ON CONFLICT DO NOTHING"]
    Enrich --> Patch["patchDailyMarketState()<br/>PATCH fill-only, COALESCE(existing, incoming)"]
    Insert --> Daily2[("apy_daily<br/>backfilled directly, target 90+ days")]
    Patch --> Daily2

    Daily2 --> Chart["Blend market page on lendwise.fi<br/>historical APY chart"]

    Reconcile2["Nightly /api/yield/apy/reconcile<br/>(section 1)"] -.->|"same getApyHistory,<br/>used for 7-day gap healing"| BlendHistory

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;

    class BackfillScript,Registry3,Enrich,Insert,Patch,Daily2,Chart,Reconcile2 core;
    class BlendHistory,Hubble,Reconstruct stellar;
```

**Reading the diagram**

- Blend has **no subgraph and no history API** of its own — unlike Aave's official subgraph or
  Compound's REST API — so there is no existing endpoint to call. Historical data has to be
  **reconstructed**, not fetched.
- The reconstruction queries **historical Blend reserve states from Stellar Hubble** and converts
  them into one point per (product, day), matching the shape every other `getApyHistory`
  implementation already returns. **This is not event replay** — reserve-state reconstruction, not
  transaction/event indexing.
- This branch is **separate from spot ingestion**: spot reads live Soroban RPC state on a
  10-minute cron and writes `apy_hourly`; historical reconstruction is consumed by two existing,
  protocol-blind callers of `adapter.getApyHistory()` — the manual `scripts/backfill-history.ts`
  harness, which writes straight into `apy_daily` (`backfillDailyRows` for missing days,
  `patchDailyMarketState` to fill market columns on rows that already exist), and the nightly
  reconcile job's nightly gap-healing (section 1) — **neither requires any change**, only
  registering `blend_v1`/`blend_v2`'s `getApyHistory()`.
- Output lands in the same `apy_hourly`/`apy_daily` tables every other protocol writes to, so
  serving, aggregation, and the optimizer (see `architecture-stellar-integration.md`) need no
  Blend-specific handling downstream of this point.

---

## 3. Wallet layer — connection shipped, SEP-10 authentication is NEW

```mermaid
flowchart LR
    subgraph Wallets["Stellar wallets — already shipped"]
        direction TB
        Freighter["Freighter"]
        XBull["xBull"]
        Lobstr["Lobstr"]
        Albedo["Albedo"]
    end

    Wallets --> StellarKit["StellarWalletContext.tsx<br/>@creit-tech/stellar-wallets-kit<br/>StellarWalletsKit.authModal()"]
    StellarKit --> Store["Zustand walletStore<br/>chainFamily: 'evm' | 'stellar' | 'bitcoin'"]

    subgraph SEP10["SEP-10 authentication — NEW (1.2)"]
        direction TB
        Challenge["LendWise backend issues<br/>SEP-10 challenge"]
        Sign["Wallet signs challenge"]
        Verify["LendWise backend<br/>verifies signature"]
        Session["Authenticated Stellar session"]
        Challenge --> Sign --> Verify --> Session
    end

    StellarKit -.->|"connect today: bare public key,<br/>no signature round trip"| Challenge
    Session -.->|"NEW: persist session,<br/>not just the address"| Store

    Wagmi["WagmiProvider + RainbowKit<br/>EVM — existing"] -->|"0x… address (viem)"| Store
    Store --> Dashboard["Unified dashboard<br/>EVM + Blend positions & portfolio"]

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef evm fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
    class Store,Dashboard core;
    class Wagmi evm;
    class Wallets,Freighter,XBull,Lobstr,Albedo,StellarKit,Challenge,Sign,Verify,Session stellar;
```

**Already shipped:** `src/contexts/StellarWalletContext.tsx` covers **Freighter, xBull, Lobstr,
and Albedo** through `@creit-tech/stellar-wallets-kit`'s `authModal()`, running alongside
`WagmiProvider`. The connected address is written into the existing Zustand `walletStore`
(`src/stores/walletStore.ts`), which already carries a `chainFamily` discriminator
(`'evm' | 'stellar' | 'bitcoin'`) — this is not new wiring, it is how EVM wallets persist today
too.

**NEW (1.2):** today's connect is a bare public-key read with no signature involved. SEP-10 adds
the missing authentication round trip on top of the existing context: the backend issues a
challenge transaction, the wallet signs it, the backend verifies the signature, and only then is
an authenticated **session** — not just an address — persisted. Blend position reads and the
health factor built on top of that session are detailed in
`architecture-stellar-integration.md`.

---

## 4. New vs existing — at a glance

| Brick                            | Status       | Library / path                                                          |
| :-------------------------------- | :----------- | :---------------------------------------------------------------------- |
| Adapter registry                  | existing     | `YIELD_ADAPTERS` — `src/config/protocols-server.ts`                     |
| Spot collection                   | existing     | `collectApySpot()` — `app/actions/apy-snapshots.actions.ts`             |
| EVM data source                   | existing     | The Graph subgraphs via `createGraphQLClient()` (URQL)                  |
| `apy_hourly` / `apy_daily`         | existing     | `repositories/apy.ts` + Drizzle schema                                  |
| Nightly reconcile (aggregate/heal) | existing     | `/api/yield/apy/reconcile` — `runReconcile()`                           |
| GraphQL serving                    | existing     | `graphql-yoga` `/api/graphql`                                           |
| Blend V1 spot adapter              | **shipped**  | `src/lib/protocols/blend/v1/apy-spot.ts`                                |
| Blend V2 spot adapter              | **shipped**  | `src/lib/protocols/blend/v2/apy-spot.ts`                                |
| Blend data source                  | **shipped**  | `@blend-capital/blend-sdk` + `@stellar/stellar-sdk` over Soroban RPC    |
| Stellar wallet connection          | **shipped**  | `StellarWalletContext.tsx` — Freighter / xBull / Lobstr / Albedo        |
| `chainFamily` store field          | **shipped**  | `src/stores/walletStore.ts`                                             |
| **Blend rate-parameter fields**    | **NEW (1.1a)** | `ir_mod` / `util` / `r_base` / `r_one` / `r_two` / `r_three` / `reactivity` + failure-path tests |
| **Blend historical adapter**       | **NEW (1.1b)** | `blend/v1/apy-history.ts` + `blend/v2/apy-history.ts` — `getApyHistory()` |
| **Stellar Hubble backfill**        | **NEW (1.1b)** | historical reserve-state reconstruction, consumed by the existing `scripts/backfill-history.ts` and nightly reconcile |
| **SEP-10 authentication**          | **NEW (1.2)**  | backend challenge endpoint + client-side signing flow + session persistence |
