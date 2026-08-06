import { Version } from '@blend-capital/blend-sdk'

import type { Kind } from '@/lib/db/types'

export function buildProductId({
  poolId,
  assetId,
  kind,
  version = Version.V1,
}: {
  poolId: string
  assetId: string
  kind: Kind
  version?: Version
}): string {
  return `blend:${version.toLowerCase()}:stellar:pool:${poolId.toLowerCase()}:${assetId.toLowerCase()}:${kind}`
}
