import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { AppAdapter } from '@/lib/protocols/core/types'

import { fetchCompoundV3ApySpot } from './apy-spot'
import { getBorrowProducts } from './borrow-products'
import { COMPOUND_V3_CHAINS } from './config'
import {
  getMarketBorrowHistoryRates,
  getMarketSupplyHistoryRates,
  getUserBorrowPositions,
  getUserSupplyPositions,
} from './positions'
import { fetchCompoundV3Products } from './products'
import { getSupplyProducts } from './supply-products'

export const adapter = defineYieldAdapter({
  id: 'compound_v3',
  name: 'Compound v3',
  provider: 'compound',
  version: 'v3',
  chains: COMPOUND_V3_CHAINS,
  getProducts: fetchCompoundV3Products,
  getApySpot: fetchCompoundV3ApySpot,
  // no getApyHistory: subgraph history serves the one-time sync route only;
  // heal deliberately uses nearest-neighbor donors for Compound (spec §3).
})

export const appAdapter: AppAdapter = {
  getUserSupplyPositions,
  getUserBorrowPositions,
  getMarketSupplyHistoryRates,
  getMarketBorrowHistoryRates,
  getSupplyProducts,
  getBorrowProducts,
}
