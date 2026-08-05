import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { AppAdapter } from '@/lib/protocols/core/types'

import { getCompoundApyHistory } from './apy-history'
import { fetchCompoundV3ApySpot } from './apy-spot'
import { getBorrowProducts } from './borrow-products'
import { COMPOUND_V3_CHAINS } from './config'
import { COMPOUND_PROVIDER } from '../common/config'
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
  provider: COMPOUND_PROVIDER,
  version: 'v3',
  chains: COMPOUND_V3_CHAINS,
  getProducts: fetchCompoundV3Products,
  getApySpot: fetchCompoundV3ApySpot,
  // The subgraphs' hourly/daily accountings had always been fetchable; leaving
  // them out of the contract is what forced the heal job to fill every Compound
  // hole with a copied neighbour hour. Declared 2026-07-24.
  getApyHistory: getCompoundApyHistory,
})

export const appAdapter: AppAdapter = {
  getUserSupplyPositions,
  getUserBorrowPositions,
  getMarketSupplyHistoryRates,
  getMarketBorrowHistoryRates,
  getSupplyProducts,
  getBorrowProducts,
}
