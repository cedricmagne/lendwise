import { GraphQLScalarType, Kind } from 'graphql'

import { chainName } from '@/lib/chain-names'
import {
  type ApyFilters,
  type ApyOrderBy,
  type Page,
  queryApy,
  queryLatestApy,
} from '@/lib/db/repositories/apy'
import {
  type ProductFilters,
  queryProductFacets,
  queryProducts,
} from '@/lib/db/repositories/products'
import type { ProductRow } from '@/lib/db/schema'

// ─── Scalars ──────────────────────────────────────────────────────────────────

const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize(value) {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    throw new Error('DateTime serializer expected a Date or ISO string')
  },
  parseValue(value) {
    if (typeof value === 'string') return new Date(value)
    throw new Error('DateTime parser expected a string')
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return new Date(ast.value)
    return null
  },
})

const JSON_SCALAR = new GraphQLScalarType({
  name: 'JSON',
  serialize(value) {
    return value
  },
  parseValue(value) {
    return value
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return globalThis.JSON.parse(ast.value)
    return null
  },
})

// ─── Reward items ───────────────────────────────────────────────────────────

type RewardItemRow = {
  token: { symbol: string; address: string }
  apr: number
  apy: number
  source: 'protocol' | 'merkl' | 'merit'
  program: string | null
}

function mapRewardItems(items: RewardItemRow[]) {
  return items.map((r) => ({
    token: r.token,
    apr: r.apr,
    apy: r.apy,
    source: r.source,
    program: r.program ?? null,
  }))
}

// ─── Row + arg shapes ─────────────────────────────────────────────────────────

/** Row shape covering both apy_hourly and apy_daily (drizzle camelCase columns). */
type AnyApyRow = {
  hour?: Date
  date?: Date
  apyBase: number
  apyRewards: number
  apyFees: number
  apyNet: number
  rewardItems: RewardItemRow[]
  supplyAssets: number | null
  supplyAssetsUsd: number | null
  utilizationRate: number | null
  assetPriceUsd: number | null
  borrowAssets: number | null
  borrowAssetsUsd: number | null
  collateralAssetsUsd: number | null
  priceCollateralInLoanAsset: number | null
  qualityCount?: number
  qualityExpectedCount?: number
  qualityFirstSlot?: Date
  qualityLastSlot?: Date
  qualityStatus?: string
}

type AnyFilters = {
  productId?: string
  productIds?: string[]
  protocol?: string
  market?: string
  chainId?: number
  asset?: string
  collateral?: string
  minTvlUsd?: number
  from?: string
  to?: string
  range?: string
}

type ResolverArgs = {
  filters?: AnyFilters
  first?: number
  skip?: number
  orderBy?: ApyOrderBy
  orderDirection?: 'asc' | 'desc'
}

const RANGE_TO_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '1y': 365,
}

// ─── Row → GraphQL mapping ────────────────────────────────────────────────────

function mapProduct(product: ProductRow) {
  return {
    id: product.id,
    active: product.active,
    kind: product.kind,
    asset: {
      symbol: product.assetSymbol,
      name: product.assetName,
      address: product.assetAddress,
      decimals: product.assetDecimals,
    },
    protocol: {
      provider: product.provider,
      type: product.productType,
      version: product.version,
      name: product.protocolName,
      chain: {
        id: product.chainId,
        // chain_name is written inconsistently per adapter; prefer the canonical
        // name for the id and keep the stored one only as a fallback.
        name: chainName(product.chainId, product.chainName),
      },
      address: product.protocolAddress,
      meta: product.meta ?? null,
    },
    collaterals: product.collaterals ?? null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  }
}

function mapPgRow(
  grain: 'hourly' | 'daily',
  isBorrow: boolean,
  { row, product }: { row: AnyApyRow; product: ProductRow }
) {
  const base = {
    ...(grain === 'hourly' ? { hour: row.hour } : { date: row.date }),
    productId: product.id,
    protocol: product.provider,
    chainId: product.chainId,
    asset: product.assetSymbol,
    product: mapProduct(product),
    apy: {
      base: row.apyBase,
      rewards: row.apyRewards,
      fees: row.apyFees,
      net: row.apyNet,
      rewardItems: mapRewardItems(row.rewardItems ?? []),
    },
  }

  const quality =
    grain === 'hourly'
      ? {
          quality: {
            count: row.qualityCount,
            expectedCount: row.qualityExpectedCount,
            firstSlot: row.qualityFirstSlot,
            lastSlot: row.qualityLastSlot,
            status: row.qualityStatus,
          },
        }
      : {}

  const market = isBorrow
    ? {
        supplyAssets: row.supplyAssets,
        supplyAssetsUsd: row.supplyAssetsUsd,
        borrowAssets: row.borrowAssets,
        borrowAssetsUsd: row.borrowAssetsUsd,
        utilizationRate: row.utilizationRate,
        assetPriceUsd: row.assetPriceUsd,
        collateralAssetsUsd: row.collateralAssetsUsd,
        priceCollateralInLoanAsset: row.priceCollateralInLoanAsset,
      }
    : {
        supplyAssets: row.supplyAssets,
        supplyAssetsUsd: row.supplyAssetsUsd,
        utilizationRate: row.utilizationRate,
        assetPriceUsd: row.assetPriceUsd,
      }

  return isBorrow
    ? { ...base, ...quality, collaterals: product.collaterals ?? [], market }
    : { ...base, ...quality, market }
}

// ─── Filtered read (JOIN products on indexed columns — no regex) ───────────────

