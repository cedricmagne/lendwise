# APY Outlier Display Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep all finite protocol APY observations in the ingestion pipeline while automatically hiding pools with persistently unrealistic APY from the public supply and borrow comparison interfaces.

**Architecture:** Ingestion and pipeline health measure transport and storage completeness only; a high but finite APY is stored and contributes to the hourly `6/6` quality count. `products.active` remains the present-tense catalogue state, while `product_availability_periods` retains every active interval so a pool is expected for an hour exactly when one of its periods covers `activated_at <= hour < deactivated_at` (or has no end). A separate `product_rate_flags` projection stores the current display-eligibility state. An hourly QStash job evaluates recent completed hourly APY rows and sets or clears the `outlier_apy` flag with hysteresis. `/supply`, `/borrow`, and public GraphQL APY lists exclude flagged products before sorting and pagination, with an additional immediate filter based on the latest APY while the hourly projection catches up.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, PostgreSQL/Neon, Drizzle ORM + drizzle-kit, graphql-yoga, Vitest, QStash.

## Global Constraints

- Do not parse `product_id`; join through typed `products` columns and exact IDs only.
- Do not alter the semantics of `products.active`: a display outlier remains an active, collected product.
- `products.active` is the current catalogue state only. Historical pipeline quality and gap detection must determine whether a product was expected from an `EXISTS` match in `product_availability_periods`, never from its current `active` value alone.
- A product deactivated at time `T` must remain visible in historical quality for hours before `T`, must stop being expected at and after `T`, and must never create a missing/incomplete alert merely because it was correctly delisted.
- Pipeline quality remains based on rows and `quality_count`; `outlier_apy` must not create gaps, incomplete slots, or a degraded `/status` heatmap.
- Keep all finite APY components (`base`, `rewards`, `fees`, `net`) from live and historical Morpho sources; reject only non-finite numeric data (`NaN`, `Infinity`, `-Infinity`).
- Initial display-outlier threshold: `abs(apy_net) > 100` (100 equals 10,000% in the stored decimal representation), for both supply and borrow. Put this in one named configuration module; do not duplicate literal thresholds.
- Flag after the latest 3 completed hourly rows are all outliers. Clear only after the latest 12 completed hourly rows are all non-outliers.
- A row is eligible for the hourly decision only when `quality_count >= 6`. Healed rows are allowed as evidence: display eligibility is about the protocol rate, not organic collection provenance.
- Exclude outliers in server-side data retrieval before ordering, counting, and pagination. Client-only filtering is insufficient because an outlier would still distort sort order and pagination.
- The immediate page-level guard uses the latest stored hourly `apy_net`; it is only a short-term safety net and does not write flags.
- Preserve the user’s unrelated worktree changes. Do not change APY calculation formulas, product ID generation, chain grouping, or the gap/heal algorithm beyond removing the display ceiling from ingestion.

---

## File Structure

