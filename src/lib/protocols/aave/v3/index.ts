import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { AppAdapter } from '@/lib/protocols/core/types'

import { getAaveApyHistory } from './apy-history'
import { fetchAaveV3ApySpot } from './apy-spot'
import { getBorrowProducts } from './borrow-products'
import { AAVE_V3_CHAINS } from './config'
import {
  getMarketBorrowHistoryRates,
  getMarketSupplyHistoryRates,
} from './market-rates'
import { getUserBorrowPositions, getUserSupplyPositions } from './positions'
import { fetchAaveV3Products } from './products'
import { getSupplyProducts } from './supply-products'

export const adapter = defineYieldAdapter({
  id: 'aave_v3',
  name: 'Aave v3',
  provider: 'aave',
  version: 'v3',
  chains: AAVE_V3_CHAINS,
  getProducts: fetchAaveV3Products,
  getApySpot: fetchAaveV3ApySpot,
  getApyHistory: getAaveApyHistory,
})

export const appAdapter: AppAdapter = {
  getUserSupplyPositions,
  getUserBorrowPositions,
  getMarketSupplyHistoryRates,
  getMarketBorrowHistoryRates,
  getSupplyProducts,
  getBorrowProducts,
}
