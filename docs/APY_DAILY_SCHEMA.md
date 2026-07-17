# `apy_daily` Table — Schema Reference

> **Storage note:** the live schema is the `apy_daily` PostgreSQL table defined in
> `src/lib/db/schema.ts` (Drizzle). This document describes field-level semantics,
> which carry over from the former MongoDB collection; column names are snake_case
> (`apy_net`, `quality_completeness`, …) and primary key is `(product_id, date)`.

`apy_daily` stores daily aggregations computed from `apy_hourly`. It is the primary source for all UI queries and the optimization engine for investment horizons beyond 7 days.

All monetary values are in **USD**. All rates are in **APY**.

---

## Core Rules

### 1. Classic collection — not Time Series

`apy.daily` requires upserts for idempotency, which MongoDB Time Series does not support. The collection job can safely rerun on the same day and will overwrite the existing document.

```js
db.createCollection('apy.daily')
```

### 2. Upsert on (productId, date) — idempotent by design

```js
await db.collection('apy.daily').updateOne(
  {
    productId: 'aave-AaveV3Ethereum-usdc-supply',
    date: new Date('2025-03-12'),
  },
  { $set: { ...document }, $inc: { revision: 1 } },
  { upsert: true }
)
```

Each rerun increments `revision`. If spot data was incomplete earlier (gap in `apy.spot`) and is later backfilled, the daily job can be replayed to produce a corrected document.

### 3. Job runs at 00:10 UTC — explicit window

The daily job queries the explicit window `[D-1 00:00:00Z, D 00:00:00Z[` — never relative to `now()`. This makes it safe to retry at any hour without recomputing the wrong day.

### 4. Two-pass aggregation from `apy.spot`

APY fields and `utilizationRate` use the **daily average** — a single outlier slot does not distort the day's value.
Volume fields (`supplyAssetsUsd`, `borrowAssetsUsd`) use the **last known value** of the day — they are stocks, not flows, and closing value is more comparable across days.

### 5. `apy` stores full statistical distribution, not just the average

A pool with avg 5% APY oscillating between 1% and 9% is not the same risk as a stable pool at 5%. The distribution fields (`min`, `max`, `p25`, `p75`, `stdDev`) enable the optimization engine to factor in APY volatility for long-term investment decisions.

### 6. Reward breakdown is aggregated — no per-token detail

Unlike `apy.spot`, the daily document stores only the total reward APY (`apy.rewards.avg`), not the individual `rewardItems`. Per-token detail can be reconstructed from spot if needed.

### 7. Data quality reflects completeness of source spots

The `quality.completeness` field is the ratio of spot documents found vs expected (144 slots per day). A daily document with `completeness < 0.5` should be treated as unreliable by the optimization engine.

---

## TypeScript Types

