# LendWise — Stellar Cross-Chain Integration Architecture

> **Scope** — the full Stellar integration across all five layers from the validated SCF entry:
> Blend lending data, Aquarius/StellarX DEX liquidity, Allbridge/Squid/CCTP bridging,
> MoneyGram/SEP-0024 on-ramp, and Freighter/xBull/Lobstr wallet connectivity (SEP-0010 auth).
>
> **Legend** — <span style="color:#16a34a">green = NEW bricks added for Stellar</span> ·
> blue = existing EVM pipeline (unchanged) · grey = shared core (unchanged) ·
> <span style="color:#7c3aed">purple = cross-chain execution</span> ·
> <span style="color:#d97706">amber = fiat on-ramp</span>.

The integration spans three functional planes:

- **Read plane** — ingest lending rates (Blend) and DEX liquidity (Aquarius, StellarX).
- **Wallet & auth plane** — connect/sign with Stellar wallets, authenticate via SEP-0010.
- **Execution plane** — on-ramp fiat, bridge cross-chain, swap, then deposit/repay on Blend.

---

## 1. Read plane — lending-rate ingestion (EVM + Blend)

```mermaid
flowchart TD
    %% ---------- Triggers ----------
    Cron["QStash cron<br/>every 10 min"] --> SpotRoute["POST /api/yield/apy/spot"]
    SpotRoute --> Collect["collectApySpot()<br/>apy-snapshots.actions.ts"]

    %% ---------- Registry ----------
    Collect --> Registry{{"PROTOCOL_REGISTRY<br/>src/config/protocols.ts<br/>(adapter registry)"}}

    %% ---------- EVM adapters (existing, GraphQL path) ----------
    subgraph EVM["EVM adapters — existing (GraphQL path)"]
        direction TB
        Aave["AaveAdapter<br/>aave/v3/apy-spot.ts"]
        Morpho["MorphoAdapter<br/>morpho/v1/apy-spot.ts"]
        Compound["CompoundAdapter<br/>compound/v3/apy-spot.ts"]
        GqlClient["shared/graphql-client.ts<br/>(URQL core)"]
        TheGraph[("The Graph subgraphs<br/>GraphQL")]
        Aave --> GqlClient
        Morpho --> GqlClient
        Compound --> GqlClient
        GqlClient --> TheGraph
    end

    %% ---------- Blend adapter (NEW, non-GraphQL path) ----------
    subgraph STELLAR["Blend adapter — NEW (no subgraph, no GraphQL)"]
        direction TB
        BlendAdapter["BlendAdapter<br/>src/lib/protocols/blend/index.ts"]
        BlendSvc["services/blend-api.ts<br/>spot rates + position reads"]
        BlendSDK["@blend-capital/blend-sdk-js<br/>+ @stellar/stellar-sdk"]
        SorobanRPC[("Soroban RPC<br/>getLedgerEntries / getEvents<br/>simulateTransaction")]
        BlendAdapter --> BlendSvc --> BlendSDK --> SorobanRPC
    end

    Registry --> Aave
    Registry --> Morpho
    Registry --> Compound
    Registry -->|"register 'blend'"| BlendAdapter

    %% ---------- Normalization (shared, unchanged) ----------
    TheGraph --> Normalize["Normalize → SupplyProduct / BorrowProduct<br/>APR → APY: (1 + APR/365)^365 − 1<br/>net = base − fees + rewards"]
    SorobanRPC --> Normalize

    %% ---------- Persistence (shared, unchanged) ----------
    Normalize --> ApyRepo["repositories/apy.ts<br/>upsert running mean"]
    ApyRepo --> Hourly[("apy_hourly<br/>PK (product_id, hour)")]

    DailyCron["QStash cron<br/>daily 00:10 UTC"] --> DailyRoute["POST /api/yield/apy/daily"]
    DailyRoute --> Aggregate["aggregate GROUP BY day<br/>+ prune > 180d"]
    Hourly --> Aggregate --> Daily[("apy_daily<br/>PK (product_id, date)")]

    %% ---------- Serving (shared, unchanged) ----------
    Hourly --> GraphQLServer["graphql-yoga /api/graphql"]
    Daily --> GraphQLServer
    GraphQLServer --> UI["URQL client<br/>Dashboard: EVM + Blend yields"]

    %% ---------- Styles ----------
    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef evm fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;

    class Cron,SpotRoute,Collect,Registry,Normalize,ApyRepo,Hourly,DailyCron,DailyRoute,Aggregate,Daily,GraphQLServer,UI core;
    class Aave,Morpho,Compound,GqlClient,TheGraph evm;
    class BlendAdapter,BlendSvc,BlendSDK,SorobanRPC stellar;
```

**Reading the diagram**

