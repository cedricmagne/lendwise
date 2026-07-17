# APY Pipeline — Gap Detection & Healing

> Complete documentation of the data quality assurance process for the hourly APY pipeline.
>
> **Storage note:** the live store is PostgreSQL (Neon) — tables `apy_hourly`, `apy_daily`,
> `pipeline_reports` in `src/lib/db/schema.ts` (Drizzle). This document predates the
> MongoDB → Postgres migration; collection names like `apy.hourly` map to the tables above,
> and the semantics carry over unchanged.

---

## 1. Overview

The APY pipeline collects live protocol data every **10 minutes** and aggregates it into **hourly slots** stored in the `apy.hourly` MongoDB collection. Each hourly slot should contain **6 spot samples** (one per 10-minute interval) to be considered complete.

Two scheduled jobs run sequentially to detect and repair data gaps:

| Job               | Route                      | Schedule            | Trigger |
| ----------------- | -------------------------- | ------------------- | ------- |
| **Gap Detection** | `POST /api/yield/apy/gaps` | Daily at 01:00 UTC  | QStash  |
| **Gap Healing**   | `POST /api/yield/apy/heal` | After gap detection | QStash  |

Both endpoints are protected by **Upstash QStash signature verification** in production. In development (`NODE_ENV=development`), the handlers are exported directly to allow local invocation via `curl`.

---

## 2. Data Model Primer

### Hourly Slot (`apy.hourly`)

```
_id:         "{productId}:{YYYY-MM-DDTHH}"   // deterministic composite key
hour:        Date                              // UTC hour boundary (top of hour)
productId:   string                            // e.g. "aave:v3:ethereum:reserve:0x…:supply"
apy:         { base, reward, net }             // APY breakdown
market:      { totalSupply, totalBorrow, … }   // market state snapshot
quality: {
  count:         number     // spots collected (0–6)
  expectedCount: 6          // always 6
  firstSlot:     Date       // first contributing spot timestamp
  lastSlot:      Date       // last contributing spot timestamp
  status:        'building' | 'complete' | 'partial'
}
healed:      boolean        // true if repaired by the heal job
healSource:  'refetch' | 'nearest-neighbor'
healedFrom:  string         // ISO timestamp of the source data point
```

### Quality Status Lifecycle

```
 building ──(count reaches 6)──→ complete
    │
    └──(hour passes, count < 6)──→ partial  (set by gap detection, rule R3)
```

### Product (`products`)

Each product has a `createdAt` timestamp recording when it was first indexed. This date is critical for gap detection (see §3.3).

---

## 3. Gap Detection (`/api/yield/apy/gaps`)

### 3.1 Purpose

Scan the last **7 days** (168 hours, configurable up to 14 days) of `apy.hourly` and identify:

- **Missing slots** — no document exists for a `(productId, hour)` pair.
- **Incomplete slots** — document exists but `quality.count < 6`.

### 3.2 Algorithm

```
1. Compute window: [now - lookbackHours, now)  (hour-aligned)
2. Fetch all active products with their createdAt dates.
3. Query all existing hourly docs in the window (productId, hour, quality, healed).
4. Partition products into:
   - "collected" — have ≥1 hourly doc in the window
   - "never-indexed" — active but zero docs (reported separately, not counted as gaps)
5. For each (hour × collected product):
   a. Skip if hour < product.createdAt          → §3.3
   b. No doc exists         → flag as MISSING
   c. Doc exists, count < 6 AND not healed → flag as INCOMPLETE
   d. Doc exists, count < 6 AND healed     → skip (already best-effort)
   e. Doc exists, count ≥ 6                → OK
6. R3: Mark stale docs (status='building', count < 6, past hours) → status='partial'
7. Persist full report to pipeline.reports (type: 'gap-detection').
```

### 3.3 Product Creation Date Filter

**Problem solved:** Without filtering, gap detection would flag slots for hours _before_ a product existed on-chain (e.g., a new AAVE reserve listed on April 8 would generate ~144 false-positive gaps for April 2–7).

**Rule:** For each product, gap detection skips all hours strictly before `product.createdAt` (floored to the hour boundary). This eliminates thousands of false positives for recently added products.

### 3.4 Healed Slot Exclusion

**Problem solved:** Slots healed by nearest-neighbor interpolation retain `count: 0` (since the data is interpolated, not organically collected). Without exclusion, these would be re-flagged as incomplete on every gap detection run, creating an infinite healing loop.