```typescript
import type { ProtocolName } from './pools'

// ─── Statistical distribution ─────────────────────────────────────────────────

export interface Distribution {
  avg: number // arithmetic mean across all slots
  min: number // lowest value observed
  max: number // highest value observed
  p25: number // 25th percentile — tendency toward lower end
  p75: number // 75th percentile — tendency toward higher end
  stdDev: number // standard deviation — measure of volatility
}

// ─── APY daily aggregation ───────────────────────────────────────────────────

export interface DailyApyBreakdown {
  /**
   * Full statistical distribution of the base APY across all spot slots.
   * Use avg for comparisons, stdDev for volatility scoring.
   */
  base: Distribution

  /**
   * Full statistical distribution of the net APY across all spot slots.
   * Primary field for the optimization engine and UI comparisons.
   */
  net: Distribution

  /**
   * Average reward APY across the day.
   * = average of sum(rewardItems[].apy) per slot
   * Single value — per-token breakdown not stored at daily granularity.
   */
  rewards: number

  /**
   * Average protocol fee APY across the day.
   */
  fees: number
}

// ─── Market daily state ───────────────────────────────────────────────────────

export interface DailyMarketState {
  /**
   * Closing value — last spot of the day (23:50 slot).
   * Stocks should be read at closing, not averaged.
   */
  supplyAssetsUsd: number
  borrowAssetsUsd: number
  /**
   * Average across all spot slots — ratios and rates are averaged.
   */
  utilizationRate: Distribution
  assetPriceUsd: Distribution
}

// ─── Data quality ─────────────────────────────────────────────────────────────

export interface DailyQuality {
  /**
   * Number of spot documents found in the [D-1 00:00Z, D 00:00Z[ window.
   * Expected: 144 (6 slots/hour × 24 hours).
   */
  actualCount: number

  /**
   * actualCount / 144 — 0 to 1.
   * < 0.5  → treat as unreliable, exclude from optimization engine
   * < 1.0  → partial day, averages may be slightly biased
   * = 1.0  → complete day
   */
  completeness: number

  /**
   * "complete" — all 144 slots present
   * "partial"  — some slots missing but above 0.5 threshold
   * "missing"  — below 0.5 threshold — document written but flagged unreliable
   */
  status: 'complete' | 'partial' | 'missing'

  /**
   * Incremented each time this daily document is recomputed.
   * > 1 indicates the document was replayed (manual backfill or spot gap recovery).
   */
  revision: number

  /**
   * Timestamp when the aggregation job ran.
   */
  computedAt: Date
}

// ─── Daily document ───────────────────────────────────────────────────────────

export interface ApyDaily {
  /**
   * The day this document covers — midnight UTC of D-1.
   * Example: document for 2025-03-12 → date = 2025-03-12T00:00:00.000Z
   * Part of the compound upsert key: (productId, date).
   */
  date: Date

  /**
   * Foreign key → pools._id
   * Part of the compound upsert key: (productId, date).
   */
  productId: string

  /**
   * Denormalized from pools for query efficiency — same fields as apy.spot.meta.
   */
  meta: {
    kind: 'supply' | 'borrow'
    protocol: ProtocolName
    chain: {
      id: number
      name: string
    }
    asset: string // loan asset symbol — "USDC", "WETH"…
  }

  /**
   * APY aggregations across all spot slots of the day.
   */
  apy: DailyApyBreakdown

  /**
   * Market state — closing values for volumes, daily averages for rates.
   */
  market: DailyMarketState

  /**
   * Data quality indicators — populated by the daily aggregation job.
   */
  quality: DailyQuality
}
```

---

## Aggregation Pipeline Reference

