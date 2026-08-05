/**
 * Compares what the adapters used to render for /supply or /borrow against
 * what the catalogue renders now. Read-only.
 *
 *   pnpm table:parity            # /supply (default)
 *   pnpm table:parity -- borrow  # /borrow
 *
 * Three sections: pools only the adapters know about, ones only the
 * catalogue knows about, and value drift on the intersection. The first
 * group is the exact measure of what the switch removes; the third should
 * stay empty on structural fields.
 */
import { APP_ADAPTERS } from '@/config/protocols-server'
import { latestForTable } from '@/lib/db/repositories/apy'
import type { Kind } from '@/lib/db/types'
import { toBorrowProduct, toSupplyProduct } from '@/lib/products/from-catalogue'
import type { AppAdapter } from '@/lib/protocols/core/types'
import type { BorrowProduct, SupplyProduct } from '@/types'

/** Tolerated relative drift on an amount — the observation can lag up to 10 min. */
const AMOUNT_TOLERANCE = 0.05

/** The fields both `toSupplyProduct` and `toBorrowProduct` fill identically. */
type TableProduct = {
  productId?: string
  poolName: string
  network: string
  link?: string
  poolId: string
  assetAmountUsd: number
  liquidityAmountUsd: number
}

function byProductId<T extends TableProduct>(items: T[]): Map<string, T> {
  return new Map(items.filter((p) => p.productId).map((p) => [p.productId!, p]))
}

function drifted(a: number, b: number): boolean {
  if (a === 0 && b === 0) return false
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) > AMOUNT_TOLERANCE
}

async function main() {
  const kind: Kind = process.argv.includes('borrow') ? 'borrow' : 'supply'
  const loaders = Object.values(APP_ADAPTERS) as (() => Promise<AppAdapter>)[]
  const settled = (await Promise.allSettled(
    loaders.map(async (load) =>
      kind === 'supply'
        ? (await load()).getSupplyProducts()
        : (await load()).getBorrowProducts()
    )
  )) as PromiseSettledResult<(SupplyProduct | BorrowProduct)[]>[]

  const fromAdapters = byProductId<SupplyProduct | BorrowProduct>(
    settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  )

  const rows = await latestForTable(kind)
  const toProduct = kind === 'supply' ? toSupplyProduct : toBorrowProduct
  const fromCatalogue = byProductId(rows.map((r) => toProduct(r)))

  const onlyAdapters = [...fromAdapters.keys()].filter(
    (id) => !fromCatalogue.has(id)
  )
  const onlyCatalogue = [...fromCatalogue.keys()].filter(
    (id) => !fromAdapters.has(id)
  )

  console.log(`kind       : ${kind}`)
  console.log(`adapters   : ${fromAdapters.size} pools`)
  console.log(`catalogue  : ${fromCatalogue.size} pools`)
  console.log(`\nRemoved by the switch (${onlyAdapters.length}):`)
  for (const id of onlyAdapters.slice(0, 40)) console.log(`  - ${id}`)
  if (onlyAdapters.length > 40)
    console.log(`  … and ${onlyAdapters.length - 40} more`)
  console.log(`\nAdded by the switch (${onlyCatalogue.length}):`)
  for (const id of onlyCatalogue) console.log(`  + ${id}`)

  console.log('\nDrift on the intersection:')
  let structural = 0
  let numeric = 0
  for (const [id, a] of fromAdapters) {
    const c = fromCatalogue.get(id)
    if (!c) continue
    for (const field of ['poolName', 'network', 'link', 'poolId'] as const) {
      if (a[field] !== c[field]) {
        structural++
        console.log(
          `  ! ${field}  ${id}\n      adapter=${a[field]}\n      base   =${c[field]}`
        )
      }
    }
    for (const field of ['assetAmountUsd', 'liquidityAmountUsd'] as const) {
      if (drifted(a[field], c[field])) {
        numeric++
        console.log(
          `  ~ ${field}  ${id}  adapter=${a[field].toFixed(0)}  base=${c[field].toFixed(0)}`
        )
      }
    }
  }
  console.log(
    `\n${structural} structural drift(s), ${numeric} amount drift(s) beyond ${AMOUNT_TOLERANCE * 100}%.`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
