/**
 * Grouping gap entries by provider, and the time span each provider's refetch
 * must actually cover.
 *
 * Split out of the heal route so it can be tested without a database or a
 * signed QStash request — the route itself may only export HTTP handlers.
 *
 * The distinction this module exists for: the heal job used to compute ONE
 * global (min, max) across every gap in the report and hand it to every
 * adapter. A single stale Aave hole therefore widened Morpho's and Compound's
 * refetch window to match, making each protocol pay for the oldest gap in the
 * whole run — inside a route with a 300s budget that fetches all of them in
 * sequence. Each provider now fetches exactly its own span.
 *
 * The global span is still returned: phase 2's donor query runs once for every
 * product it must fill, so it legitimately spans the whole report.
 */

export interface GapEntryLike {
  productId: string
  hour: string
}

export interface ProviderSpan {
  /** Epoch ms of this provider's earliest gap. */
  min: number
  /** Epoch ms of its latest. */
  max: number
}

export interface GapGrouping {
  gapsByProvider: Map<string, { productId: string; hour: Date }[]>
  /** Per-provider refetch bounds — what phase 1 asks each adapter for. */
  spanByProvider: Map<string, ProviderSpan>
  /** Bounds across every gap — what phase 2's donor query uses. */
  globalSpan: ProviderSpan
}

/**
 * Bucket gap entries per provider and measure each bucket's time span.
 *
 * `providerOf` comes from a products JOIN — a productId is opaque and is never
 * parsed. An id missing from it is bucketed under 'unknown', which no adapter
 * claims, so those entries fall through to the donor phase rather than being
 * silently dropped.
 */
export function groupGapsByProvider(
  entries: GapEntryLike[],
  providerOf: Map<string, string>
): GapGrouping {
  const gapsByProvider = new Map<string, { productId: string; hour: Date }[]>()
  const spanByProvider = new Map<string, ProviderSpan>()
  let min = Infinity
  let max = -Infinity

  for (const entry of entries) {
    const provider = providerOf.get(entry.productId) ?? 'unknown'
    const hour = new Date(entry.hour)
    const t = hour.getTime()

    const list = gapsByProvider.get(provider) ?? []
    list.push({ productId: entry.productId, hour })
    gapsByProvider.set(provider, list)

    const span = spanByProvider.get(provider) ?? { min: t, max: t }
    if (t < span.min) span.min = t
    if (t > span.max) span.max = t
    spanByProvider.set(provider, span)

    if (t < min) min = t
    if (t > max) max = t
  }

  return { gapsByProvider, spanByProvider, globalSpan: { min, max } }
}
