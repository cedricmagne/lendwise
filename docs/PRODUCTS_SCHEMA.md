# `products` Table — Schema Reference

> **Storage note:** the live schema is the `products` PostgreSQL table defined in
> `src/lib/db/schema.ts` (Drizzle). This document describes field-level semantics,
> which carry over from the former MongoDB collection; structured fields are typed
> columns (`provider`, `chain_id`, `asset_symbol`, `kind`, …) and `meta` /
> `collaterals` are `jsonb`. Filter on the columns — never parse the `id` slug.

`products` is a **static registry** of all supply and borrow products across AAVE, Morpho, and Compound. It holds metadata only — no time-varying metrics. All APY, TVL, and rate data lives in `apy_hourly` and `apy_daily`.

---

## Core Rules

### 1. One document per side

A single on-chain market always generates **two pool documents** — one with `kind: "supply"` and one with `kind: "borrow"`. This is true even for AAVE reserves, where both sides share the same `native.id`. Splitting by `kind` keeps all GraphQL resolvers and aggregation queries uniform across protocols.

### 2. `_id` is a deterministic slug

The `_id` is built at collection time, never auto-generated. Format:

```
{protocol.name}-{protocol.market}-{asset.symbol}-{kind}
```

For Morpho Blue borrow pools, the collateral symbol is appended:

```
morpho-MorphoBlueEthereum-usdc-weth-borrow
```

This makes pool lookups predictable from the job layer without a prior query.

### 3. `protocol.market` is verbatim from the subgraph

Never normalize or transform the market name returned by the protocol's GraphQL API. Store it as-is (`"AaveV3EthereumLido"`, `"MorphoBlueEthereum"`…). This way new protocol deployments are picked up automatically by the collection job without any schema change.

### 4. `SupplyProduct` and `BorrowProduct` are distinct types

The TypeScript model uses a **discriminated union** on `kind`. `collaterals` only exists on `BorrowProduct` — it is entirely absent from `SupplyProduct`, not set to `[]`. This eliminates a class of runtime bugs where supply-side code accidentally accesses collateral data.

- `BorrowProduct.collaterals` is always a non-empty array — one element on Morpho Blue (fixed at market creation), N elements on AAVE / Compound built dynamically from reserves where `supplyInfo.canBeCollateral === true`
- `protocolMeta` is also narrowed per side — `ProtocolMetaMorphoBlue` only appears on borrow, `ProtocolMetaMetaMorpho` only on supply

The collateral **does not influence borrow APY** on AAVE or Compound (same rate regardless of what you deposit). It does influence APY on Morpho Blue since each `(loanToken, collateralToken, lltv)` tuple is a distinct market with its own liquidity.

### 5. `protocolMeta` contains only stable IRM parameters

Only fields that are **fixed by governance** and do not change over time belong in `protocolMeta`. Variable metrics (current APY, utilization rate, TVL) are never stored here — they belong exclusively in `apy.spot` and `apy.daily`.

### 6. `collaterals` must be refreshed on governance changes

Unlike most fields in `pools`, the collateral list can be updated via on-chain governance (new asset added, LTV modified). The collection job must detect changes and update `collaterals` accordingly, bumping `updatedAt`.

---

## `_id` Construction Reference

| Protocol    | Kind   | Pattern                                       | Example                                            |
| ----------- | ------ | --------------------------------------------- | -------------------------------------------------- |
| AAVE        | supply | `aave-{market}-{asset}-supply`                | `aave-AaveV3Ethereum-usdc-supply`                  |
| AAVE        | borrow | `aave-{market}-{asset}-borrow`                | `aave-AaveV3EthereumLido-wsteth-borrow`            |
| Morpho Blue | supply | `morpho-{market}-{asset}-supply`              | `morpho-MorphoBlueEthereum-usdc-supply`            |
| Morpho Blue | borrow | `morpho-{market}-{asset}-{collateral}-borrow` | `morpho-MorphoBlueEthereum-usdc-weth-borrow`       |
| MetaMorpho  | supply | `morpho-{market}-{asset}-{curators}-supply`   | `morpho-MetaMorphoEthereum-usdc-steakhouse-supply` |
| Compound    | supply | `compound-{market}-{asset}-supply`            | `compound-CompoundV3Ethereum-usdc-supply`          |
| Compound    | borrow | `compound-{market}-{asset}-borrow`            | `compound-CompoundV3Ethereum-usdc-borrow`          |

---

## Recommended MongoDB Indexes

```js
// Primary access pattern — filter by protocol, asset, kind
db.pools.createIndex({ 'protocol.name': 1, 'asset.symbol': 1, kind: 1 })

// Lookup by native ID (used by the collection job on upsert)
db.pools.createIndex({ 'native.id': 1, 'protocol.name': 1 }, { unique: true })

// Active pools by chain
db.pools.createIndex({ active: 1, 'protocol.chain.id': 1 })
```