**Rule:** Slots with `healed: true` are excluded from the incomplete report regardless of their `quality.count`. The healing job has already done the best it can for these slots.

### 3.5 Output

The gap detection report is persisted in `pipeline.reports` with the full list of gaps and incomplete entries. This report is consumed by the heal job. The HTTP response returns a capped summary (max 50 items per category).

Key metrics:

- `collected.expectedSlots` — `collectedProducts × hours`
- `collected.missingSlots` — slots with no document
- `collected.incompleteSlots` — slots with `count < 6` (excluding healed)
- `neverIndexedCount` — products with zero data in the window
- `markedStale` — docs transitioned from `building` → `partial` (R3)

---

## 4. Gap Healing (`/api/yield/apy/heal`)

### 4.1 Purpose

Attempt to fill every gap and incomplete slot reported by the most recent gap detection run, using the best available data source.

### 4.2 Healing Strategy (Priority Order)

#### Priority 1: Authoritative Re-fetch

For protocols that expose historical APIs, the heal job fetches the actual on-chain data for the gap period:

| Protocol                       | API                  | Window                      | Granularity        |
| ------------------------------ | -------------------- | --------------------------- | ------------------ |
| **Morpho** (Blue + MetaMorpho) | Morpho GraphQL API   | Custom start/end timestamps | `HOUR` interval    |
| **AAVE** (v3, all chains)      | AAVE v3 offchain API | `LAST_WEEK` (168 hours)     | Hourly data points |

The fetched data is normalized into `HistoryDataPoint` objects and stored in a unified lookup map keyed by `{productId}:{YYYY-MM-DDTHH}`.

**Quality for refetched data:** `count: 6, status: 'complete'` — treated as authoritative.

#### Priority 2: Nearest-Neighbor Interpolation

For gaps not covered by the re-fetch (Compound, or Morpho/AAVE gaps outside the API window), the heal job:

1. Queries existing hourly docs in a padded window (`±6 hours` around the gap boundaries).
2. For each unfilled gap, finds the **temporally closest** existing doc for the same `productId`.
3. Copies `apy` and `market` from the donor doc.

**Quality for interpolated data:** `count: 0, status: 'partial'` — reflects that this is an estimate, not organic data.

### 4.3 Write Semantics

| Gap Kind       | MongoDB Operation                                | Behavior                                                                                                                |
| -------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Missing**    | `updateOne` with `$setOnInsert` + `upsert: true` | Creates the doc only if it doesn't exist. Never overwrites organic data that arrived between gap detection and healing. |
| **Incomplete** | `updateOne` with `$set`                          | Overwrites the existing poor-quality doc with better data.                                                              |

All healed documents carry traceability fields:

- `healed: true`
- `healSource: 'refetch' | 'nearest-neighbor'`
- `healedFrom: '<ISO timestamp of source data>'`

### 4.4 Bulk Write Execution

Operations are batched in **chunks of 1,000** to avoid oversized MongoDB payloads. Each chunk is executed with `ordered: false` for maximum throughput.

Metrics tracked:

- `healed` = `upsertedCount` + `modifiedCount` (new inserts + updated incompletes)
- `alreadyExists` = `matchedCount` - `modifiedCount` (organic data arrived in the meantime)

### 4.5 Output

The heal result is persisted in `pipeline.reports` (type: `gap-healing`) and includes:

- `healedByRefetch` — slots filled with authoritative historical data
- `healedByNeighbor` — slots filled by interpolation
- `noDonor` — slots for which no data source was available
- `breakdown` — per-protocol breakdown (morpho, aave, compound)
- `noDonorSample` — sample of unfillable gaps for investigation

---

## 5. Data Integrity Principles

### 5.1 Organic Data Is Sacred

The `$setOnInsert` pattern for missing slots guarantees that if organic data arrives between gap detection and healing, it is **never overwritten** by healed data. This prevents the heal job from degrading data quality.

### 5.2 Traceability

Every healed document is tagged with `healed: true`, the source type, and the exact timestamp of the donor data. This allows:

- The status page to visually distinguish organic vs. healed data.
- Gap detection to skip already-healed slots.
- Audit and investigation of data quality.

### 5.3 Temporal Consistency

