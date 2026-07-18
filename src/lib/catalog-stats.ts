import { getCatalogStats } from '@/lib/db/repositories/products'

export interface CatalogStats {
  activeProducts: number
  assets: number
  chains: number
}

/**
 * Catalog stats for marketing surfaces — null on failure instead of throwing,
 * so a DB hiccup degrades a landing stat to its static fallback rather than
 * 500ing the page (or breaking a build that has no DATABASE_URL).
 */
export async function catalogStatsSafe(): Promise<CatalogStats | null> {
  try {
    return await getCatalogStats()
  } catch (err) {
    console.error('[catalog-stats] falling back to static copy:', err)
    return null
  }
}
