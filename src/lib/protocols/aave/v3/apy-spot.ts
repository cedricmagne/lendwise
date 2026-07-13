import type {
  BorrowMarketState,
  RewardItem,
  SpotPayload,
  SupplyMarketState,
} from '@/lib/db/types'
import { AAVE_CONFIG } from '@/lib/protocols/aave/config'
import type { MarketsApyQuery } from '@/lib/protocols/aave/v3/offchain/generated/graphql'
import { MARKETS_APY } from '@/lib/protocols/aave/v3/offchain/queries'
import { createGraphQLClient } from '@/lib/protocols/shared'
import { aprToApyDaily, aprToApyPerSecond } from '@/lib/utils'

import { listsBorrow } from './listing'
import { buildProductId } from './utils'

// ─── Merkl types ──────────────────────────────────────────────────────────────

type MerklOpportunity = {
  chainId: number
  status: string
  action: string
  apr: number
  depositUrl?: string
  tokens: { address: string }[]
}

type MerklIncentiveMap = Map<string, { apr: number; apy: number }>

type MerklIncentives = {
  supply: MerklIncentiveMap
  borrow: MerklIncentiveMap
}

// ─── Merkl helpers ────────────────────────────────────────────────────────────

/**
 * Map Aave GraphQL market names to Merkl depositUrl slugs.
 */
const AAVE_MARKET_TO_MERKL_SLUG: Record<string, string> = {
  AaveV3Ethereum: 'proto_mainnet_v3',
  AaveV3EthereumLido: 'proto_lido_v3',
  AaveV3EthereumEtherFi: 'proto_etherfi_v3',
  AaveV3EthereumHorizon: 'proto_horizon_v3',
  AaveV3Polygon: 'proto_polygon_v3',
  AaveV3Arbitrum: 'proto_arbitrum_v3',
  AaveV3Optimism: 'proto_optimism_v3',
  AaveV3Base: 'proto_base_v3',
  AaveV3Avalanche: 'proto_avalanche_v3',
  AaveV3BNB: 'proto_bnb_v3',
  AaveV3Linea: 'proto_linea_v3',
  AaveV3Gnosis: 'proto_gnosis_v3',
  AaveV3Scroll: 'proto_scroll_v3',
  AaveV3Metis: 'proto_metis_v3',
  AaveV3ZkSync: 'proto_zksync_v3',
}

function extractDepositUrlParams(depositUrl?: string): {
  marketName: string | null
  underlyingAsset: string | null
} {
  if (!depositUrl) return { marketName: null, underlyingAsset: null }
  try {
    const url = new URL(depositUrl)
    return {
      marketName: url.searchParams.get('marketName'),
      underlyingAsset: url.searchParams.get('underlyingAsset'),
    }
  } catch {
    return { marketName: null, underlyingAsset: null }
  }
}

function incentiveKey(marketName: string | null, tokenAddress: string): string {
  const addr = tokenAddress.toLowerCase()
  return marketName ? `${marketName}:${addr}` : addr
}

/**
 * Fetch Merkl incentive APRs for AAVE opportunities (LEND + BORROW).
 * Returns maps of composite key (marketName:tokenAddress) → { apr, apy }.
 * Merkl APR values are raw percentage (e.g. 1.5 = 1.5%) — converted to decimal APY.
 */
