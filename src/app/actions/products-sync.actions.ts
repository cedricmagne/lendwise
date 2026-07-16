'use server'

import { z } from 'zod'

import { PROTOCOLS_META, type ProtocolName } from '@/config/protocols-meta'
import { YIELD_ADAPTERS } from '@/config/protocols-server'
import {
  syncProviderProducts,
  upsertProducts,
} from '@/lib/db/repositories/products'
import type { BorrowProduct, Product, SupplyProduct } from '@/lib/db/types'

// ─── Product shape guard ─────────────────────────────────────────────────────
// Non-crashing shape only: a product without a usable `_id` would corrupt the
// upsert (the slug is the PK). NO magnitude rules here — this is not the strict
// CI harness, only a runtime guard against a malformed row poisoning the batch.
const productShapeSchema = z.object({ _id: z.string().min(1) }).loose()

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

  const ids = (Object.keys(YIELD_ADAPTERS) as ProtocolName[]).filter(
    (id) => !protocol || id === protocol
  )

  if (ids.length === 0) {
    return {
      success: false,
      counts: { total: 0, activated: 0, deactivated: 0 },
      errors: [`Unknown protocol: ${protocol}`],
      durationMs: 0,
    }
  }

  const results = await Promise.allSettled(
    ids.map(async (id) => (await YIELD_ADAPTERS[id]()).getProducts())
  )

  const allProducts: Product[] = []
  const protoCounts: Partial<Record<ProtocolName, number>> = {}
  // Valid (id-bearing) products kept per fulfilled index — reused by the
  // availability reconciliation below so a dropped product is never re-listed.
  const validByIndex: (SupplyProduct | BorrowProduct)[][] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const protoId = ids[i]

    if (result.status === 'fulfilled') {
      const valid: (SupplyProduct | BorrowProduct)[] = []
      for (const product of result.value) {
        if (productShapeSchema.safeParse(product).success) valid.push(product)
        else
          console.warn(
            `[sync:${protoId}] Skipping malformed product ${(product as { _id?: string })._id ?? '<no id>'}: missing or empty _id`
          )
      }
      validByIndex[i] = valid
      protoCounts[protoId] = valid.length
      allProducts.push(...valid)
    } else {
      validByIndex[i] = []
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
    if (results[i].status !== 'fulfilled') continue
    const provider = PROTOCOLS_META[ids[i]].provider // no id parsing
    const productIds = validByIndex[i].map((p) => p._id)
    const existing = fetchedByProvider.get(provider)
    if (existing) existing.push(...productIds)
    else fetchedByProvider.set(provider, productIds)
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
