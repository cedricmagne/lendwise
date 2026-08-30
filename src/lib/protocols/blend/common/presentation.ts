/**
 * Presentation shared by every Blend version — see `core/presentation.ts`.
 *
 * Each version registers its own fragment (`blend/v1/presentation.ts`,
 * `blend/v2/presentation.ts`) pointing here, so a version can diverge later
 * without touching the other.
 */
import type { ProductRow } from '@/lib/db/schema'

/**
 * The pool's own name, read from the typed `protocol_name` column — that column
 * IS the native market/deployment name (`AaveV3EthereumLido` on Aave), so a
 * protocol with several deployments per chain belongs there.
 *
 * Naming a row after its asset, the general rule, only works where one asset
 * means one market per chain. Blend breaks that: its pools all sit on Stellar
 * and largely list the SAME assets — USDC appears in four of the five v1 pools,
 * XLM in four — so the asset name produced rows reading identically, same
 * protocol badge, same network badge, nothing to tell them apart. Blend used to
 * flatten all five into the constant `BlendV1Stellar`, which made them
 * indistinguishable on `/status` too — that page renders `protocol_name`
 * directly.
 *
 * The asset stays legible: its icon sits next to this label in the Supply
 * table, and the Borrow table carries a dedicated Loan column.
 */
export function blendPoolName(p: ProductRow): string {
  return p.protocolName || p.assetName
}

/**
 * Blend's app is one dashboard for every pool, on every version — V1's and
 * V2's backstops are both configured into the same `mainnet.blend.capital`
 * deployment (see its `.env.production`), and the pool page resolves the
 * version from the contract itself. `protocolAddress` IS the pool contract
 * id (`defaultPoolIdentity`'s `poolId`/`poolAddress`), matching the `poolId`
 * query param the dashboard reads off `router.query`.
 */
export function blendProductLink(p: ProductRow): string {
  return `https://mainnet.blend.capital/dashboard/?poolId=${p.protocolAddress}`
}
