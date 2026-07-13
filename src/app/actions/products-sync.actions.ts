'use server'

import type { ProtocolName } from '@/config/protocols'
import {
  syncProviderProducts,
  upsertProducts,
} from '@/lib/db/repositories/products'
import type { BorrowProduct, Product, SupplyProduct } from '@/lib/db/types'
import { fetchAaveV3Products } from '@/lib/protocols/aave'
import { fetchCompoundV3Products } from '@/lib/protocols/compound'
import { fetchMorphoV1Products } from '@/lib/protocols/morpho'

// ─── Protocol tasks ───────────────────────────────────────────────────────────

const PROTOCOL_TASKS: Partial<
  Record<ProtocolName, () => Promise<(SupplyProduct | BorrowProduct)[]>>
> = {
  aave_v3: fetchAaveV3Products,
  morpho_v1: fetchMorphoV1Products,
  compound_v3: fetchCompoundV3Products,
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Upsert products into Postgres.
 *
 * Uses the deterministic slug id as the upsert key — idempotent.
 * created_at is set on insert only; updated_at always refreshed.
 */
async function writeProductDocs(products: Product[]): Promise<void> {
  if (products.length === 0) return
  await upsertProducts(products)
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type SyncProductsResult = {
  success: boolean
  counts: Partial<Record<ProtocolName, number>> & {
    total: number
    /** Newly listed or relisted — a fresh availability period opened. */
    activated: number
    /** No longer listed by the provider — their open period was closed. */
    deactivated: number
  }
  errors: string[]
  durationMs: number
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Orchestrates product metadata sync across all protocols (or a single one).
 * Fetchers run in parallel. Results are upserted into the products collection.
 *
 * Safe to run multiple times — upsert on _id slug is idempotent.
 * Governance changes (new collaterals, IRM params) are picked up on each run.
 *
 * @param protocol - Optional protocol ID to run a single fetcher.
 */
export async function syncProducts(
  protocol?: ProtocolName
): Promise<SyncProductsResult> {
  const start = Date.now()
  const errors: string[] = []

  const tasks: [
    ProtocolName,
    () => Promise<(SupplyProduct | BorrowProduct)[]>,
  ][] = protocol
    ? PROTOCOL_TASKS[protocol]
      ? [[protocol, PROTOCOL_TASKS[protocol]]]
      : []
    : (Object.entries(PROTOCOL_TASKS) as [
        ProtocolName,
        () => Promise<(SupplyProduct | BorrowProduct)[]>,
      ][])

  if (tasks.length === 0) {
    return {
      success: false,
      counts: { total: 0, activated: 0, deactivated: 0 },
      errors: [`Unknown protocol: ${protocol}`],
      durationMs: 0,
    }
  }

  const results = await Promise.allSettled(tasks.map(([, fetch]) => fetch()))

  const allProducts: Product[] = []
  const protoCounts: Partial<Record<ProtocolName, number>> = {}

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const protoId = tasks[i][0]

    if (result.status === 'fulfilled') {
      protoCounts[protoId] = result.value.length
      allProducts.push(...result.value)
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      errors.push(`[${protoId}] fetch error: ${msg}`)
      console.error(`[sync:products] ${protoId} failed:`, msg)
    }
  }

  // ─── Upsert first ────────────────────────────────────────────────────
  // Availability reconciliation opens periods by selecting FROM products, so the
  // rows must exist before it runs. Upserting also flips a relisted product back
  // to active = true.
  if (allProducts.length > 0) {
    try {
      await writeProductDocs(allProducts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`products write: ${msg}`)
      console.error('[sync:products] Failed to write products:', msg)
      throw err
    }
  }

  // ─── Reconcile availability, per provider ────────────────────────────
  // ONLY for providers whose enumeration succeeded. A failed fetch yields an
  // empty id list, which reconciliation would read as "this provider delisted its
  // entire catalogue" — closing every period it owns and erasing the pipeline's
  // expectations for hundreds of live pools.
  const fetchedByProvider = new Map<string, string[]>()
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status !== 'fulfilled') continue
    const provider = tasks[i][0].split('_')[0] // "aave_v3" → "aave"
    const ids = result.value.map((p) => p._id)
    const existing = fetchedByProvider.get(provider)
    if (existing) existing.push(...ids)
    else fetchedByProvider.set(provider, ids)
  }

  let deactivated = 0
  let activated = 0
  const syncStartedAt = new Date(start)

  for (const [provider, ids] of fetchedByProvider) {
    try {
      const r = await syncProviderProducts(provider, ids, syncStartedAt)
      deactivated += r.deactivated
      activated += r.activated
      console.log(
        `[sync:products] ${provider} — activated:${r.activated}` +
          ` deactivated:${r.deactivated} unchanged:${r.unchanged}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`[${provider}] availability: ${msg}`)
      console.error(`[sync:products] ${provider} availability failed:`, msg)
    }
  }

  const durationMs = Date.now() - start
  const countSummary = Object.entries(protoCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')

  console.log(
    `[sync:products] Completed in ${durationMs}ms — ${countSummary}` +
      ` total:${allProducts.length} activated:${activated} deactivated:${deactivated}`
  )

  return {
    success: errors.length === 0,
    counts: {
      ...protoCounts,
      total: allProducts.length,
      activated,
      deactivated,
    },
    errors,
    durationMs,
  }
}