| File                                                                                                                            | Responsibility                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/apy-display-policy.ts`                                                                                                 | Pure, shared display threshold and hysteresis predicates; no database or Next.js imports.                                |
| `src/lib/apy-validation.ts`                                                                                                     | Pure finite-number guard used by ingestion; deliberately has no display ceiling.                                         |
| `src/lib/db/schema.ts`                                                                                                          | Declares `product_availability_periods`, the dynamic `product_rate_flags` table, and indexes.                            |
| `drizzle/0001_<generated>.sql`, `drizzle/0002_<generated>.sql`, `drizzle/meta/*`                                                | Generated availability-period and flags migrations with their metadata. Never hand-write a generated migration name.     |
| `src/lib/db/repositories/products.ts`                                                                                           | Performs interval-aware activation, reactivation, and deactivation during a completed provider sync.                     |
| `src/app/actions/products-sync.actions.ts`                                                                                      | Passes each successfully enumerated provider’s fetched IDs to interval-aware catalogue reconciliation.                   |
| `src/lib/protocols/aave/v3/products.ts`, `src/lib/protocols/morpho/v1/products.ts`, `src/lib/protocols/compound/v3/products.ts` | Propagates incomplete catalogue enumeration as a failure, so it cannot deactivate a provider’s products.                 |
| `src/lib/db/repositories/gaps.ts`                                                                                               | Uses the activity interval for missing and incomplete gap candidates.                                                    |
| `src/app/api/status/quality/route.ts`, `src/app/api/status/quality/slot/route.ts`                                               | Uses the activity interval for historical expected counts, aggregates, and drill-down.                                   |
| `src/lib/db/repositories/rate-flags.ts`                                                                                         | Queries recent hourly observations, reconciles persisted flags, and exposes flagged IDs for read paths.                  |
| `src/app/api/yield/apy/outliers/route.ts`                                                                                       | QStash-protected hourly reconciliation endpoint.                                                                         |
| `src/lib/protocols/morpho/v1/apy-spot.ts`                                                                                       | Stops dropping finite extreme rates; retains the finite-value guard and useful logging.                                  |
| `src/lib/protocols/morpho/v1/apy-history.ts`                                                                                    | Applies the same finite-only validation before historical points reach heal writes.                                      |
| `src/app/actions/products.actions.ts`                                                                                           | Applies the immediate and persisted display filters to `/supply` and `/borrow` source data before sorting.               |
| `src/lib/db/repositories/apy.ts`                                                                                                | Excludes persisted outliers in public APY repository queries before count/order/page operations.                         |
| `src/lib/graphql/schema.ts`, `src/lib/graphql/resolvers.ts`                                                                     | Exposes an explicit `includeOutliers` opt-in for raw/internal GraphQL APY access; defaults remain safe for public lists. |
| `scripts/clean-insane-apy.ts`, `package.json`                                                                                   | Converts the maintenance task from a display-ceiling purge to a non-finite-only cleanup and renames its command.         |
| `src/lib/**/__tests__/*.test.ts`                                                                                                | Unit coverage for policy, finite validation, and reconciliation decision inputs.                                         |
| `docs/apy-pipeline-gap-heal.md`                                                                                                 | Documents the separation between ingestion completeness and display eligibility.                                         |

## Data Contract

### Product availability periods

Keep `products.active` for current catalogue reads, and add an append-only interval table:

```ts
export const productAvailabilityPeriods = pgTable(
  'product_availability_periods',
  {
    productId: text('product_id').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    detectedBy: text('detected_by').notNull(), // 'product-sync' | 'manual' | 'migration'
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.activatedAt] }),
    index('product_availability_periods_lookup').on(
      t.productId,
      t.activatedAt,
      t.deactivatedAt
    ),
  ]
)
```

The invariant is:

```text
isExpected(product, hour) := EXISTS period
  WHERE period.product_id = product.id
    AND period.activated_at <= hour
    AND (period.deactivated_at IS NULL OR hour < period.deactivated_at)
```

`created_at` remains the immutable first registry-insertion timestamp; it is not repurposed. The migration creates one initial period per product, starting at `created_at`; its end is `NULL` for currently active products and `updated_at` for already inactive products. The latter is the best available historical boundary and must be documented as an approximation for records predating this change. The migration also creates a partial unique index allowing at most one open period per product.

The hourly catalogue sync is not an on-chain event stream, so it cannot know the exact protocol delisting instant. Persist the observed APY boundary instead: for a confirmed-delisted product, close its open period at the first hour after its latest `apy_hourly.hour`; if no hourly row exists, close it at `syncStartedAt`. A returned product with an open period leaves that period unchanged. A returned product without an open period creates a new period at its earliest stored hourly row after the previous period’s close, falling back to `syncStartedAt`. This preserves every active → inactive → active cycle and prevents a normal delisting discovered by the hourly sync from retroactively appearing as a run of pipeline gaps. Never close periods after a failed or partial provider enumeration.

### APY display flags

Create `product_rate_flags` as a dynamic projection, separate from the static `products` registry:

```ts
export const productRateFlags = pgTable(
  'product_rate_flags',
  {
    productId: text('product_id').primaryKey(),
    reason: text('reason').notNull(), // currently: 'outlier_apy'
    flaggedAt: timestamp('flagged_at', { withTimezone: true }).notNull(),
    lastEvaluatedAt: timestamp('last_evaluated_at', {
      withTimezone: true,
    }).notNull(),
    lastObservedHour: timestamp('last_observed_hour', {
      withTimezone: true,
    }).notNull(),
    lastObservedApyNet: doublePrecision('last_observed_apy_net').notNull(),
  },
  (t) => [index('product_rate_flags_reason').on(t.reason)]
)
```

The table contains only currently flagged products. Clearing a flag deletes its row. `flagged_at` is therefore the start of the current quarantine episode, not a full audit log. Pipeline reports record each job’s aggregate counts; no per-observation raw-sample table is introduced.

## Decision Rules

```ts
export const APY_DISPLAY_POLICY = {
  maxAbsoluteNetApy: 100,
  flagHours: 3,
  clearHours: 12,
} as const

export function isApyDisplayOutlier(apyNet: number): boolean {
  return (
    !Number.isFinite(apyNet) ||
    Math.abs(apyNet) > APY_DISPLAY_POLICY.maxAbsoluteNetApy
  )
}

export function shouldFlagOutlier(recentApy: number[]): boolean {
  return (
    recentApy.length === APY_DISPLAY_POLICY.flagHours &&
    recentApy.every(isApyDisplayOutlier)
  )
}

export function shouldClearOutlier(recentApy: number[]): boolean {
  return (
    recentApy.length === APY_DISPLAY_POLICY.clearHours &&
    recentApy.every((apy) => !isApyDisplayOutlier(apy))
  )
}
```

The reconciliation job queries the most recent _completed_ hourly rows per product. It must not treat a missing hour as a normal observation, and it must not clear a flag without all 12 required rows. The page-level immediate filter uses `isApyDisplayOutlier(latestApy)` only; a single normal observation cannot bring a persisted flag back into the UI.

## Tasks

### Task 0: Make product availability historical and interval-aware

**Files:**

- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/repositories/products.ts`
- Modify: `src/app/actions/products-sync.actions.ts`
- Modify: `src/lib/db/repositories/gaps.ts`
- Modify: `src/app/api/status/quality/route.ts`
- Modify: `src/app/api/status/quality/slot/route.ts`
- Modify: `src/lib/protocols/aave/v3/products.ts`
- Modify: `src/lib/protocols/morpho/v1/products.ts`
- Modify: `src/lib/protocols/compound/v3/products.ts`
- Create: generated `drizzle/0001_<generated>.sql` and matching `drizzle/meta/*`
- Create: `src/lib/db/product-availability.ts`
- Create: `src/lib/db/__tests__/product-availability.test.ts`

**Interfaces:**

- Produces `syncProviderProducts(provider, products, syncStartedAt): Promise<ProviderSyncResult>`; it is the only writer that transitions current product availability.
- Produces the reusable SQL predicate `isProductExpectedAt(product, hour)` or a small repository-local equivalent used by both gaps and status SQL.
- Keeps `active` for present-tense catalogue queries; historical reporting consumes `productAvailabilityPeriods`.

- [ ] **Step 1: Write the failing interval and sync-decision tests.**

```ts
import { describe, expect, it } from 'vitest'

import {
  type ProductAvailabilityPeriod,
  isProductExpectedAt,
} from '@/lib/db/product-availability'

describe('product availability', () => {
  const periods: ProductAvailabilityPeriod[] = [
    {
      activatedAt: new Date('2026-07-13T10:00:00.000Z'),
      deactivatedAt: new Date('2026-07-13T14:37:00.000Z'),
    },
    {
      activatedAt: new Date('2026-07-13T18:00:00.000Z'),
      deactivatedAt: null,
    },
  ]

  it('expects a product before, but not at or after, its deactivation boundary', () => {
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T14:00:00.000Z'))
    ).toBe(true)
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T15:00:00.000Z'))
    ).toBe(false)
  })

  it('preserves two distinct active cycles', () => {
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T09:00:00.000Z'))
    ).toBe(false)
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T10:00:00.000Z'))
    ).toBe(true)
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T17:00:00.000Z'))
    ).toBe(false)
    expect(
      isProductExpectedAt(periods, new Date('2026-07-13T18:00:00.000Z'))
    ).toBe(true)
  })
})
```

Add repository-level tests or an executable SQL fixture proving that a product deactivated at `14:37Z` is absent from the expected set for the `15:00Z` slot but remains present for the `14:00Z` slot. Add the same test for `findIncomplete`: an incomplete `15:00Z` row for the deactivated product must not be returned.

- [ ] **Step 2: Run the availability test and verify it fails.**

Run: `pnpm test -- src/lib/db/__tests__/product-availability.test.ts`  
Expected: FAIL because the interval helper and columns do not exist.

- [ ] **Step 3: Add availability periods and generate the migration.**

Add `productAvailabilityPeriods` to the schema and generate the migration:

```bash
pnpm db:generate
```

Edit only the generated migration’s backfill statements after inspecting it. The migration must execute these data steps in order:

```sql
CREATE TABLE product_availability_periods (...);
INSERT INTO product_availability_periods (product_id, activated_at, deactivated_at, detected_by)
SELECT id, created_at,
  CASE WHEN active THEN NULL ELSE updated_at END,
  'migration'
FROM products;
CREATE UNIQUE INDEX product_availability_periods_one_open
  ON product_availability_periods (product_id)
  WHERE deactivated_at IS NULL;
```

Expected: every product has one seeded period, every currently active product has exactly one open period, and no destructive migration touches APY tables.

- [ ] **Step 4: Replace blanket provider deactivation with interval-aware reconciliation.**

Remove the current `deactivateProviders([...providers])` then global re-upsert sequence. For each provider whose complete product fetch succeeded, call one repository operation with the fetched product IDs and one shared `syncStartedAt` timestamp:

1. Upsert returned products. A returned product with no open availability period sets `active = true` and inserts a new period at its earliest `apy_hourly.hour` after the preceding period’s end, falling back to `syncStartedAt`. A returned product with an open period keeps it unchanged.
2. For currently active products of that provider whose exact IDs are absent from the fetched set, set `active = false`, close only their open period at one hour after their latest stored `apy_hourly.hour` (or `syncStartedAt` if none exists), and set `updated_at = syncStartedAt`.
3. Do not deactivate anything for a failed or incomplete provider enumeration. Make product fetchers surface enumeration failures instead of swallowing them and returning a plausible empty list.

The reconciliation must use exact IDs via `IN (...)`, never product ID parsing. The returned `ProviderSyncResult` reports `inserted`, `reactivated`, `deactivated`, and `unchanged` counts separately.

- [ ] **Step 5: Apply the interval predicate consistently in gap and status SQL.**

For every `products p` joined to a slot/hour `h` or boundary `b`, replace `p.active` / `date_trunc('hour', p.created_at) <= b.hour` with:

```sql
EXISTS (
  SELECT 1
  FROM product_availability_periods pap
  WHERE pap.product_id = p.id
    AND pap.activated_at <= b.hour
    AND (pap.deactivated_at IS NULL OR b.hour < pap.deactivated_at)
)
```

Apply it to:

1. `findGaps` expected slots.
2. `findIncomplete`, by joining `products` and applying the condition to `apy_hourly.hour`.
3. `collectedProductCount` / `expectedSlots` reporting, so the summary is not based on products outside their active interval.
4. `/api/status/quality` aggregate rows and expected-product denominator.
5. `/api/status/quality/slot` drill-down; an inactive product must still appear when viewing an hour inside its former interval.

Keep the current provider totals as a present-tense count of `active = true` products for the card label only. Do not use that total as a historical denominator fallback when an hour has a temporal expected-count result.

- [ ] **Step 6: Verify the regression cases and commit.**

Run: `pnpm test -- src/lib/db/__tests__/product-availability.test.ts && pnpm typecheck && pnpm lint`  
Expected: PASS.

```bash
git add src/lib/db/schema.ts src/lib/db/repositories/products.ts src/app/actions/products-sync.actions.ts src/lib/db/repositories/gaps.ts src/app/api/status/quality/route.ts src/app/api/status/quality/slot/route.ts src/lib/protocols/aave/v3/products.ts src/lib/protocols/morpho/v1/products.ts src/lib/protocols/compound/v3/products.ts src/lib/db/product-availability.ts src/lib/db/__tests__/product-availability.test.ts drizzle
git commit -m "feat: track product availability periods"
```

### Task 1: Define and test the policy boundaries

**Files:**

- Create: `src/lib/apy-display-policy.ts`
- Create: `src/lib/__tests__/apy-display-policy.test.ts`
- Create: `src/lib/apy-validation.ts`
- Create: `src/lib/__tests__/apy-validation.test.ts`

**Interfaces:**

- Produces `APY_DISPLAY_POLICY`, `isApyDisplayOutlier`, `shouldFlagOutlier`, and `shouldClearOutlier` for the hourly reconciler and page actions.
- Produces `isFiniteApyBlock(apy)` for live and historical protocol adapters.

- [ ] **Step 1: Write the failing policy tests.**

```ts
import { describe, expect, it } from 'vitest'

import {
  isApyDisplayOutlier,
  shouldClearOutlier,
  shouldFlagOutlier,
} from '@/lib/apy-display-policy'

describe('APY display policy', () => {
  it('flags values above the inclusive display ceiling only when all three completed hours are outliers', () => {
    expect(isApyDisplayOutlier(100)).toBe(false)
    expect(isApyDisplayOutlier(100.0001)).toBe(true)
    expect(shouldFlagOutlier([101, 120, -110])).toBe(true)
    expect(shouldFlagOutlier([101, 99, 120])).toBe(false)
    expect(shouldFlagOutlier([101, 120])).toBe(false)
  })

  it('clears only after twelve non-outlier completed hours', () => {
    expect(shouldClearOutlier(Array.from({ length: 12 }, () => 99))).toBe(true)
    expect(
      shouldClearOutlier([...Array.from({ length: 11 }, () => 99), 101])
    ).toBe(false)
    expect(shouldClearOutlier(Array.from({ length: 11 }, () => 99))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the policy test and verify it fails.**

Run: `pnpm test -- src/lib/__tests__/apy-display-policy.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure display policy and finite-only ingestion validator.**

```ts
// src/lib/apy-display-policy.ts
export const APY_DISPLAY_POLICY = {
  maxAbsoluteNetApy: 100,
  flagHours: 3,
  clearHours: 12,
} as const

export function isApyDisplayOutlier(apyNet: number): boolean {
  return (
    !Number.isFinite(apyNet) ||
    Math.abs(apyNet) > APY_DISPLAY_POLICY.maxAbsoluteNetApy
  )
}

export function shouldFlagOutlier(recentApy: number[]): boolean {
  return (
    recentApy.length === APY_DISPLAY_POLICY.flagHours &&
    recentApy.every(isApyDisplayOutlier)
  )
}

export function shouldClearOutlier(recentApy: number[]): boolean {
  return (
    recentApy.length === APY_DISPLAY_POLICY.clearHours &&
    recentApy.every((apy) => !isApyDisplayOutlier(apy))
  )
}
```

```ts
// src/lib/apy-validation.ts
type ApyBlock = { base: number; rewards: number; fees: number; net: number }

export function isFiniteApyBlock(apy: ApyBlock): boolean {
  return [apy.base, apy.rewards, apy.fees, apy.net].every(Number.isFinite)
}
```

- [ ] **Step 4: Add and run finite-value tests.**

```ts
import { describe, expect, it } from 'vitest'

import { isFiniteApyBlock } from '@/lib/apy-validation'

describe('isFiniteApyBlock', () => {
  it('accepts a finite extreme APY and rejects non-finite components', () => {
    expect(
      isFiniteApyBlock({ base: 2979.95, rewards: 0, fees: 0, net: 2979.95 })
    ).toBe(true)
    expect(isFiniteApyBlock({ base: NaN, rewards: 0, fees: 0, net: 0 })).toBe(
      false
    )
    expect(
      isFiniteApyBlock({ base: 0, rewards: Infinity, fees: 0, net: 0 })
    ).toBe(false)
  })
})
```

Run: `pnpm test -- src/lib/__tests__/apy-display-policy.test.ts src/lib/__tests__/apy-validation.test.ts`  
Expected: PASS.

- [ ] **Step 5: Run static checks and commit.**

Run: `pnpm typecheck && pnpm lint`  
Expected: PASS.

```bash
git add src/lib/apy-display-policy.ts src/lib/apy-validation.ts src/lib/__tests__
git commit -m "feat: define APY display outlier policy"
```

### Task 2: Decouple finite ingestion validation from display eligibility

**Files:**

- Modify: `src/lib/protocols/morpho/v1/apy-spot.ts:19-36, 175-181, 289-295`
- Modify: `src/lib/protocols/morpho/v1/apy-history.ts`
- Modify: `scripts/clean-insane-apy.ts`
- Modify: `package.json:17`
- Create: `src/lib/protocols/morpho/v1/__tests__/apy-validation.test.ts`

**Interfaces:**

- Consumes `isFiniteApyBlock` from Task 1.
- Produces finite live snapshots and finite historical points; extreme finite APY values are retained for `upsertHourlySlots` and `writeHealed`.

- [ ] **Step 1: Write failing adapter-level tests for the two decisions.**

Extract the loop decision into a small exported-free helper in `apy-spot.ts`, then test it through a named export only if the existing test conventions require it. The test cases must assert:

```ts
expect(
  shouldKeepMorphoApy({ base: 2979.95, rewards: 0, fees: 0, net: 2979.95 })
).toBe(true)
expect(shouldKeepMorphoApy({ base: NaN, rewards: 0, fees: 0, net: 0 })).toBe(
  false
)
```

- [ ] **Step 2: Run the adapter test and verify it fails under the current `±100` gate.**

Run: `pnpm test -- src/lib/protocols/morpho/v1/__tests__/apy-validation.test.ts`  
Expected: FAIL because `2979.95` is currently discarded.

- [ ] **Step 3: Replace the local `SANE_APY_MAX` / `isSaneApyBlock` implementation with `isFiniteApyBlock`.**

Use the same control flow, but make the log accurate:

```ts
if (!isFiniteApyBlock(borrowPayload.apy)) {
  console.warn(`[cron:morpho] Dropping non-finite borrow APY ${borrowProductId}`)
  continue
}
```

Apply the guard to every historical `HistoryDataPoint` before it is appended. Do not apply `isApyDisplayOutlier` anywhere in either adapter or the heal route.

- [ ] **Step 4: Preserve only the maintenance cleanup that is still valid.**

Rename the script and package command to `clean:non-finite-apy`. Replace the `BETWEEN -100 AND 100` predicate with explicit PostgreSQL finite checks (`isfinite(...)`) for all four APY columns. Do not delete rows solely because their magnitude exceeds the display threshold.

- [ ] **Step 5: Verify the ingestion behavior and commit.**

Run: `pnpm test -- src/lib/protocols/morpho/v1/__tests__/apy-validation.test.ts && pnpm typecheck && pnpm lint`  
Expected: PASS.

```bash
git add src/lib/protocols/morpho/v1/apy-spot.ts src/lib/protocols/morpho/v1/apy-history.ts scripts/clean-insane-apy.ts package.json src/lib/protocols/morpho/v1/__tests__
git commit -m "fix: retain finite extreme APY observations"
```

### Task 3: Persist current display quarantines and reconcile them hourly

**Files:**

- Modify: `src/lib/db/schema.ts`
- Create: generated `drizzle/0002_<generated>.sql` and matching `drizzle/meta/*`
- Create: `src/lib/db/repositories/rate-flags.ts`
- Create: `src/lib/db/__tests__/rate-flags.test.ts`
- Create: `src/app/api/yield/apy/outliers/route.ts`

**Interfaces:**

- Consumes the policy functions from Task 1 and completed `apy_hourly` rows.
- Produces `reconcileOutlierApyFlags(now): Promise<OutlierReconciliationResult>` and `listOutlierApyProductIds(productIds?: string[]): Promise<Set<string>>`.
- The route returns `{ success, flagged, cleared, unchanged, evaluated, durationMs }`.

- [ ] **Step 1: Add the table declaration, then generate—not hand-write—the migration.**

Add `productRateFlags` exactly as specified in **Data Contract**. Run:

```bash
pnpm db:generate
```

Expected: a second migration creates only `product_rate_flags` with `product_id` as primary key and `product_rate_flags_reason` index. Inspect the SQL and snapshot before continuing; it must not drop or rewrite `products`, `apy_hourly`, or `apy_daily`.

- [ ] **Step 2: Write failing pure reconciliation-decision tests.**

Keep the SQL repository thin by testing the decision matrix independently:

```ts
expect(
  decideOutlierFlag({
    currentlyFlagged: false,
    recentCompletedNet: [101, 102, 103],
  })
).toBe('flag')
expect(
  decideOutlierFlag({
    currentlyFlagged: false,
    recentCompletedNet: [101, 99, 103],
  })
).toBe('unchanged')
expect(
  decideOutlierFlag({
    currentlyFlagged: true,
    recentCompletedNet: Array(12).fill(99),
  })
).toBe('clear')
expect(
  decideOutlierFlag({
    currentlyFlagged: true,
    recentCompletedNet: Array(11).fill(99),
  })
).toBe('unchanged')
```

- [ ] **Step 3: Implement the repository with set-based reads and minimal writes.**

Define these exact types:

```ts
export type OutlierFlagAction = 'flag' | 'clear' | 'unchanged'

export interface OutlierReconciliationResult {
  evaluated: number
  flagged: number
  cleared: number
  unchanged: number
}
```

The repository must:

1. Read active products joined to their most recent 12 `apy_hourly` rows where `quality_count >= 6`, ordered by `hour DESC` per product.
2. Evaluate unflagged products using only the first 3 rows; evaluate flagged products using all 12 rows.
3. Upsert a `product_rate_flags` row for `flag`, retaining the original `flagged_at` on conflict and updating evaluation/observed fields.
4. Delete only rows with `reason = 'outlier_apy'` for `clear`.
5. Return IDs from `listOutlierApyProductIds` by exact `product_id`, optionally restricted with `IN (...)`; return an empty `Set` without querying for an empty input.

Do not select or parse a product ID’s provider or kind. Do not use the global latest-6-hour read window for this job: it needs the most recent completed _hours_, even if they are older during an incident.

- [ ] **Step 4: Add the QStash route.**

Implement a `POST` route matching the existing protected cron pattern:

```ts
export const POST = verifySignatureAppRouter(async () => {
  const startedAt = Date.now()
  try {
    const result = await reconcileOutlierApyFlags(new Date())
    return NextResponse.json({
      success: true,
      ...result,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron:apy-outliers] Failed:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
})
```

- [ ] **Step 5: Verify and commit the persistence layer.**

Run: `pnpm test -- src/lib/db/__tests__/rate-flags.test.ts && pnpm typecheck && pnpm lint`  
Expected: PASS.

```bash
git add src/lib/db/schema.ts drizzle src/lib/db/repositories/rate-flags.ts src/lib/db/__tests__/rate-flags.test.ts src/app/api/yield/apy/outliers/route.ts
git commit -m "feat: track persistent APY outlier flags"
```

### Task 4: Filter public comparison data before sort and pagination

**Files:**

- Modify: `src/lib/db/repositories/apy.ts:286-486`
- Modify: `src/lib/graphql/schema.ts:360-477`
- Modify: `src/lib/graphql/resolvers.ts:102-347`
- Modify: `src/app/actions/products.actions.ts`
- Create: `src/lib/db/__tests__/apy-display-filter.test.ts`

**Interfaces:**

- Consumes `listOutlierApyProductIds` from Task 3 and `isApyDisplayOutlier` from Task 1.
- Extends `ApyFilters` with `includeOutliers?: boolean`; it is `false` by default.
- Extends GraphQL hourly/daily filter inputs with `includeOutliers: Boolean`, documented as an internal/raw-data opt-in.

- [ ] **Step 1: Write failing query contract tests.**

Cover these observable outcomes using repository query helpers or SQL construction seams already present in the codebase:

```ts
// Default query: flagged product is absent from both items and countTotal.
expect(result.items.map((x) => x.product.id)).not.toContain(flaggedId)
expect(result.pagination.countTotal).toBe(eligibleCount)

// Explicit raw query: flagged product is present.
expect(rawResult.items.map((x) => x.product.id)).toContain(flaggedId)
```

Also test the page-action guard with a product whose `productId` has no persisted flag but whose latest APY is `101`: it must be removed before the final `sort`.

- [ ] **Step 2: Add the persisted SQL exclusion at the product predicate level.**

In `productConds`, when `includeOutliers !== true`, add a typed `NOT EXISTS` predicate equivalent to:

```sql
NOT EXISTS (
  SELECT 1
  FROM product_rate_flags prf
  WHERE prf.product_id = products.id
    AND prf.reason = 'outlier_apy'
)
```

This predicate must be shared by `queryApy` and `queryLatestApy`, so their count and data queries use identical eligibility semantics. Keep existing provider/chain/asset filters on typed columns.

- [ ] **Step 3: Make raw GraphQL access explicit and default UI queries safe.**

Add `includeOutliers` to `HourlyFilters`, `DailyFilters`, `BorrowHourlyFilters`, and `BorrowDailyFilters`; thread it through `AnyFilters` and `toApyFilters`. The default `undefined` must exclude flags. Do not add the flag to `ProductFilters`: products are registry entries and should remain discoverable by exact ID.

- [ ] **Step 4: Filter `/supply` and `/borrow` server actions in two layers.**

For each of `_loadSupplyProducts` and `_loadBorrowProducts`:

1. Fetch persisted flag IDs alongside enrichments and latest hourly APY using `Promise.all`.
2. Build the enriched product object as today.
3. Return only products where `productId` is not persisted-flagged **and** `isApyDisplayOutlier(product.apy)` is false.
4. Sort the filtered array by APY only after both filters have run.

This preserves the existing one-minute cache but guarantees a newly extreme latest APY disappears at the next cache refresh, without waiting for the hourly job.

- [ ] **Step 5: Run codegen and verification, then commit.**

Run: `pnpm codegen && pnpm test -- src/lib/db/__tests__/apy-display-filter.test.ts && pnpm typecheck && pnpm lint`  
Expected: PASS; generated GraphQL documents/types reflect the new optional filter field.

```bash
git add src/lib/db/repositories/apy.ts src/lib/graphql/schema.ts src/lib/graphql/resolvers.ts src/app/actions/products.actions.ts src/lib/db/__tests__/apy-display-filter.test.ts src
git commit -m "feat: hide APY outliers from comparison results"
```

### Task 5: Schedule, backfill projections, and document operations

**Files:**

- Modify: `docs/apy-pipeline-gap-heal.md`
- Modify: `README.md` only if it contains the deployed cron inventory; otherwise do not edit it.
- Create: `scripts/reconcile-apy-outliers.ts` only if production QStash cannot be manually invoked for the initial run.

**Interfaces:**

- Consumes `POST /api/yield/apy/outliers` from Task 3.
- Produces an operational QStash schedule and an initial persisted state for existing extreme pools.

- [ ] **Step 1: Document the two independent health concepts.**

Add a short section to `docs/apy-pipeline-gap-heal.md` stating:

```markdown
- Pipeline quality answers whether an hourly sample was collected and stored; finite extreme APY values count as valid samples.
- Display eligibility answers whether a product can appear in public APY ranking; `outlier_apy` does not affect gaps, healing, or `/status` completeness.
- `outlier_apy` is raised after 3 completed outlier hours and cleared after 12 completed normal hours.
- A pool is expected for a historical slot only when a `product_availability_periods` row covers `activated_at <= hour < deactivated_at`; a normal delisting is not a pipeline gap.
```

- [ ] **Step 2: Configure the external QStash schedules.**

Replace the once-daily product sync schedule with a signed QStash schedule for `POST /api/yield/products` at `5 * * * *` UTC. It establishes availability-period boundaries within roughly one hour of a catalogue change. Schedule `POST /api/yield/apy/outliers` at `10 * * * *` UTC, after product reconciliation and after the previous UTC hour has settled. Do not place credentials in the repository. Record both routes and cron expressions in the operational documentation.

- [ ] **Step 3: Apply the migration and establish the initial projection.**

Run in the deployment environment, in this order:

```bash
pnpm db:migrate
# Invoke the QStash endpoint once, or run the approved one-off reconciliation script.
```

Expected: existing rows such as the two identified Morpho borrow markets are flagged because their latest three completed hourly APYs exceed the threshold; their `/status` pipeline cells remain complete.

- [ ] **Step 4: Perform end-to-end acceptance checks.**

1. Trigger one Morpho spot collection containing a finite APY above `100`; verify its `apy_hourly.quality_count` increments rather than disappearing.
2. Run the outlier job; verify the product has `reason = 'outlier_apy'` in `product_rate_flags`.
3. Verify `/supply` and `/borrow` omit the product and APY sorting is no longer polluted.
4. Verify `/api/status/quality` counts the same row as complete when it has six spots and does not report a missing or incomplete slot.
5. Query GraphQL without `includeOutliers`; verify the product is excluded from both `items` and `countTotal`. Query with `includeOutliers: true`; verify raw access returns it.
6. Seed or select twelve completed normal hourly rows for a flagged test product; run the job and verify the flag row is deleted and the product returns to public lists.
7. Create two availability periods for a fixture product (`10:00Z–14:37Z`, then `18:00Z–open`); verify the `14:00Z` and `18:00Z` status drill-downs include it, while `15:00Z` and `17:00Z` do not expect it or report it missing/incomplete.

- [ ] **Step 5: Run the full verification suite and commit.**

Run: `pnpm test && pnpm codegen && pnpm typecheck && pnpm lint && pnpm format:check`  
Expected: PASS.

```bash
git add docs/apy-pipeline-gap-heal.md README.md scripts/reconcile-apy-outliers.ts
git commit -m "docs: document APY display outlier operations"
```

## Verification Checklist

- [ ] A finite `2979.9579` APY reaches `apy_hourly`; it is never rejected as a pipeline failure.
- [ ] `NaN`, `Infinity`, and `-Infinity` are rejected before any hourly or heal write.
- [ ] Three completed outlier hours create one `product_rate_flags` row.
- [ ] One normal hour does not clear a flag; twelve completed normal hours do.
- [ ] A flag is excluded in SQL before public APY sorting, `countTotal`, and pagination.
- [ ] An unflagged product whose latest APY is extreme is hidden by `/supply` and `/borrow` within their cache window.
- [ ] Outlier status never changes `products.active`, gap detection, heal behavior, or `/status` quality completeness.
- [ ] Existing extreme Morpho markets are quarantined after the first reconciliation run without deleting their historical APY rows.
- [ ] A product can be active, inactive, active, then inactive again without overwriting older availability periods; each historical hour uses the correct period-based denominator and drill-down entry.

## Plan Self-Review

- **Coverage:** historical product availability (Task 0), ingestion validation (Task 2), persistent eligibility projection (Task 3), server-side and immediate UI filtering (Task 4), external scheduling/backfill/docs (Task 5), and verification are all represented.
- **Consistency:** `outlier_apy`, `product_rate_flags`, the `3`/`12` hysteresis, and `abs(apy_net) > 100` use the same names and semantics throughout.
- **Scope:** the plan adds a historical availability-period table, one display-eligibility projection table, and one cron route; it changes the product catalogue sync to hourly but does not change APY formulas or treat normal product delisting as a quality/heal failure.
- **No placeholders:** generated migration filenames are intentionally left to drizzle-kit rather than invented; all behavioral decisions and commands are explicit.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-apy-outlier-display-eligibility.md`.

Recommended execution mode: **Subagent-Driven** — implement one task at a time, review the diff and test output after each task before starting the next.
