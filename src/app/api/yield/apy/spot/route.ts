import { NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import { collectApySpot } from '@/app/actions/apy-snapshots.actions'
import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { spotStatus } from '@/lib/apy-spot-status'

/**
 * Spot APY snapshot endpoint.
 *
 * Collects APY snapshots and upserts them into the apy_hourly Postgres table
 * (one rolling-average row per product per hour).
 *
 * Body (JSON):
 *   protocol (optional): an adapter id declared in PROTOCOLS_META.
 *   If omitted, EVERY registered protocol is collected — which is how QStash
 *   calls it: one schedule, no body, every 10 minutes. A protocol added to
 *   PROTOCOLS_META is collected without touching Upstash.
 *
 * The parameter survives for two uses: replaying a single protocol by hand, and
 * a transition period where per-protocol schedules still exist.
 *
 * Measured 2026-08-06 (dry run, real network): aave_v3 0.8s, compound_v3 1.1s,
 * morpho_v1 2.9s, blend_v1 5.3s, blend_v2 6.9s — 11.4s for all five in
 * parallel (the sum is 17s; the adapters do contend). `maxDuration` is set an
 * order of magnitude above that, because the platform default is counted in
 * tens of seconds and a run this size sits uncomfortably close to it.
 */
export const maxDuration = 120

export const POST = verifySignatureAppRouter(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const protocol = body.protocol as string | undefined

  if (protocol && !(protocol in PROTOCOLS_META)) {
    return NextResponse.json(
      {
        error: `Invalid protocol: "${protocol}". Supported: ${Object.keys(PROTOCOLS_META).join(', ')}`,
      },
      { status: 400 }
    )
  }

  try {
    const result = await collectApySpot(protocol as ProtocolName | undefined)

    return NextResponse.json(result, { status: spotStatus(result) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[cron:spot] Unhandled error${protocol ? ` for protocol ${protocol}` : ''}:`,
      message
    )

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
})