/** Build the repository filter from GraphQL args. */
function toApyFilters(
  kind: 'supply' | 'borrow',
  filters: AnyFilters
): ApyFilters {
  return {
    kind,
    productId: filters.productId,
    productIds: filters.productIds,
    protocol: filters.protocol,
    market: filters.market,
    chainId: filters.chainId,
    asset: filters.asset,
    collateral: filters.collateral,
    minTvlUsd: filters.minTvlUsd,
    from: filters.from ? new Date(filters.from) : undefined,
    to: filters.to ? new Date(filters.to) : undefined,
  }
}

/**
 * The requested page, passed through unclamped — clamping is the repository's
 * job (`clampPage`), so it cannot be forgotten by a caller. The repository
 * returns what it actually applied, which is what `pagination` reports.
 */
function toPage(
  args: ResolverArgs,
  defaultOrderBy: ApyOrderBy,
  defaultOrderDir: 'asc' | 'desc'
): Page {
  return {
    first: args.first ?? 100,
    skip: args.skip ?? 0,
    orderBy: args.orderBy ?? defaultOrderBy,
    orderDir: args.orderDirection ?? defaultOrderDir,
  }
}

async function resolvePg(
  grain: 'hourly' | 'daily',
  kind: 'supply' | 'borrow',
  args: ResolverArgs
) {
  const filters = args.filters ?? {}
  const f = toApyFilters(kind, filters)
  // `range` is a GraphQL convenience shorthand, so it is resolved here. The
  // window DEFAULT (24h hourly / 30d daily) lives in queryApy, where no caller
  // can bypass it.
  if (grain === 'daily' && !f.from && filters.range) {
    const days = RANGE_TO_DAYS[filters.range] ?? 30
    f.from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  const page = toPage(args, 'time', 'asc')

  const { rows, countTotal, applied } = await queryApy(grain, f, page)
  const isBorrow = kind === 'borrow'
  return {
    items: rows.map((r) =>
      mapPgRow(
        grain,
        isBorrow,
        r as unknown as { row: AnyApyRow; product: ProductRow }
      )
    ),
    pagination: {
      count: rows.length,
      countTotal,
      limit: applied.first,
      skip: applied.skip,
    },
  }
}

// ─── Product registry ────────────────────────────────────────────────────────

type GqlProductFilters = {
  productId?: string
  kind?: string
  protocol?: string
  market?: string
  chainId?: number
  asset?: string
  active?: boolean
}

type ProductQueryArgs = {
  filters?: GqlProductFilters
  first?: number
  skip?: number
}

/**
 * `active` defaults to true: a delisted product is not something a client should
 * be steered into, so it must be asked for explicitly.
 */
function toProductFilters(filters?: GqlProductFilters): ProductFilters {
  const kind = filters?.kind
  return {
    productId: filters?.productId,
    kind: kind === 'supply' || kind === 'borrow' ? kind : undefined,
    protocol: filters?.protocol,
    market: filters?.market,
    chainId: filters?.chainId,
    asset: filters?.asset,
    active: filters?.active ?? true,
  }
}

/** Latest snapshot per product — always hourly rows, best-first by default. */
async function resolveLatest(kind: 'supply' | 'borrow', args: ResolverArgs) {
  const f = toApyFilters(kind, args.filters ?? {})
  // Defaults to apyNet desc (best-first), unlike the time-series queries which
  // default to time asc. These mirror the schema's own defaults.
  const page = toPage(args, 'apyNet', 'desc')

  const { rows, countTotal, applied } = await queryLatestApy(f, page)
  const isBorrow = kind === 'borrow'
  return {
    items: rows.map((r) =>
      mapPgRow(
        'hourly',
        isBorrow,
        r as unknown as { row: AnyApyRow; product: ProductRow }
      )
    ),
    pagination: {
      count: rows.length,
      countTotal,
      limit: applied.first,
      skip: applied.skip,
    },
  }
}

// ─── Resolvers ────────────────────────────────────────────────────────────────

export const resolvers = {
  DateTime,
  JSON: JSON_SCALAR,

  Query: {
    async supplyApyHourly(_: unknown, args: ResolverArgs) {
      return resolvePg('hourly', 'supply', args)
    },
    async supplyApyDaily(_: unknown, args: ResolverArgs) {
      return resolvePg('daily', 'supply', args)
    },
    async borrowApyHourly(_: unknown, args: ResolverArgs) {
      return resolvePg('hourly', 'borrow', args)
    },
    async borrowApyDaily(_: unknown, args: ResolverArgs) {
      return resolvePg('daily', 'borrow', args)
    },

    async latestSupplyApy(_: unknown, args: ResolverArgs) {
      return resolveLatest('supply', args)
    },
    async latestBorrowApy(_: unknown, args: ResolverArgs) {
      return resolveLatest('borrow', args)
    },

    async products(_: unknown, args: ProductQueryArgs) {
      const { rows, countTotal, applied } = await queryProducts(
        toProductFilters(args.filters),
        { first: args.first ?? 100, skip: args.skip ?? 0 }
      )
      return {
        items: rows.map(mapProduct),
        pagination: {
          count: rows.length,
          countTotal,
          limit: applied.first,
          skip: applied.skip,
        },
      }
    },

    async productFacets(_: unknown, args: { filters?: GqlProductFilters }) {
      const { assets, chains, protocols } = await queryProductFacets(
        toProductFilters(args.filters)
      )
      return {
        assets,
        chains: chains.map((c) => ({
          id: c.id,
          name: chainName(c.id, c.fallbackName),
          count: c.count,
        })),
        protocols,
      }
    },
  },
}
