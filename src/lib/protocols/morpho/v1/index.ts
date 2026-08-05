import { defineYieldAdapter } from '@/lib/protocols/core/define'
import type { AppAdapter } from '@/lib/protocols/core/types'

import { getMorphoApyHistory } from './apy-history'
import { fetchMorphoV1ApySpot } from './apy-spot'
import { getBorrowProducts } from './borrow-products'
import { MORPHO_V1_CHAINS, MORPHO_V1_INGESTION } from './config'
import { MORPHO_PROVIDER } from '../common/config'
import {
  getMarketBorrowHistoryRates,
  getMarketSupplyHistoryRates,
  getUserBorrowPositions,
  getUserSupplyPositions,
} from './positions'
import { fetchMorphoV1Products } from './products'
import { getSupplyProducts } from './supply-products'

export const adapter = defineYieldAdapter({
  id: 'morpho_v1',
  name: 'Morpho v1',
  provider: MORPHO_PROVIDER,
  version: 'v1',
  chains: MORPHO_V1_CHAINS,
  ingestion: MORPHO_V1_INGESTION,
  getProducts: fetchMorphoV1Products,
  getApySpot: fetchMorphoV1ApySpot,
  getApyHistory: getMorphoApyHistory,
})

export const appAdapter: AppAdapter = {
  getUserSupplyPositions,
  getUserBorrowPositions,
  getMarketSupplyHistoryRates,
  getMarketBorrowHistoryRates,
  getSupplyProducts,
  getBorrowProducts,
}