- The trigger, registry, normalization, `apy_hourly`/`apy_daily`, and the GraphQL serving layer
  are **shared and unchanged** — they are protocol-agnostic by design.
- Existing EVM protocols read through **The Graph subgraphs** via the shared URQL GraphQL client.
- **Blend has no subgraph**, so the new adapter **bypasses GraphQL entirely**: it reads pool
  state (`getLedgerEntries`), indexes position events (`getEvents`), and simulates reads
  (`simulateTransaction`) from **Soroban contracts** through the **Blend SDK**, then hands
  normalized `SupplyProduct`/`BorrowProduct` objects to the same pipeline.
- Adding Blend = register `'blend'` in `PROTOCOL_REGISTRY` + ship the green bricks. Nothing in the
  blue/grey path changes.

---

## 2. Read plane — DEX liquidity (Aquarius, StellarX)

```mermaid
flowchart LR
    subgraph DEX["Stellar DEX liquidity — NEW"]
        direction TB
        Aquarius["Aquarius AMM<br/>volatile + stable pools"]
        AquariusSrc[("Soroban RPC<br/>+ Aquarius backend API")]
        StellarX["StellarX order books"]
        Horizon[("Horizon API<br/>order-book endpoint")]
        Aquarius --> AquariusSrc
        StellarX --> Horizon
    end

    AquariusSrc --> Quote["Liquidity / depth + slippage<br/>src/lib/liquidity/*"]
    Horizon --> Quote
    Quote --> Optimizer["Optimizer<br/>swap routing + allocation pricing"]

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
    class Quote,Optimizer core;
    class Aquarius,AquariusSrc,StellarX,Horizon stellar;
```

**New bricks (green):** Aquarius volatile/stable AMM pools read via **Soroban RPC + the Aquarius
backend API**, and StellarX order books read via the **Horizon** order-book endpoint. Both feed
the optimizer so cross-asset Stellar allocations are priced from **real on-chain liquidity**, not
estimates, and so the swap leg of the execution flow has accurate slippage.

---

## 3. Wallet & auth plane — multi-ecosystem coexistence

```mermaid
flowchart LR
    subgraph Providers["App providers (parallel)"]
        Wagmi["WagmiProvider + RainbowKit<br/>EVM — existing"]
        StellarKit["StellarWalletContext<br/>@creit-tech/stellar-wallets-kit<br/>Freighter / xBull / Lobstr — NEW"]
    end

    StellarKit --> Auth["SEP-0010 authentication<br/>challenge → sign → JWT"]
    Wagmi -->|"0x… address (viem)"| Store["Zustand walletStore<br/>chainFamily: 'evm' | 'stellar'"]
    StellarKit -->|"G… / C… public key"| Store
    Auth --> Store
    Store --> Dashboard["Unified dashboard<br/>EVM + Stellar positions"]

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef evm fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
    class Store,Dashboard core;
    class Wagmi evm;
    class StellarKit,Auth stellar;
```

**New bricks (green):** `@creit-tech/stellar-wallets-kit` + a `StellarWalletContext` running
**alongside** `WagmiProvider`, covering **Freighter, xBull, and Lobstr** through one signing
interface. **SEP-0010** authenticates the connected key (challenge → sign → session). Both feed
the existing Zustand `walletStore` once it carries a `chainFamily` discriminator. EVM wallet flow
is untouched.

---

## 4. Execution plane — on-ramp, bridge, swap, deposit

```mermaid
flowchart TD
    Optimizer["Optimizer<br/>best allocation under yield + risk"] --> Plan["Guided execution flow<br/>(single flow, step-routed)"]

    subgraph OnRamp["Fiat on-ramp — NEW"]
        MoneyGram["MoneyGram Ramps API"]
        SEP24["SEP-0024 anchors<br/>(interactive deposit/withdraw)"]
    end

    subgraph Bridge["Cross-chain bridging — NEW"]
        Allbridge["Allbridge Core SDK<br/>stablecoin transfers"]
        Squid["Squid Router API<br/>Axelar GMP token swaps"]
        CCTP["Circle CCTP<br/>native USDC burn-and-mint (23 chains)"]
    end

    subgraph SwapDeposit["Swap & deposit — Stellar"]
        Swap["Swap<br/>Aquarius / StellarX"]
        Deposit["Deposit / Repay<br/>Blend pools (Soroban)"]
    end

    Plan -->|"fiat entry"| MoneyGram
    Plan -->|"fiat entry"| SEP24
    Plan -->|"cross-chain move"| Allbridge
    Plan -->|"cross-chain move"| Squid
    Plan -->|"cross-chain move"| CCTP

    MoneyGram --> Funds["Stellar asset available"]
    SEP24 --> Funds
    Allbridge --> Funds
    Squid --> Funds
    CCTP --> Funds

    Funds --> Swap --> Deposit
    Deposit --> Sign["Sign via Stellar Wallets Kit<br/>(Freighter / xBull / Lobstr)"]

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
    classDef bridge fill:#ede9fe,stroke:#7c3aed,color:#111827,stroke-width:2px;
    classDef onramp fill:#fef3c7,stroke:#d97706,color:#111827,stroke-width:2px;
    class Optimizer,Plan,Funds core;
    class Swap,Deposit,Sign stellar;
    class Allbridge,Squid,CCTP bridge;
    class MoneyGram,SEP24 onramp;
```

