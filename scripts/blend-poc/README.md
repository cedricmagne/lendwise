# LendWise × Blend — Live Mainnet Read PoC

Proof of concept supporting the LendWise SCF Build submission. It demonstrates the core
**"new green brick"** from the [technical architecture](../../docs/architecture-stellar-integration.md):
reading **live Blend lending rates straight from Soroban** — no subgraph, no GraphQL, no API key —
and normalizing them into the exact row shape LendWise upserts into `apy_hourly`.

## Run

```bash
cd scripts/blend-poc
npm install
npm start
```

Runs against **Stellar mainnet** with a public Soroban RPC. No credentials required.
Completes in **a few seconds** and hard-asserts a **3-minute budget** (exits non-zero if exceeded).

## What it proves (end to end)

1. **Connect** to a public Soroban RPC with no credentials.
2. **Discover** live pools on-chain via the Blend Backstop reward zone — _no hard-coded pool address_.
3. **Load** each pool's reserves with `@blend-capital/blend-sdk` (`PoolV2.load`).
4. **Read** on-chain supply/borrow APR and **normalize** APR → APY with LendWise's canonical
   formula `(1 + APR/365)^365 − 1`, then **cross-check** against the SDK's own compounded estimate
   (delta is near-zero on active reserves — confirming correctness).
5. **Emit** normalized `SupplyProduct` / `BorrowProduct` rows — the precise payload that feeds the
   existing LendWise pipeline.

## Sample output

```
■ Pool "Fixed" (CAJJ…BXBD) — 3 reserves
   CAS3…OWMA  supply   0.0002%  borrow   0.1022%  util  0.2869%
   CCW6…MI75  supply   6.9887%  borrow  12.8342%  util 69.9264%
   CDTK…BQLV  supply   6.6198%  borrow  11.2470%  util 75.1711%

Normalized rows ready for apy_hourly upsert: 48
Max |LendWise APY − SDK estimate| across 16 healthy reserves: 0.0040%
⏱  Completed in 0.9s (budget 180s)
✓ PoC passed
```

## Config (optional env overrides)

| Env                | Default                                          | Meaning                             |
| :----------------- | :----------------------------------------------- | :---------------------------------- |
| `BLEND_RPC`        | `https://mainnet.sorobanrpc.com`                 | Soroban RPC endpoint                |
| `BLEND_PASSPHRASE` | `Public Global Stellar Network ; September 2015` | network passphrase                  |
| `BLEND_BACKSTOP`   | `CAQQ…3IM7`                                      | Blend v2 mainnet Backstop contract  |
| `MAX_POOLS`        | `5`                                              | number of reward-zone pools to read |

## Mapping to the production pipeline

| PoC step                      | Production equivalent                                           |
| :---------------------------- | :-------------------------------------------------------------- |
| `Backstop.load` + reward zone | pool discovery in `src/lib/protocols/blend/config.ts`           |
| `PoolV2.load` + reserve read  | `src/lib/protocols/blend/services/blend-api.ts`                 |
| `aprToApy` + row shaping      | adapter `getAccountPositions` → `SupplyProduct`/`BorrowProduct` |
| printed rows                  | `repositories/apy.ts` upsert into `apy_hourly`                  |
