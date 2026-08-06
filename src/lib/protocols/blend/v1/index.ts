import { defineYieldAdapter } from '@/lib/protocols/core/define'
import { CHAIN_SLUG_MAP } from '@/lib/protocols/core/toolkit/chain-slugs'

import { fetchBlendV1ApySpot } from './apy-spot'
import { fetchBlendV1Products } from './products'

export const adapter = defineYieldAdapter({
  id: 'blend_v1',
  name: 'Blend v1',
  provider: 'blend',
  version: 'v1',
  chains: {
    '-1': { slug: CHAIN_SLUG_MAP['-1'] },
  },
  getProducts: fetchBlendV1Products,
  getApySpot: fetchBlendV1ApySpot,
  // getApyHistory: optional
})
