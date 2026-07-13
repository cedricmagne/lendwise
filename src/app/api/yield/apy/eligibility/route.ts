import { NextRequest, NextResponse } from 'next/server'

import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'

import { reconcileDisplayFlags } from '@/lib/db/repositories/display-flags'

/**
 * Display-eligibility reconciliation endpoint.
 *
 * Triggered by QStash hourly, a few minutes past the hour so the previous one has
 * settled (all six 10-minute spots landed). Recomputes which pools are withheld
 * from public APY rankings — empty markets and absurd rates — with hysteresis:
 * hidden after 3 consecutive bad hours, restored only after 12 good ones.
 *
 * Touches nothing the pipeline depends on. `products.active`, gap detection,
 * healing and /status completeness are all unaffected by design: a hidden pool is
 * still an active, fully-collected pool. This endpoint only decides what a user
 * is shown.
 *
 * Idempotent — rerunning it on the same data is a no-op.
 */
export const POST = verifySignatureAppRouter(async (_req: NextRequest) => {
  const startedAt = Date.now()

  try {
    const result = await reconcileDisplayFlags(new Date())

    console.log(
      `[cron:apy-eligibility] Completed — evaluated: ${result.evaluated} flagged: ${result.flagged} cleared: ${result.cleared} unchanged: ${result.unchanged}`
    )

    return NextResponse.json(
      { success: true, ...result, durationMs: Date.now() - startedAt },
      { status: 200 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron:apy-eligibility] Reconciliation failed:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
})