async function fetchMerklIncentives(
  chainIds: number[]
): Promise<MerklIncentives> {
  const incentives: MerklIncentives = {
    supply: new Map(),
    borrow: new Map(),
  }

  try {
    const url = `https://api.merkl.xyz/v4/opportunities/?name=aave&chainId=${chainIds.join(',')}`
    const response = await fetch(url)

    if (!response.ok) {
      console.warn(
        `[cron:aave:merkl] API returned ${response.status}: ${response.statusText}`
      )
      return incentives
    }

    const opportunities: MerklOpportunity[] = await response.json()

    for (const opp of opportunities) {
      if (opp.status !== 'LIVE') continue

      const targetMap =
        opp.action === 'LEND'
          ? incentives.supply
          : opp.action === 'BORROW'
            ? incentives.borrow
            : null

      if (!targetMap) continue

      // Merkl returns APR as a percentage — convert to decimal APY
      const aprDecimal = opp.apr / 100
      const apy = aprToApyDaily(aprDecimal)

      const { marketName, underlyingAsset } = extractDepositUrlParams(
        opp.depositUrl
      )
      const addresses = new Set(opp.tokens.map((t) => t.address.toLowerCase()))
      if (underlyingAsset) addresses.add(underlyingAsset.toLowerCase())

      for (const addr of addresses) {
        const key = incentiveKey(marketName, addr)
        const current = targetMap.get(key)
        targetMap.set(key, {
          apr: (current?.apr ?? 0) + aprDecimal,
          apy: (current?.apy ?? 0) + apy,
        })
      }
    }
  } catch (err) {
    console.error(
      '[cron:aave:merkl] Failed to fetch Merkl incentives:',
      err instanceof Error ? err.message : err
    )
  }

  return incentives
}

function lookupMerklIncentive(
  map: MerklIncentiveMap,
  marketSlug: string | null,
  tokenAddress: string
): { apr: number; apy: number } | null {
  const addr = tokenAddress.toLowerCase()
  if (marketSlug) {
    const scoped = map.get(`${marketSlug}:${addr}`)
    if (scoped) return scoped
  }
  return map.get(addr) ?? null
}

/**
 * Fetch current APY snapshots for all active AAVE v3 markets.
 * Returns SupplyApySpot and BorrowApySpot documents ready for MongoDB upsert.
 * Enriches base APY with AAVE native incentives and Merkl campaigns.
 *
 * One reserve → two documents (supply + borrow).
 */