- **Product creation date filtering** prevents reporting gaps for periods before a product existed.
- **Hour boundary standardization** (`setUTCMinutes(0, 0, 0)`) ensures all timestamps align to the top of the hour, preventing off-by-one mismatches in lookups.
- **Deterministic document IDs** (`{productId}:{YYYY-MM-DDTHH}`) make upserts idempotent.

### 5.4 Authoritative Sources First

The two-phase healing strategy ensures that protocol-native historical data (from Morpho and AAVE APIs) is always preferred over nearest-neighbor interpolation. The interpolation fallback is a last resort — it preserves chart continuity but signals reduced confidence via `count: 0`.

### 5.5 No Infinite Loops

The `healed` flag breaks the detection→healing cycle:

1. Gap detection flags a slot as incomplete.
2. Heal job fills it (refetch or nearest-neighbor), sets `healed: true`.
3. Next gap detection sees `healed: true` → **skips it**.

Without this mechanism, slots healed by nearest-neighbor (which retain `count: 0`) would be re-flagged indefinitely.

### 5.6 Graceful Degradation

- If a protocol API is down, only that protocol's re-fetch fails; others proceed normally.
- Errors are collected but don't abort the job — partial healing is better than none.
- The `noDonor` metric tracks unfillable gaps for monitoring.

---

## 6. Monitoring (Status Page)

The `/status` page provides a visual heatmap of data quality per protocol:

| Color             | Meaning                                       |
| ----------------- | --------------------------------------------- |
| 🟢 Green (bright) | Complete — ≥95% products have 6/6 spots       |
| 🟢 Green (faded)  | Healed — data restored, marked `healed: true` |
| 🟡 Amber          | Partial — avg 4–5 spots per product           |
| 🟠 Orange         | Sparse — avg 1–3 spots per product            |
| 🔴 Red            | Missing — no data for this slot               |
| 🔵 Blue ring      | Contains at least one healed document         |

The tooltip shows per-slot detail:

- **Status** — Complete / Healed / Partial / Sparse / Missing
- **Avg. spots** — average `quality.count` across products (capped at 6)
- **Products** — `collected / expected` (expected accounts for product creation dates)
- **Healed** — whether any product in this slot was healed

---

## 7. Supported Protocols

| Protocol    | Re-fetch Source                             | Chains                                                             |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------ |
| AAVE v3     | AAVE offchain GraphQL API (`LAST_WEEK`)     | Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, BSC |
| Morpho Blue | Morpho public API (`HOUR` interval)         | Ethereum                                                           |
| MetaMorpho  | Morpho public API (`HOUR` interval)         | Ethereum                                                           |
| Compound v3 | _No historical API_ — nearest-neighbor only | Ethereum                                                           |

---

## 8. Local Development

Both jobs can be invoked locally without QStash signature verification:

```bash
# Run gap detection
curl -s -X POST http://localhost:3000/api/yield/apy/gaps | jq .

# Run healing (uses latest gap report)
curl -s -X POST http://localhost:3000/api/yield/apy/heal | jq .

# Run healing on a specific report
curl -s -X POST http://localhost:3000/api/yield/apy/heal \
  -H 'Content-Type: application/json' \
  -d '{"reportId": "abc123..."}' | jq .

# Custom lookback window (hours)
curl -s -X POST http://localhost:3000/api/yield/apy/gaps \
  -H 'Content-Type: application/json' \
  -d '{"hours": 48}' | jq .
```

The dev bypass is controlled by:

```typescript
export const POST =
  process.env.NODE_ENV === 'development'
    ? handler
    : verifySignatureAppRouter(handler)
```

---

## 9. File Reference

| File                                         | Role                                                         |
| -------------------------------------------- | ------------------------------------------------------------ |
| `src/app/api/yield/apy/gaps/route.ts`        | Gap detection endpoint                                       |
| `src/app/api/yield/apy/heal/route.ts`        | Gap healing endpoint                                         |
| `src/app/api/status/quality/route.ts`        | Quality API for the status page                              |
| `src/app/status/page.tsx`                    | Status page UI (heatmap)                                     |
| `src/lib/protocols/aave/v3/apy-history.ts`   | AAVE historical data fetcher                                 |
| `src/lib/protocols/morpho/v1/apy-history.ts` | Morpho historical data fetcher                               |
| `src/lib/db/types.ts`                        | MongoDB document types (`ApySlot`, `SlotQuality`, `Product`) |
