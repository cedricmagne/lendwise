/**
 * Compact "time since" label for data-freshness hints: "<1m ago", "35m ago",
 * "26h ago". Hours are the largest unit — a freshness hint never needs days.
 */
export function formatUpdatedAgo(updatedAtMs: number, nowMs: number): string {
  const elapsedMin = Math.floor((nowMs - updatedAtMs) / 60_000)
  if (elapsedMin < 1) return '<1m ago'
  if (elapsedMin < 60) return `${elapsedMin}m ago`
  return `${Math.floor(elapsedMin / 60)}h ago`
}
