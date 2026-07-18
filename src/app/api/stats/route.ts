import { NextResponse } from 'next/server'

import { TX_CHAIN_COUNT } from '@/config/chains'
import { STANDARDIZED_CHAIN_COUNT } from '@/config/chains-coverage'
import { getCatalogStats } from '@/lib/db/repositories/products'

/**
 * Public platform stats — the machine-readable source every external surface
 * (docs site, README badges, …) reads instead of hardcoding counts.
 *
 * Chain counts are config-derived, market/asset counts come from the products
 * table. Cached one hour; CORS open — everything here is public marketing data.
 */
export const revalidate = 3600

export async function GET() {
  const catalog = await getCatalogStats()

  return NextResponse.json(
    {
      standardizedChains: STANDARDIZED_CHAIN_COUNT,
      executionChains: TX_CHAIN_COUNT,
      lendingMarkets: catalog.activeProducts,
      assets: catalog.assets,
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  )
}
