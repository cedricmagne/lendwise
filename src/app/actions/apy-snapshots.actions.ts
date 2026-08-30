'use server'

import { type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import { upsertHourlySlots } from '@/lib/db/repositories/apy'
import type { SpotPayload } from '@/lib/db/types'
import { catalogueFetchOpts } from '@/lib/protocols/core/catalogue-opts'
import { spotPayloadSoftSchema } from '@/lib/protocols/core/validation'

// ─── Hour standardization ───────────────────────────────────────────────────────

/**
 * Normalize a timestamp to the top of the current hour (UTC).
 * 11:17:42Z → 11:00:00.000Z
 */
function normalizeHourTimestamp(date: Date): Date {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d
}

// ─── Write hourly slot ──────────────────────────────────────────────────────

/**
 * Upsert one collection slot into apy_hourly via a chunked multi-row statement.
 * Duplicate productIds within the slot are collapsed (one observation per
 * product) — Compound collapses ~1280 payloads → ~40 rows.
 */
async function writeApySlot(
  payloads: SpotPayload[],
  slotTime: Date
): Promise<number> {
  if (payloads.length === 0) return 0
  const hour = normalizeHourTimestamp(slotTime)

  let written: number
  try {
    written = await upsertHourlySlots(payloads, hour, slotTime)
  } catch (err) {
    // Drizzle wraps the driver error ("Failed query: …"); surface the real cause.
    const cause = (err as { cause?: { message?: string } })?.cause
    throw new Error(
      `[db:hourly] upsert failed: ${cause?.message ?? (err as Error).message}`,
      { cause: err }
    )
  }

  const dupes = payloads.length - written
  console.log(
    `[db:hourly] Upserted ${written} rows from ${payloads.length} payloads` +
      (dupes > 0 ? ` (${dupes} duplicate productIds collapsed)` : '') +
      ` for hour ${hour.toISOString()}`
  )
  return written
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type CollectApyResult = {
  success: boolean
  counts: Partial<Record<ProtocolName, number>> & { total: number }
  errors: string[]
  durationMs: number
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Collect APY snapshots from all protocols (or a single one) and upsert
 * rolling averages into apy_hourly.
 *
 * Called every 10 minutes by QStash.
 * Each call contributes one slot to the current hour's rolling average.
 *
 * @param protocol - Optional — run a single protocol fetcher only.
 * @param opts.dryRun - Fetch and validate but skip the apy_hourly write
 *   (scripts/collect-apy.ts verification mode).
 */
export async function collectApySpot(
  protocol?: ProtocolName,
  opts?: { dryRun?: boolean }
): Promise<CollectApyResult> {
  const start = Date.now()
  const slotTime = new Date()
  const errors: string[] = []

  const ids = (Object.keys(YIELD_ADAPTERS) as ProtocolName[]).filter(
    (id) => !protocol || id === protocol
  )

  if (ids.length === 0) {
    return {
      success: false,
      counts: { total: 0 },
      errors: [`Unknown protocol: ${protocol}`],
      durationMs: 0,
    }
  }

  // Catalogue-seeded adapters (Blend — no on-chain market list) get their pool
  // set from `products` here; see src/lib/protocols/core/catalogue-opts.ts. This
  // file stays adapter-agnostic. `activeOnly: true` — the 10-minute collector
  // only probes what is currently listed.
  const fetchOpts = await catalogueFetchOpts(ids, { activeOnly: true })

  const results = await Promise.allSettled(
    ids.map(async (id) =>
      (await YIELD_ADAPTERS[id]()).getApySpot(fetchOpts.get(id))
    )
  )

  const allPayloads: SpotPayload[] = []
  const protoCounts: Partial<Record<ProtocolName, number>> = {}

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const protoId = ids[i]

    if (result.status === 'fulfilled') {
      // Soft-validate each payload (shape + finiteness only). A finite-but-extreme
      // rate is kept — dropping it at ingestion manufactures the gap heal then fills.
      const valid: SpotPayload[] = []
      for (const payload of result.value) {
        const parsed = spotPayloadSoftSchema.safeParse(payload)
        if (parsed.success) valid.push(payload)
        else
          console.warn(
            `[cron:${protoId}] Skipping invalid payload ${payload?.productId ?? '<no id>'}: ${parsed.error.issues[0]?.message}`
          )
      }
      protoCounts[protoId] = valid.length
      allPayloads.push(...valid)
      console.log(`[cron:${protoId}] Fetched ${valid.length} spot payloads`)
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      errors.push(`[${protoId}] ${msg}`)
      console.error(`[cron:collect-apy] ${protoId} failed:`, msg)
    }
  }

  if (opts?.dryRun) {
    console.log(
      `[cron:collect-apy] DRY RUN — ${allPayloads.length} payloads validated, apy_hourly untouched`
    )
  } else if (allPayloads.length > 0) {
    await writeApySlot(allPayloads, slotTime)
  }

  const durationMs = Date.now() - start
  const totalCount = allPayloads.length

  console.log(
    `[cron:collect-apy] Completed in ${durationMs}ms —` +
      ` ${Object.entries(protoCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')}` +
      ` total:${totalCount}`
  )

  return {
    success: errors.length === 0,
    counts: { ...protoCounts, total: totalCount },
    errors,
    durationMs,
  }
}
