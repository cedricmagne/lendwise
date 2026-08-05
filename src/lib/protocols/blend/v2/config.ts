import type { AdapterChain } from '@/lib/protocols/core/types'

// Relative (not '@/…') so codegen.ts can load this module through jiti, which
// does not resolve the '@/' path alias for value imports. Matches the pattern in
// the sibling aave/compound configs that codegen also imports.
import { adapterChains } from '../../core/toolkit/chain-slugs'

export const BLEND_V2_CHAINS: Record<number, AdapterChain> = adapterChains([
  'stellar',
])
