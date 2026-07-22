'use server'

import { sql } from 'drizzle-orm'

import { db } from '@/lib/db/postgres'
import { expectedAt } from '@/lib/db/repositories/gaps'
import { latestReport } from '@/lib/db/repositories/reports'

// ─── Quality overview (formerly GET /api/status/quality) ────────────────────

export async function getStatusQuality() {
  const hours = 168
  const now = new Date()
  // windowEnd = start of the current hour → boundary between settled history and
  // the in-progress hour. queryEnd extends one hour past it so the live hour's
  // rows are fetched and shown as a "filling" cell (not counted as settled).
  const windowEnd = new Date(now)
  windowEnd.setUTCMinutes(0, 0, 0)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCHours(windowStart.getUTCHours() - hours)
  const queryEnd = new Date(windowEnd)
  queryEnd.setUTCHours(queryEnd.getUTCHours() + 1)
  const currentHourKey = windowEnd.toISOString()
  // Spots expected to have landed so far this hour (one per 10-min slot, :00..:50).
  // Lets the live cell be scored on completeness-so-far (e.g. all pools at 3/3)
  // instead of always-incomplete against the full 6.
  const expectedSpotsSoFar = Math.min(
    6,
    Math.floor(now.getUTCMinutes() / 10) + 1
  )

  const totalsRes = await db.execute(
    sql`SELECT provider, count(*)::int AS n FROM products WHERE active GROUP BY provider`
  )
  const totals = new Map<string, number>()
  for (const r of totalsRes.rows as { provider: string; n: number }[]) {
    totals.set(r.provider, r.n)
  }

  const aggRes = await db.execute(sql`
    SELECT p.provider, h.hour,
           count(*)::int AS product_count,
           -- "full" = 6 native spots OR healed (neighbor-heal has valid APY but
           -- quality_count=0, so count it as complete and let the ring flag it).
           count(*) FILTER (WHERE h.quality_count >= 6 OR h.healed)::int AS complete,
           -- Same idea but against spots-so-far — only meaningful for the live hour.
           count(*) FILTER (WHERE h.quality_count >= ${expectedSpotsSoFar} OR h.healed)::int AS complete_live,
           count(*) FILTER (WHERE h.healed)::int AS healed,
           sum(h.quality_count)::int AS total_count
    FROM apy_hourly h JOIN products p ON p.id = h.product_id
    WHERE h.hour >= ${windowStart} AND h.hour < ${queryEnd}
      AND ${expectedAt(sql.raw('p'), sql.raw('h.hour'))}
    GROUP BY p.provider, h.hour
  `)
  const byProto = new Map<
    string,
    Map<
      string,
      {
        productCount: number
        complete: number
        completeLive: number
        healed: number
        totalCount: number
      }
    >
  >()
  for (const r of aggRes.rows as {
    provider: string
    hour: Date
    product_count: number
    complete: number
    complete_live: number
    healed: number
    total_count: number
  }[]) {
    const key = new Date(r.hour).toISOString()
    if (!byProto.has(r.provider)) byProto.set(r.provider, new Map())
    byProto.get(r.provider)!.set(key, {
      productCount: r.product_count,
      complete: r.complete,
      completeLive: r.complete_live,
      healed: r.healed,
      totalCount: r.total_count,
    })
  }

  // Per-(provider, hour) EXPECTED pool count — scoped exactly like gap detection
  // (findGaps), through the same `expectedAt` predicate, so the heatmap's
  // denominator and the healer's worklist can never drift apart. A pool counts for
  // an hour only if it was actually listed then: a market created mid-window is not
  // "missing" for the hours before it existed, and a delisted one stops being owed
  // the moment it leaves — while keeping every hour it really did report.
  const expectedRes = await db.execute(sql`
    WITH boundaries AS (
      SELECT generate_series(
        ${windowStart}::timestamptz,
        ${queryEnd}::timestamptz - interval '1 hour',
        interval '1 hour'
      ) AS hour
    ),
    collected AS (
      SELECT DISTINCT product_id FROM apy_hourly
      WHERE hour >= ${windowStart} AND hour < ${queryEnd}
    )
    SELECT p.provider, b.hour, count(*)::int AS expected
    FROM products p
    JOIN collected c ON c.product_id = p.id
    CROSS JOIN boundaries b
    WHERE ${expectedAt(sql.raw('p'), sql.raw('b.hour'))}
    GROUP BY p.provider, b.hour
  `)
  const expectedByProto = new Map<string, Map<string, number>>()
  for (const r of expectedRes.rows as {
    provider: string
    hour: Date
    expected: number
  }[]) {
    const key = new Date(r.hour).toISOString()
    if (!expectedByProto.has(r.provider))
      expectedByProto.set(r.provider, new Map())
    expectedByProto.get(r.provider)!.set(key, r.expected)
  }

  const boundaries: Date[] = []
  for (
    let c = new Date(windowStart);
    c < queryEnd;
    c.setUTCHours(c.getUTCHours() + 1)
  ) {
    boundaries.push(new Date(c))
  }

  const protocols = [
    { key: 'morpho', label: 'Morpho' },
    { key: 'aave', label: 'AAVE' },
    { key: 'compound', label: 'Compound' },
  ]

  const rows = protocols.map(({ key, label }) => {
    const totalProducts = totals.get(key) ?? 0
    const hourMap = byProto.get(key)
    const expectedMap = expectedByProto.get(key)
    let complete = 0
    let partial = 0
    let missing = 0

    const slots = boundaries.map((h) => {
      const hourKey = h.toISOString()
      // Pools that were expected to report THIS hour (created_at-scoped), not
      // today's full set — falls back to the current total for safety.
      const expectedProducts = expectedMap?.get(hourKey) ?? totalProducts
      const agg = hourMap?.get(hourKey)

      // The live, still-filling hour — excluded from the settled completeness
      // summary. Scored on spots-so-far so it earns a real color (green when all
      // pools are at N/N), with the blinking "in progress" marker layered on top.
      if (hourKey === currentHourKey) {
        return {
          hour: hourKey,
          count: agg
            ? Math.min(
                expectedSpotsSoFar,
                Math.round(agg.totalCount / agg.productCount)
              )
            : 0,
          status: 'in_progress' as const,
          inProgress: true,
          healed: agg ? agg.healed > 0 : false,
          productCount: agg?.productCount ?? 0,
          // Pools that reported every spot expected so far — the live signal.
          fullProducts: agg?.completeLive ?? 0,
          expectedProducts,
          expectedSpots: expectedSpotsSoFar,
        }
      }

      if (!agg || agg.productCount === 0) {
        missing++
        return {
          hour: hourKey,
          count: 0,
          status: 'missing' as const,
          healed: false,
          productCount: 0,
          fullProducts: 0,
          expectedProducts,
          expectedSpots: 6,
        }
      }
      const isComplete =
        expectedProducts > 0 ? agg.complete / expectedProducts >= 0.95 : false
      if (isComplete) complete++
      else partial++
      return {
        hour: hourKey,
        count: Math.min(6, Math.round(agg.totalCount / agg.productCount)),
        status: isComplete ? ('complete' as const) : ('partial' as const),
        healed: agg.healed > 0,
        // Products that reported at least one spot this hour.
        productCount: agg.productCount,
        // Products that reported all 6 spots (or were healed) — the real signal.
        fullProducts: agg.complete,
        expectedProducts,
        expectedSpots: 6,
      }
    })

    return {
      protocol: key,
      label,
      totalProducts,
      slots,
      // total excludes the live hour (last boundary) — only settled hours count.
      summary: { complete, partial, missing, total: boundaries.length - 1 },
    }
  })

  const [gap, heal] = await Promise.all([
    latestReport('gap-detection'),
    latestReport('gap-healing'),
  ])
  const gp = (gap?.payload ?? {}) as {
    collected?: {
      missingSlots?: number
      incompleteSlots?: number
      expectedSlots?: number
    }
  }
  const hp = (heal?.payload ?? {}) as {
    totalGaps?: number
    healed?: number
    healedByRefetch?: number
    healedByNeighbor?: number
    noDonor?: number
  }

  return {
    window: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
      hours,
    },
    protocols: rows,
    latestReports: {
      gapDetection: gap
        ? {
            id: gap.id,
            createdAt: gap.createdAt.toISOString(),
            missingSlots: gp.collected?.missingSlots ?? 0,
            incompleteSlots: gp.collected?.incompleteSlots ?? 0,
            expectedSlots: gp.collected?.expectedSlots ?? 0,
          }
        : null,
      gapHealing: heal
        ? {
            id: heal.id,
            createdAt: heal.createdAt.toISOString(),
            totalGaps: hp.totalGaps ?? 0,
            healed: hp.healed ?? 0,
            healedByRefetch: hp.healedByRefetch ?? 0,
            healedByNeighbor: hp.healedByNeighbor ?? 0,
            noDonor: hp.noDonor ?? 0,
          }
        : null,
    },
  }
}

