# LendWise — Protocol Processing Flow & Blend Integration

> **Legend** — <span style="color:#16a34a">green = NEW bricks added for Stellar/Blend</span> ·
> blue = existing EVM pipeline (unchanged) · grey = shared core (unchanged).

---

## 1. Data processing flow — current EVM protocols + Blend addition

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
        SorobanRPC[("Soroban RPC<br/>simulateTransaction<br/>Blend pool contracts")]
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
  rates and user positions from **Soroban contracts** through the **Blend SDK** over **Soroban RPC**
  (`simulateTransaction`), then hands normalized `SupplyProduct`/`BorrowProduct` objects to the
  same pipeline.
- Adding Blend = register `'blend'` in `PROTOCOL_REGISTRY` + ship the green bricks. Nothing in the
  blue/grey path changes.

---

## 2. Wallet layer — multi-ecosystem coexistence

```mermaid
flowchart LR
    subgraph Providers["App providers (parallel)"]
        Wagmi["WagmiProvider + RainbowKit<br/>EVM — existing"]
        StellarKit["StellarWalletContext<br/>@creit-tech/stellar-wallets-kit<br/>Freighter / xBull — NEW"]
    end

    Wagmi -->|"0x… address (viem)"| Store["Zustand walletStore<br/>chainFamily: 'evm' | 'stellar'"]
    StellarKit -->|"G… / C… public key"| Store
    Store --> Dashboard["Unified dashboard<br/>EVM + Stellar positions"]

    classDef core fill:#e5e7eb,stroke:#6b7280,color:#111827;
    classDef evm fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef stellar fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
    class Store,Dashboard core;
    class Wagmi evm;
    class StellarKit stellar;
```

**New bricks (green):** `@creit-tech/stellar-wallets-kit` + a `StellarWalletContext` running
**alongside** `WagmiProvider`, feeding the existing Zustand `walletStore` once it carries a
`chainFamily` discriminator. EVM wallet flow is untouched.

---

## 3. New vs existing — at a glance

| Brick                         | Status   | Library / path                                                          |
| :---------------------------- | :------- | :---------------------------------------------------------------------- |
| Adapter registry              | existing | `PROTOCOL_REGISTRY` — `src/config/protocols.ts`                         |
| Spot collection               | existing | `collectApySpot()` — `apy-snapshots.actions.ts`                         |
| EVM data source               | existing | The Graph subgraphs via `shared/graphql-client.ts` (URQL)               |
| `apy_hourly` / `apy_daily`    | existing | `repositories/apy.ts` + Drizzle schema                                  |
| GraphQL serving               | existing | `graphql-yoga` `/api/graphql`                                           |
| **Blend adapter**             | **NEW**  | `src/lib/protocols/blend/`                                              |
| **Blend data source**         | **NEW**  | `@blend-capital/blend-sdk-js` + `@stellar/stellar-sdk` over Soroban RPC |
| **Stellar wallet**            | **NEW**  | `@creit-tech/stellar-wallets-kit` + `StellarWalletContext`              |
| **`chainFamily` store field** | **NEW**  | `src/stores/walletStore.ts`                                             |
