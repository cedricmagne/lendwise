/**
 * When was a product part of the catalogue?
 *
 * `products.active` is the catalogue's PRESENT tense — "is this pool listed right
 * now?" — and it is the only thing it can honestly answer. Historical pipeline
 * quality needs a different question: "was this pool supposed to report at 14:00
 * last Tuesday?" Answering that from `active` is wrong in both directions:
 *
 *   - A pool delisted today looks like it was never there. Its real, collected
 *     hours vanish from /status and from the expected denominator.
 *   - Worse, before this table the opposite happened: a delisted pool stayed in
 *     the expected set until the sync noticed, so a perfectly normal delisting
 *     showed up as a run of pipeline gaps — and the heal job dutifully tried to
 *     fabricate rows for a market that no longer exists.
 *
 * So availability is stored as intervals, append-only. A pool can be listed,
 * delisted and relisted any number of times; each cycle is its own period and no
 * cycle overwrites another.
 */

export interface ProductAvailabilityPeriod {
  activatedAt: Date
  /** null = still open (the pool is listed right now). */
  deactivatedAt: Date | null
}

/**
 * Was the product expected to report for this hour?
 *
 * Half-open on purpose: `activated_at <= hour < deactivated_at`. A pool whose
 * final observation landed at 14:00 has its period closed at 15:00, so the 14:00
 * slot is still expected (and its data still counts) while 15:00 is not — and no
 * gap is raised for an hour in which the market genuinely no longer existed.
 */
export function isProductExpectedAt(
  periods: ProductAvailabilityPeriod[],
  hour: Date
): boolean {
  const t = hour.getTime()
  return periods.some(
    (p) =>
      p.activatedAt.getTime() <= t &&
      (p.deactivatedAt === null || t < p.deactivatedAt.getTime())
  )
}