export type StatusQuality = Awaited<ReturnType<typeof getStatusQuality>>

// ─── Slot drill-down (formerly GET /api/status/quality/slot) ────────────────
// Per-pool data-quality breakdown for a single (provider, hour) cell, so the
// status heatmap can answer "which pool is missing data?".

interface PoolRow {
  id: string
  protocolName: string
  chainName: string
  assetSymbol: string
  kind: string
  /** Spots reported this hour (0–6), or null when the pool reported nothing. */
  spots: number | null
  healed: boolean
}

export async function getStatusQualitySlot(provider: string, hourParam: string) {
  const hour = new Date(hourParam)
  if (Number.isNaN(hour.getTime())) {
    throw new Error('invalid hour')
  }

  // Spots that could have landed by now: 6 for a settled hour, but only
  // :00..:50-so-far for the live one. Scoring the in-progress hour against a
  // hard 6 reports every pool of every provider as "incomplete" for the whole
  // hour — which is what the heatmap cell already avoids via the same formula
  // (see getStatusQuality above). Keep the two in step or the drill-down
  // contradicts the cell it was opened from.
  const now = new Date()
  const currentHour = new Date(now)
  currentHour.setUTCMinutes(0, 0, 0)
  const expectedSpots =
    hour.getTime() === currentHour.getTime()
      ? Math.min(6, Math.floor(now.getUTCMinutes() / 10) + 1)
      : 6

  const res = await db.execute(sql`
    SELECT
      pr.id,
      pr.protocol_name AS protocol_name,
      pr.chain_name    AS chain_name,
      pr.asset_symbol  AS asset_symbol,
      pr.kind          AS kind,
      h.quality_count  AS spots,
      COALESCE(h.healed, false) AS healed
    FROM products pr
    LEFT JOIN apy_hourly h ON h.product_id = pr.id AND h.hour = ${hour}
    WHERE pr.provider = ${provider}
      -- Exactly the pools that were LISTED this hour — same predicate as the
      -- heatmap and the healer. A market created later is not "missing" for the
      -- hours before it existed; a delisted one still appears in the drill-down of
      -- an hour inside its former life, and stops appearing after it.
      AND ${expectedAt(sql.raw('pr'), sql`${hour}`)}
    ORDER BY (h.quality_count IS NULL) DESC, h.quality_count ASC, pr.asset_symbol ASC
  `)

  const pools: PoolRow[] = (
    res.rows as {
      id: string
      protocol_name: string
      chain_name: string
      asset_symbol: string
      kind: string
      spots: number | null
      healed: boolean
    }[]
  ).map((r) => ({
    id: r.id,
    protocolName: r.protocol_name,
    chainName: r.chain_name,
    assetSymbol: r.asset_symbol,
    kind: r.kind,
    spots: r.spots,
    healed: r.healed,
  }))

  // Healed pools have usable (neighbor-copied) APY even at quality_count < 6, so
  // they count as full — keeps this breakdown consistent with the heatmap, where
  // `healed` also satisfies "complete". (Missing rows never have healed=true.)
  const missing = pools.filter((p) => p.spots == null)
  const incomplete = pools.filter(
    (p) => p.spots != null && p.spots < expectedSpots && !p.healed
  )
  const full = pools.length - missing.length - incomplete.length

  return {
    provider,
    hour: hour.toISOString(),
    expected: pools.length,
    expectedSpots,
    full,
    missing,
    incomplete,
  }
}

export type StatusQualitySlot = Awaited<ReturnType<typeof getStatusQualitySlot>>
