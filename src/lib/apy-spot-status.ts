/**
 * The HTTP status `/api/yield/apy/spot` answers QStash with — i.e. whether
 * QStash should retry the run.
 *
 * The distinction matters now that ONE call collects EVERY protocol. A retry
 * re-fetches all of them, and each re-fetch contributes another sample to the
 * hour's running mean in `apy_hourly` — so retrying because one protocol out of
 * five failed would skew the four that worked.
 *
 * Hence: a partial run is a SUCCESS as far as QStash is concerned. The hole one
 * failed protocol leaves is covered by the nightly `reconcile` job, which
 * exists for exactly this — detect, refetch, aggregate. A retry is reserved for
 * the case where there is nothing to skew, because nothing was collected.
 *
 * The write failing is not represented here: `writeApySlot` throws, the route's
 * catch turns it into a 500, and that retry is warranted.
 */
import type { CollectApyResult } from '@/app/actions/apy-snapshots.actions'

export function spotStatus(result: CollectApyResult): number {
  // Nothing collected — every protocol failed, or none is registered. A retry
  // can only help, and has no healthy sample to disturb.
  if (result.counts.total === 0) return 500
  // Partial: some protocols answered, some did not. Keep what was collected,
  // let reconcile close the gap tonight.
  if (result.errors.length > 0) return 207
  return 200
}
