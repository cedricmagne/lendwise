import type { Kind } from '@/lib/db/types'
import type { MarketsApyQuery } from '@/lib/protocols/aave/v3/generated/graphql'

const SPECIAL_ETHEREUM_MARKETS = [
  'AaveV3EthereumEtherFi',
  'AaveV3EthereumHorizon',
  'AaveV3EthereumLido',
]

// Display slug used for the `network` field in SupplyProduct / BorrowProduct.
// Lido/EtherFi/Horizon are shown as distinct networks in the UI filter.
export function getNetworkName(marketChainName: string): string {
  if (SPECIAL_ETHEREUM_MARKETS.includes(marketChainName)) {
    return marketChainName.replace('AaveV3Ethereum', '').toLowerCase()
  } else if (marketChainName === 'AaveV3BNB') {
    return 'bsc'
  } else {
    return marketChainName.replace('AaveV3', '').toLowerCase()
  }
}

// ProductId slug — compound form for special Ethereum markets to avoid collision.
// AaveV3EthereumLido → 'ethereum-lido'
// AaveV3Ethereum     → 'ethereum'
// AaveV3Polygon      → 'polygon'
export function buildProductNetworkSlug(marketChainName: string): string {
  if (SPECIAL_ETHEREUM_MARKETS.includes(marketChainName)) {
    return (
      'ethereum-' + marketChainName.replace('AaveV3Ethereum', '').toLowerCase()
    )
  } else if (marketChainName === 'AaveV3BNB') {
    return 'bsc'
  } else {
    return marketChainName.replace('AaveV3', '').toLowerCase()
  }
}

export function buildProductId(
  reserve: NonNullable<MarketsApyQuery['markets']>[number]['reserves'][number],
  kind: Kind
): string {
  const network = buildProductNetworkSlug(reserve.market.name)
  return `aave:v3:${network}:reserve:${reserve.underlyingToken.address.toLowerCase()}:${kind}`
}