**Reading the diagram**

- The optimizer produces a target allocation; the **guided execution flow** routes the steps
  needed to reach it in one place.
- **On-ramp (amber):** new users enter from fiat via the **MoneyGram Ramps API** or **SEP-0024**
  anchors, landing a Stellar asset ready to deploy.
- **Bridging (purple):** existing capital moves between EVM and Stellar via **Allbridge Core**
  (stablecoins), **Squid Router** (Axelar GMP swaps), or **Circle CCTP** (native USDC
  burn-and-mint across 23 chains, no wrapped-asset risk) — route chosen per asset/chain/cost.
- **Swap & deposit (green):** the Stellar asset is swapped via Aquarius/StellarX if needed, then
  supplied/repaid on Blend pools, with every transaction **signed through Stellar Wallets Kit**.

---

## 5. End-to-end cross-chain user journey

```mermaid
flowchart LR
    A["Connect wallet<br/>(EVM and/or Stellar)<br/>SEP-0010 auth"] --> B["Unified dashboard<br/>EVM + Blend yields & positions"]
    B --> C["Optimizer<br/>yield target + risk constraints"]
    C --> D{"Best venue?"}
    D -->|"Stellar / Blend"| E["Guided flow"]
    D -->|"EVM venue"| E
    E --> F["On-ramp (if fiat)<br/>MoneyGram / SEP-0024"]
    E --> G["Bridge (if cross-chain)<br/>Allbridge / Squid / CCTP"]
    F --> H["Swap if needed<br/>Aquarius / StellarX"]
    G --> H
    H --> I["Deposit / Repay<br/>Blend (or EVM protocol)"]
    I --> J["Position reflected in<br/>unified portfolio"]
    J --> B

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    class A,B,C,D,E,F,G,H,I,J core;
```

This is the single guided flow the product promises: **connect → compare → optimize → execute**,
with Stellar/Blend as a first-class venue ranked next to EVM markets and reachable from fiat or
from any of 23 chains.

---

## 6. New vs existing — at a glance

| Brick                          | Status   | Library / path                                                          |
| :----------------------------- | :------- | :---------------------------------------------------------------------- |
| Adapter registry               | existing | `PROTOCOL_REGISTRY` — `src/config/protocols.ts`                         |
| Spot collection                | existing | `collectApySpot()` — `apy-snapshots.actions.ts`                         |
| EVM lending data               | existing | The Graph subgraphs via `shared/graphql-client.ts` (URQL)               |
| `apy_hourly` / `apy_daily`     | existing | `repositories/apy.ts` + Drizzle schema                                  |
| GraphQL serving                | existing | `graphql-yoga` `/api/graphql`                                           |
| **Blend lending adapter**      | **NEW**  | `src/lib/protocols/blend/`                                              |
| **Blend data source**          | **NEW**  | `@blend-capital/blend-sdk-js` + `@stellar/stellar-sdk` over Soroban RPC |
| **DEX liquidity — Aquarius**   | **NEW**  | `src/lib/liquidity/aquarius.ts` — Soroban RPC + Aquarius API            |
| **DEX liquidity — StellarX**   | **NEW**  | `src/lib/liquidity/stellarx.ts` — Horizon order-book endpoint           |
| **Stellar wallet + SEP-0010**  | **NEW**  | `@creit-tech/stellar-wallets-kit` + `StellarWalletContext`              |
| **`chainFamily` store field**  | **NEW**  | `src/stores/walletStore.ts`                                             |
| **Bridge — Allbridge Core**    | **NEW**  | `src/lib/execution/bridge/allbridge.ts` — Allbridge Core SDK            |
| **Bridge — Squid / Axelar**    | **NEW**  | `src/lib/execution/bridge/squid.ts` — Squid Router API (Axelar GMP)     |
| **Bridge — Circle CCTP**       | **NEW**  | `src/lib/execution/bridge/cctp.ts` — native USDC burn-and-mint          |
| **On-ramp — MoneyGram/SEP-24** | **NEW**  | `src/lib/execution/onramp.ts` — MoneyGram Ramps + SEP-0024 anchors      |