export async function fetchAaveV3ApySpot(
  chainFilter?: string
): Promise<SpotPayload[]> {
  const config = AAVE_CONFIG.aave_v3
  const client = createGraphQLClient(config.offchainApiUrl!)

  let chainIds = Object.keys(config.chains).map(Number)

  if (chainFilter) {
    const found = Object.entries(config.chains).find(
      ([, c]) => c.name.toLowerCase() === chainFilter.toLowerCase()
    )
    if (!found) {
      console.warn(
        `[cron:aave] Chain filter '${chainFilter}' not found in config`
      )
      return []
    }
    chainIds = [Number(found[0])]
  }

  // Fetch AAVE GraphQL and Merkl in parallel
  const [graphqlResult, merklIncentives] = await Promise.all([
    client
      .query<MarketsApyQuery>(MARKETS_APY, { request: { chainIds } })
      .toPromise(),
    fetchMerklIncentives(chainIds),
  ])

  const { data, error } = graphqlResult

  if (error) {
    throw new Error(`[cron:aave] Failed to fetch APY: ${error.message}`)
  }

  if (!data?.markets) return []

  const snapshots: SpotPayload[] = []

  for (const market of data.markets) {
    for (const reserve of market.reserves) {
      const tokenAddress = reserve.underlyingToken.address
      const tokenSymbol = reserve.underlyingToken.symbol
      const market = reserve.market
      const chain = market.chain
      const marketSlug = AAVE_MARKET_TO_MERKL_SLUG[market.name] ?? null

      // ─── Base rates ────────────────────────────────────────────────────────
      // supplyInfo.apy.value is the supplier's *net* rate (already after the
      // reserveFactor cut). borrowInfo.apy.value is the gross borrow rate.
      const netSupplyApy = Number(reserve.supplyInfo?.apy.value ?? 0)
      const baseBorrowApy = Number(reserve.borrowInfo?.apy.value ?? 0)
      const reserveFactor = Number(
        reserve.borrowInfo?.reserveFactor?.value ?? 0
      )

      // Decompose the net supply rate into a pre-fee base + the protocol cut so
      // that base - fees + rewards === net (supplier's realised rate unchanged).
      //   base = net / (1 - reserveFactor) · fees = base * reserveFactor
      const baseSupplyApy =
        reserveFactor < 1 ? netSupplyApy / (1 - reserveFactor) : netSupplyApy
      const supplyFeesApy = baseSupplyApy * reserveFactor

      // ─── Native AAVE / Merit incentives ────────────────────────────────────
      const supplyRewardItems: RewardItem[] = []
      const borrowRewardItems: RewardItem[] = []

      if (reserve.incentives) {
        for (const inc of reserve.incentives) {
          // AaveSupplyIncentive — has rewardTokenAddress + rewardTokenSymbol
          if ('extraSupplyApr' in inc && inc.extraSupplyApr) {
            const apr = Number(inc.extraSupplyApr.value)
            supplyRewardItems.push({
              token: {
                symbol:
                  'rewardTokenSymbol' in inc
                    ? (inc.rewardTokenSymbol ?? '')
                    : '',
                address:
                  'rewardTokenAddress' in inc
                    ? (inc.rewardTokenAddress ?? '')
                    : '',
              },
              apr,
              apy: aprToApyPerSecond(apr),
              source: 'protocol',
              program: null,
            })
          }

          // AaveBorrowIncentive
          if ('borrowAprDiscount' in inc && inc.borrowAprDiscount) {
            const apr = Number(inc.borrowAprDiscount.value)
            borrowRewardItems.push({
              token: {
                symbol:
                  'rewardTokenSymbol' in inc
                    ? (inc.rewardTokenSymbol ?? '')
                    : '',
                address:
                  'rewardTokenAddress' in inc
                    ? (inc.rewardTokenAddress ?? '')
                    : '',
              },
              apr,
              apy: aprToApyPerSecond(apr),
              source: 'protocol',
              program: null,
            })
          }

          // MeritSupplyIncentive
          if (
            'extraSupplyApr' in inc &&
            inc.extraSupplyApr &&
            !('rewardTokenAddress' in inc)
          ) {
            const apr = Number(inc.extraSupplyApr.value)
            supplyRewardItems.push({
              token: { symbol: 'MERIT', address: '' },
              apr,
              apy: aprToApyDaily(apr),
              source: 'merit',
              program: 'aave-merit',
            })
          }

          // MeritBorrowIncentive
          if (
            'borrowAprDiscount' in inc &&
            inc.borrowAprDiscount &&
            !('rewardTokenAddress' in inc)
          ) {
            const apr = Number(inc.borrowAprDiscount.value)
            borrowRewardItems.push({
              token: { symbol: 'MERIT', address: '' },
              apr,
              apy: aprToApyDaily(apr),
              source: 'merit',
              program: 'aave-merit',
            })
          }

          // MeritBorrowAndSupplyIncentiveCondition
          if ('extraApr' in inc && inc.extraApr) {
            const apr = Number(inc.extraApr.value)
            if ('supplyToken' in inc) {
              supplyRewardItems.push({
                token: { symbol: 'MERIT', address: '' },
                apr,
                apy: aprToApyDaily(apr),
                source: 'merit',
                program: 'aave-merit-conditional',
              })
            }
            if ('borrowToken' in inc) {
              borrowRewardItems.push({
                token: { symbol: 'MERIT', address: '' },
                apr,
                apy: aprToApyDaily(apr),
                source: 'merit',
                program: 'aave-merit-conditional',
              })
            }
          }
        }
      }

      // ─── Merkl incentives ──────────────────────────────────────────────────
      const merklSupply = lookupMerklIncentive(
        merklIncentives.supply,
        marketSlug,
        tokenAddress
      )
      const merklBorrow = lookupMerklIncentive(
        merklIncentives.borrow,
        marketSlug,
        tokenAddress
      )

      if (merklSupply) {
        supplyRewardItems.push({
          token: { symbol: tokenSymbol, address: tokenAddress },
          apr: merklSupply.apr,
          apy: merklSupply.apy,
          source: 'merkl',
          program: `merkl-aave-${marketSlug ?? market.name.toLowerCase()}`,
        })
      }

      if (merklBorrow) {
        borrowRewardItems.push({
          token: { symbol: tokenSymbol, address: tokenAddress },
          apr: merklBorrow.apr,
          apy: merklBorrow.apy,
          source: 'merkl',
          program: `merkl-aave-${marketSlug ?? market.name.toLowerCase()}`,
        })
      }

      // ─── Reward totals ─────────────────────────────────────────────────────
      const totalSupplyRewards = supplyRewardItems.reduce(
        (s, r) => s + r.apy,
        0
      )
      const totalBorrowRewards = borrowRewardItems.reduce(
        (s, r) => s + r.apy,
        0
      )

      // ─── Market state ──────────────────────────────────────────────────────
      const supplyAssetsUsd = Number(reserve.size.usd ?? 0)
      const borrowAssetsUsd = Number(reserve.borrowInfo?.total.usd ?? 0)
      const utilizationRate =
        supplyAssetsUsd > 0 ? borrowAssetsUsd / supplyAssetsUsd : 0
      const assetPriceUsd = Number(reserve.usdExchangeRate ?? 0)

      // ─── Supply document ─────────────────────────────────────────────────────
      const supplyProductId = buildProductId(reserve, 'supply')

      const supplySpot: SpotPayload = {
        productId: supplyProductId,
        kind: 'supply',
        protocol: 'aave',
        chainId: chain.chainId,
        asset: tokenSymbol,
        apy: {
          base: baseSupplyApy,
          rewards: totalSupplyRewards,
          // protocol cut of the supply interest (base * reserveFactor)
          fees: supplyFeesApy,
          // base - fees + rewards === netSupplyApy + rewards (unchanged)
          net: netSupplyApy + totalSupplyRewards,
          rewardItems: supplyRewardItems,
        },
        market: {
          supplyAssets: Number(reserve.size?.amount?.value ?? 0),
          supplyAssetsUsd,
          utilizationRate,
          assetPriceUsd,
        } as SupplyMarketState,
      }

      snapshots.push(supplySpot)

      // ─── Borrow document ───────────────────────────────────────────────────
      // The shared listing rule — the catalogue sync applies the same one, so the
      // two enumerations cannot drift (see ./listing.ts). Without it this loop
      // emitted a borrow snapshot for all 196 reserves while the catalogue
      // registered the 85 that are actually borrowable, and the other 111 wrote
      // ~2,600 orphan rows a day that no query could ever read.
      if (!listsBorrow(reserve)) continue

      const borrowProductId = buildProductId(reserve, 'borrow')

      const borrowSpot: SpotPayload = {
        productId: borrowProductId,
        kind: 'borrow',
        protocol: 'aave',
        chainId: chain.chainId,
        asset: tokenSymbol,
        apy: {
          base: baseBorrowApy,
          rewards: totalBorrowRewards,
          // borrower pays the full borrow rate — reserveFactor is the protocol's
          // cut of the *supply* interest, not a cost to the borrower
          fees: 0,
          net: Math.max(0, baseBorrowApy - totalBorrowRewards),
          rewardItems: borrowRewardItems,
        },
        market: {
          supplyAssets: Number(reserve.size?.amount?.value ?? 0),
          supplyAssetsUsd,
          borrowAssets: Number(reserve.borrowInfo?.total?.amount?.value ?? 0),
          borrowAssetsUsd,
          utilizationRate,
          assetPriceUsd,
          // AAVE is multi-collateral — no single collateral value or price ratio
          collateralAssetsUsd: null,
          priceCollateralInLoanAsset: null,
        } as BorrowMarketState,
      }

      snapshots.push(borrowSpot)
    }
  }

  const borrows = snapshots.filter((s) => s.kind === 'borrow').length
  console.log(
    `[cron:aave] Fetched ${snapshots.length} spot documents (${snapshots.length - borrows} supply + ${borrows} borrow)`
  )
  return snapshots
}
