import { NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import { adapterIdsForProvider } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import {
  type HealRow,
  fetchDonors,
  productProviders,
  writeHealed,
} from '@/lib/db/repositories/gaps'
import {
  insertReport,
  latestReport,
  reportById,
} from '@/lib/db/repositories/reports'
import type { HistoryDataPoint } from '@/lib/protocols/core/types'

// Healing fetches protocol history then writes thousands of rows; the default
// Vercel function limit is too short. Pro plan allows up to 300s.
export const maxDuration = 300

// ─── Constants ──────────────────────────────────────────────────────────────

/** Extra hours before/after the gap window to search for nearest-neighbor donors. */
const DONOR_PADDING_HOURS = 6

/**
 * How far a nearest-neighbor donor may be from the hour it fills.
 *
 * This is NOT the same thing as DONOR_PADDING_HOURS, and conflating the two was a
 * bug. The padding widens the query that FETCHES candidate donors, and that query
 * is bounded by the min/max hour across every gap in the report — so on a report
 * spanning a week, it fetches a week of candidates. Nothing then checked how far
 * the chosen one actually was: 19% of neighbor-healed rows were copies from more
 * than 6 hours away, and 82 of them from more than three days away. A Sunday APY
 * was being written into a Tuesday hole and served as that hour's rate.
 *
 * A copy is only a defensible stand-in while the rate can be assumed not to have
 * moved. Past that, an honest hole — red on /status, retried by the next gap
 * detection — beats a confident fabrication.
 */
const MAX_DONOR_DISTANCE_HOURS = 6

// ─── Types ──────────────────────────────────────────────────────────────────

interface GapEntry {
  hour: string
  productId: string
  kind: 'missing' | 'incomplete'
}

interface DonorPoint {
  hour: Date
  apy: {
    base: number
    rewards: number
    fees: number
    net: number
    rewardItems: unknown[]
  }
  market: Record<string, number | null>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalize any Date to the top of the hour. */
function normalizeHour(d: Date): Date {
  const n = new Date(d)
  n.setUTCMinutes(0, 0, 0)
  return n
}

/** Lookup key `${productId}:${YYYY-MM-DDTHH}`. */
function lookupKey(productId: string, hour: Date): string {
  return `${productId}:${hour.toISOString().slice(0, 13)}`
}

/** Convert HistoryDataPoint[] into a Map keyed by lookupKey. */
function buildHistoryLookup(
  points: HistoryDataPoint[]
): Map<string, HistoryDataPoint> {
  const map = new Map<string, HistoryDataPoint>()
  for (const pt of points) {
    map.set(lookupKey(pt.productId, normalizeHour(pt.timestamp)), pt)
  }
  return map
}

/**
 * The closest donor to `targetHour`, or null if the closest one is too far to be
 * a credible stand-in (see MAX_DONOR_DISTANCE_HOURS).
 *
 * Distance is absolute, so a donor may come from AFTER the hole as readily as
 * before it. That is intentional — the hour either side is equally good evidence
 * of what the rate was — but it is exactly why the cap matters.
 */
function findNearestDonor<T extends { hour: Date }>(
  targetHour: Date,
  donors: T[]
): T | null {
  if (donors.length === 0) return null
  let best = donors[0]
  let bestDist = Math.abs(targetHour.getTime() - best.hour.getTime())
  for (let i = 1; i < donors.length; i++) {
    const dist = Math.abs(targetHour.getTime() - donors[i].hour.getTime())
    if (dist < bestDist) {
      best = donors[i]
      bestDist = dist
    }
  }
  return bestDist <= MAX_DONOR_DISTANCE_HOURS * 3600_000 ? best : null
}

/** Map a snake_case donor row (raw SQL) → camelCase market object. */
function donorMarket(
  d: Record<string, unknown>
): Record<string, number | null> {
  return {
    supplyAssets: d.supply_assets as number | null,
    supplyAssetsUsd: d.supply_assets_usd as number | null,
    utilizationRate: d.utilization_rate as number | null,
    assetPriceUsd: d.asset_price_usd as number | null,
    borrowAssets: d.borrow_assets as number | null,
    borrowAssetsUsd: d.borrow_assets_usd as number | null,
    collateralAssetsUsd: d.collateral_assets_usd as number | null,
    priceCollateralInLoanAsset: d.price_collateral_in_loan_asset as
      | number
      | null,
  }
}

// ─── Endpoint ───────────────────────────────────────────────────────────────

/**
 * Gap healing endpoint for the APY pipeline.
 *
 * Strategy (priority order):
 *   1. Re-fetch — Morpho (HOUR interval) and AAVE (LAST_WEEK window) history APIs.
 *   2. Nearest-neighbor — copy the closest existing hourly row (Compound / fallback).
 *
 * Healed rows are marked healed=true with heal_source + healed_from. Missing
 * rows use INSERT … DO NOTHING (never overwrite organic data); incomplete rows
 * are overwritten.
 *
 * Body (JSON, optional): reportId — a specific gap-detection report. Default: latest.
 */
async function healHandler(req: NextRequest): Promise<NextResponse> {
  const start = Date.now()
  const body = (await req.json().catch(() => ({}))) as { reportId?: string }
  console.log(
    `[cron:heal] Starting heal job (reportId: ${body.reportId || 'latest'})`
  )
  const errors: string[] = []

  const report = body.reportId
    ? await reportById(body.reportId, 'gap-detection')
    : await latestReport('gap-detection')

  if (!report) {
    return NextResponse.json(
      { success: false, error: 'No gap-detection report found' },
      { status: 404 }
    )
  }

  const payload = report.payload as {
    gaps?: { hour: string; productId: string }[]
    incomplete?: { hour: string; productId: string; count: number }[]
  }
  const missingGaps = payload.gaps ?? []
  const incompleteGaps = payload.incomplete ?? []

  const allEntries: GapEntry[] = [
    ...missingGaps.map((g) => ({ ...g, kind: 'missing' as const })),
    ...incompleteGaps.map((g) => ({ ...g, kind: 'incomplete' as const })),
  ]

  if (allEntries.length === 0) {
    // Still record a run so "Latest Heal Job" reflects reality — a clean gap
    // report (nothing to heal) is the healthy steady state, not a stuck job.
    const result = {
      success: true,
      sourceReportId: report.id,
      totalGaps: 0,
      totalMissing: 0,
      totalIncomplete: 0,
      healedByRefetch: 0,
      healedByNeighbor: 0,
      healed: 0,
      noDonor: 0,
      errors: [],
      durationMs: Date.now() - start,
    }
    const reportId = await insertReport('gap-healing', result)
    console.log(`[cron:heal] no gaps to heal — recorded reportId ${reportId}`)
    return NextResponse.json({
      ...result,
      reportId,
      message: 'No gaps to heal in this report',
    })
  }

  // Resolve provider per productId via the products JOIN — NEVER by parsing the id.
  const providerOf = await productProviders([
    ...new Set(allEntries.map((e) => e.productId)),
  ])

  // Group entries by provider + compute gap time boundaries.
  const gapsByProvider = new Map<string, { productId: string; hour: Date }[]>()
  let minTs = Infinity
  let maxTs = -Infinity
  for (const entry of allEntries) {
    const provider = providerOf.get(entry.productId) ?? 'unknown'
    const list = gapsByProvider.get(provider) ?? []
    list.push({ productId: entry.productId, hour: new Date(entry.hour) })
    gapsByProvider.set(provider, list)
    const t = new Date(entry.hour).getTime()
    if (t < minTs) minTs = t
    if (t > maxTs) maxTs = t
  }

  // Phase 1: re-fetch historical data via the adapter registry (generic).
  // Each provider resolves to its adapter ids; an adapter without getApyHistory
  // (Compound) is skipped here and left to the donor phase below — unchanged. Aave
  // gap ranges within the last week map to its LAST_WEEK window inside
  // getApyHistory (via aaveWindowForRange), the same window this route used before.
  const historyLookup = new Map<string, HistoryDataPoint>()
  for (const provider of gapsByProvider.keys()) {
    for (const adapterId of adapterIdsForProvider(provider)) {
      try {
        const adapter = await YIELD_ADAPTERS[adapterId]()
        if (!adapter.getApyHistory) continue
        const points = await adapter.getApyHistory({
          startTimestamp: Math.floor(minTs / 1000) - 3600,
          endTimestamp: Math.floor(maxTs / 1000) + 3600,
          interval: 'HOUR',
          onProgress: (m) => console.log(`[cron:heal] ${m}`),
        })
        for (const [k, v] of buildHistoryLookup(points)) historyLookup.set(k, v)
      } catch (err) {
        errors.push(
          `${adapterId}-history: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  // Phase 2: nearest-neighbor donors (Compound + fallback)
  const needNeighbor = new Set<string>()
  for (const entry of allEntries) {
    if (!historyLookup.has(lookupKey(entry.productId, new Date(entry.hour)))) {
      needNeighbor.add(entry.productId)
    }
  }
  const donorsByProduct = new Map<string, DonorPoint[]>()
  if (needNeighbor.size > 0) {
    const donorStart = new Date(minTs - DONOR_PADDING_HOURS * 3600_000)
    const donorEnd = new Date(maxTs + DONOR_PADDING_HOURS * 3600_000)
    const donorRows = await fetchDonors([...needNeighbor], donorStart, donorEnd)
    for (const d of donorRows) {
      const productId = d.product_id as string
      const list = donorsByProduct.get(productId) ?? []
      list.push({
        hour: new Date(d.hour as string),
        apy: {
          base: d.apy_base as number,
          rewards: d.apy_rewards as number,
          fees: d.apy_fees as number,
          net: d.apy_net as number,
          rewardItems: (d.reward_items as unknown[]) ?? [],
        },
        market: donorMarket(d),
      })
      donorsByProduct.set(productId, list)
    }
  }

  // Phase 3: build heal rows
  const rows: HealRow[] = []
  let refetch = 0
  let neighbor = 0
  let noDonor = 0
  for (const entry of allEntries) {
    const hour = new Date(entry.hour)
    const hp = historyLookup.get(lookupKey(entry.productId, hour))
    if (hp) {
      rows.push({
        productId: entry.productId,
        hour,
        apy: {
          base: hp.apy.base,
          rewards: hp.apy.rewards,
          fees: hp.apy.fees,
          net: hp.apy.net,
          rewardItems:
            (hp.apy as { rewardItems?: unknown[] }).rewardItems ?? [],
        },
        market: hp.market as unknown as Record<string, number | null>,
        source: 'refetch',
        healedFrom: hp.timestamp.toISOString(),
        gapKind: entry.kind,
      })
      refetch++
      continue
    }
    const donor = findNearestDonor(
      hour,
      donorsByProduct.get(entry.productId) ?? []
    )
    if (donor) {
      rows.push({
        productId: entry.productId,
        hour,
        apy: donor.apy,
        market: donor.market,
        source: 'nearest-neighbor',
        healedFrom: donor.hour.toISOString(),
        gapKind: entry.kind,
      })
      neighbor++
    } else {
      noDonor++
    }
  }

  const healed = await writeHealed(rows)
  const result = {
    success: errors.length === 0,
    sourceReportId: report.id,
    totalGaps: allEntries.length,
    totalMissing: missingGaps.length,
    totalIncomplete: incompleteGaps.length,
    healedByRefetch: refetch,
    healedByNeighbor: neighbor,
    healed,
    noDonor,
    errors,
    durationMs: Date.now() - start,
  }
  const reportId = await insertReport('gap-healing', result)
  console.log(
    `[cron:heal] healed ${healed} (refetch ${refetch}, neighbor ${neighbor}, noDonor ${noDonor}) reportId ${reportId}`
  )
  return NextResponse.json({ ...result, reportId })
}

export const POST =
  process.env.NODE_ENV === 'development'
    ? healHandler
    : verifySignatureAppRouter(healHandler)
