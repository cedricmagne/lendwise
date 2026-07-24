import { NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import {
  type ProtocolName,
  adapterIdsForProvider,
} from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { aggregateDaily } from '@/lib/db/repositories/apy'
import {
  collectedProductCount,
  fetchDonors,
  findGaps,
  findIncomplete,
  historyTargets,
  markStale,
  productProviders,
  pruneHourly,
  writeHealed,
} from '@/lib/db/repositories/gaps'
import { insertReport } from '@/lib/db/repositories/reports'
import { runReconcile } from '@/lib/reconcile'
import type { ReconcileDeps } from '@/lib/reconcile/types'

// Four chained steps, one of which fetches protocol history and writes
// thousands of rows. Pro plan allows up to 300s.
export const maxDuration = 300

/** Lookback in days. Must cover the window the repair step can reach. */
const DEFAULT_DAYS = 7
const MAX_DAYS = 14

const deps: ReconcileDeps = {
  findGaps,
  findIncomplete,
  markStale,
  collectedProductCount,
  productProviders,
  historyTargets,
  adapterIdsForProvider,
  loadAdapter: (adapterId) => YIELD_ADAPTERS[adapterId as ProtocolName](),
  fetchDonors,
  writeHealed,
  aggregateDaily,
  pruneHourly,
}

/**
 * The nightly convergence of the sliding window.
 *
 * Replaces three separately scheduled jobs — `/apy/daily` (00:10),
 * `/apy/gaps` (01:00) and `/apy/heal` — whose correctness depended on their
 * cron times lining up, and did not: aggregation ran before the night's
 * repairs, so no repaired row ever reached `apy_daily`. Here the order lives in
 * the code (see `src/lib/reconcile`), and `pipeline_reports` goes back to being
 * a log rather than the interface between two jobs.
 *
 * Body (JSON, optional):
 *   days    — lookback, default 7, capped at 14
 *   dryRun  — detect and report, write nothing
 */
async function reconcileHandler(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    days?: number
    dryRun?: boolean
  }
  const days = Math.min(Math.max(body.days ?? DEFAULT_DAYS, 1), MAX_DAYS)
  const dryRun = body.dryRun === true

  try {
    const report = await runReconcile(deps, {
      days,
      dryRun,
      onProgress: (m) => console.log(m),
    })

    const reportId = dryRun ? null : await insertReport('reconcile', report)

    return NextResponse.json({
      ...report,
      // The full failure list can run to thousands; the report row keeps it,
      // the HTTP response stays readable.
      fetch: { ...report.fetch, failuresSample: report.fetch.failuresSample },
      reportId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[reconcile] failed:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

export const POST =
  process.env.NODE_ENV === 'development'
    ? reconcileHandler
    : verifySignatureAppRouter(reconcileHandler)
