import { AAVE_V3_API_URL } from '@/lib/protocols/aave/v3/config'
import { MarketsApyQuery } from '@/lib/protocols/aave/v3/generated/graphql'
import { MARKETS_APY } from '@/lib/protocols/aave/v3/queries'
import { createGraphQLClient } from '@/lib/protocols/core/toolkit'

async function main() {
  const client = createGraphQLClient(AAVE_V3_API_URL)

  // Polygon, Avalanche, Optimism often have native incentives
  const chainIds = [137, 43114, 10]

  const { data, error } = await client
    .query<MarketsApyQuery>(MARKETS_APY, {
      request: { chainIds },
    })
    .toPromise()

  if (error) {
    console.error('Error:', error)
    return
  }

  for (const market of data?.markets || []) {
    for (const reserve of market.reserves) {
      if (reserve.incentives && reserve.incentives.length > 0) {
        console.log(
          `\nMarket: ${reserve.market.name} - ${reserve.underlyingToken.symbol}`
        )
        console.dir(reserve.incentives, { depth: null })
      }
    }
  }
}

main().catch(console.error)