```js
const windowStart = DateTime.utc().minus({ days: 1 }).startOf('day').toJSDate()
const windowEnd = DateTime.utc().startOf('day').toJSDate()

// ─── Pass 1 — statistical aggregation ────────────────────────────────────────
const [stats] = await db
  .collection('apy.spot')
  .aggregate([
    {
      $match: {
        'meta.productId': productId,
        timestamp: { $gte: windowStart, $lt: windowEnd },
      },
    },
    {
      $group: {
        _id: null,
        actualCount: { $sum: 1 },

        // base APY distribution
        baseAvg: { $avg: '$apy.base' },
        baseMin: { $min: '$apy.base' },
        baseMax: { $max: '$apy.base' },
        baseStdDev: { $stdDevPop: '$apy.base' },
        baseP25: {
          $percentile: { input: '$apy.base', p: [0.25], method: 'approximate' },
        },
        baseP75: {
          $percentile: { input: '$apy.base', p: [0.75], method: 'approximate' },
        },

        // net APY distribution
        netAvg: { $avg: '$apy.net' },
        netMin: { $min: '$apy.net' },
        netMax: { $max: '$apy.net' },
        netStdDev: { $stdDevPop: '$apy.net' },
        netP25: {
          $percentile: { input: '$apy.net', p: [0.25], method: 'approximate' },
        },
        netP75: {
          $percentile: { input: '$apy.net', p: [0.75], method: 'approximate' },
        },

        // scalar aggregates
        rewardsAvg: { $avg: '$apy.rewards' },
        feesAvg: { $avg: '$apy.fees' },
        utilizationAvg: { $avg: '$market.utilizationRate' },
        utilizationMin: { $min: '$market.utilizationRate' },
        utilizationMax: { $max: '$market.utilizationRate' },
        utilizationStdDev: { $stdDevPop: '$market.utilizationRate' },
        utilizationP25: {
          $percentile: {
            input: '$market.utilizationRate',
            p: [0.25],
            method: 'approximate',
          },
        },
        utilizationP75: {
          $percentile: {
            input: '$market.utilizationRate',
            p: [0.75],
            method: 'approximate',
          },
        },
        priceAvg: { $avg: '$market.assetPriceUsd' },
        priceMin: { $min: '$market.assetPriceUsd' },
        priceMax: { $max: '$market.assetPriceUsd' },
        priceStdDev: { $stdDevPop: '$market.assetPriceUsd' },
      },
    },
  ])
  .toArray()

// ─── Pass 2 — closing values (last slot of the day) ───────────────────────────
const [closing] = await db
  .collection('apy.spot')
  .aggregate([
    {
      $match: {
        'meta.productId': productId,
        timestamp: { $gte: windowStart, $lt: windowEnd },
      },
    },
    { $sort: { timestamp: -1 } },
    { $limit: 1 },
    {
      $project: {
        supplyAssetsUsd: '$market.supplyAssetsUsd',
        borrowAssetsUsd: '$market.borrowAssetsUsd',
      },
    },
  ])
  .toArray()
```

---

## Recommended MongoDB Indexes

```js
// Primary — lookup a pool's daily history
db['apy.daily'].createIndex({ productId: 1, date: -1 }, { unique: true })

// UI query — "all supply pools for USDC over last 90 days"
db['apy.daily'].createIndex({
  'meta.asset': 1,
  'meta.kind': 1,
  'meta.chain.id': 1,
  date: -1,
})

// Optimization engine — cross-protocol comparison for a given asset
db['apy.daily'].createIndex({ 'meta.protocol': 1, 'meta.asset': 1, date: -1 })

// Filter unreliable daily documents
db['apy.daily'].createIndex({ 'quality.status': 1, date: -1 })
```

---

## Document Example — AAVE USDC supply

```json
{
  "date": "2025-03-12T00:00:00.000Z",
  "productId": "aave-AaveV3Ethereum-usdc-supply",

  "meta": {
    "kind": "supply",
    "protocol": "aave",
    "chain": { "id": 1, "name": "ethereum" },
    "asset": "USDC"
  },

  "apy": {
    "base": {
      "avg": 0.0421,
      "min": 0.0389,
      "max": 0.0458,
      "p25": 0.0408,
      "p75": 0.044,
      "stdDev": 0.0018
    },
    "net": {
      "avg": 0.0498,
      "min": 0.0461,
      "max": 0.0537,
      "p25": 0.0482,
      "p75": 0.0515,
      "stdDev": 0.0019
    },
    "rewards": 0.0077,
    "fees": 0.0
  },

  "market": {
    "supplyAssetsUsd": 45200000,
    "borrowAssetsUsd": 32100000,
    "utilizationRate": {
      "avg": 0.71,
      "min": 0.692,
      "max": 0.731,
      "p25": 0.703,
      "p75": 0.721,
      "stdDev": 0.009
    },
    "assetPriceUsd": {
      "avg": 1.0001,
      "min": 0.9998,
      "max": 1.0004,
      "p25": 1.0,
      "p75": 1.0002,
      "stdDev": 0.0002
    }
  },

  "quality": {
    "actualCount": 142,
    "completeness": 0.986,
    "status": "partial",
    "revision": 1,
    "computedAt": "2025-03-13T00:10:03.421Z"
  }
}
```
