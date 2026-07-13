/**
 * Page bounds for every public paginated read.
 *
 * Pure — no DB import — so it can be unit-tested without a DATABASE_URL, and so
 * the repositories can share one definition of "a page we are willing to serve".
 */

/**
 * Hard ceiling on `first`. The endpoint is public and unauthenticated, so an
 * unbounded page size is a free full-table scan.
 */
export const MAX_FIRST = 500

/** Cap on `productIds` — the batch filter must not become an unbounded IN list. */
export const MAX_PRODUCT_IDS = 50

/** The page actually applied, after clamping — what `pagination` must report. */
export interface AppliedPage {
  first: number
  skip: number
}

/**
 * Clamp a requested page into what we are willing to serve.
 *
 * Called by the repositories, not the resolvers: every read path goes through
 * them, so a future caller cannot forget it. `first` is clamped rather than
 * rejected (a capacity limit, not part of the contract), but a NEGATIVE first or
 * skip is not a smaller request — it reaches Postgres as `LIMIT -1` and raises
 * `LIMIT must not be negative`, turning a bad argument into a 500.
 */
export function clampPage(page: { first: number; skip: number }): AppliedPage {
  const first = Number.isFinite(page.first)
    ? Math.min(Math.max(Math.trunc(page.first), 0), MAX_FIRST)
    : 0
  const skip = Number.isFinite(page.skip)
    ? Math.max(Math.trunc(page.skip), 0)
    : 0
  return { first, skip }
}
