import type { Kind } from '@/lib/db/types'
import {
  CHAIN_SLUG_MAP,
  type RegisteredChainId,
} from '@/lib/protocols/core/toolkit'

// ─── Product ID builder ───────────────────────────────────────────────────────
// Unified Morpho productId — same single-builder shape as aave/compound:
//   morpho:v1:{chain}:{vault|market}:{address}:{supply|borrow}
// productType is implied by kind (supply ⇒ vault, borrow ⇒ market); `address`
// is the vault address for supply and the marketId for borrow.
// Replaces the legacy split prefixes (metamorpho:…/morphoblue:…) that omitted
// the trailing kind segment and forced special-case parsing.
export function buildProductId(
  chainId: number,
  address: string,
  kind: Kind
): string {
  const network = CHAIN_SLUG_MAP[chainId as RegisteredChainId]
  if (!network)
    throw new Error(
      `No slug registered for chainId ${chainId} — add it to chain-slugs.ts`
    )
  const productType = kind === 'supply' ? 'vault' : 'market'
  return `morpho:v1:${network}:${productType}:${address.toLowerCase()}:${kind}`
}
