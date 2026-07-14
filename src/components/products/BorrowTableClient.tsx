'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import { useQuery } from '@tanstack/react-query'
import { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRightFromSquare,
  CheckCircle2,
  ChevronRight,
  Search,
  X,
  Zap,
} from 'lucide-react'
import posthog from 'posthog-js'

import { loadBorrowProducts } from '@/app/actions/products.actions'
import { NetworkBadge } from '@/components/badge/NetworkBadge'
import { ProtocolBadge } from '@/components/badge/ProtocolBadge'
import { NetworkIcon, ProtocolIcon, TokenIcon } from '@/components/icon'
import { BorrowingOptimizerView } from '@/components/optimizer/BorrowingOptimizerButton'
import { ProductDetailDrawer } from '@/components/products/ProductDetailDrawer'
import { TableSkeleton } from '@/components/products/TableSkeleton'
import { StatsBar } from '@/components/stats/StatsBar'
import { FilterBar, FilterChip, HorizonPicker } from '@/components/table'
import {
  DataTable,
  SortableHeader,
  getUniqueColumnValues,
} from '@/components/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PieChartMini } from '@/components/ui/pie-chart-mini'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HORIZON_CONFIG, HorizonKey } from '@/config/horizon'
import { getProtocolVersionNameById } from '@/config/protocols'
import { useCurrency } from '@/contexts'
import { formatCompactCurrency } from '@/lib/format-currency'
import {
  computeRateStats,
  findOpportunity,
  formatApy,
  formatMarketLabel,
  formatRateRange,
  pluralize,
} from '@/lib/product-stats'
import { BorrowProduct } from '@/types'

export type Horizon = HorizonKey

const getUtilizationPct = (row: BorrowProduct) => {
  if (!row.assetAmountUsd) return 0
  return (
    ((row.assetAmountUsd - row.liquidityAmountUsd) / row.assetAmountUsd) * 100
  )
}

const isOverutilized = (row: BorrowProduct) => getUtilizationPct(row) > 99

const createColumns = (
  currency: string,
  rate: number,
  horizon: HorizonKey,
  selectedCount: number,
  selectedLoan: string | null,
  commonCollaterals: Set<string> | null
): ColumnDef<BorrowProduct>[] => [
  {
    id: 'select',
    size: 40,
    header: '',
    cell: ({ row }) => {
      const isSelected = row.getIsSelected()
      const isDisabledByUtilization =
        !isSelected && isOverutilized(row.original)
      // Lock the selection to a single loan asset.
      const isDisabledByLoan =
        !isSelected &&
        !isDisabledByUtilization &&
        selectedLoan !== null &&
        row.original.assetSymbol !== selectedLoan
      // Lock the selection to markets sharing a common collateral, so the
      // optimizer always has one collateral to work against.
      const isDisabledByCollateral =
        !isSelected &&
        !isDisabledByUtilization &&
        !isDisabledByLoan &&
        commonCollaterals !== null &&
        commonCollaterals.size > 0 &&
        !row.original.collaterals.some((c) => commonCollaterals.has(c.symbol))
      const isDisabledByLimit =
        !isSelected &&
        !isDisabledByUtilization &&
        !isDisabledByLoan &&
        !isDisabledByCollateral &&
        selectedCount >= 10
      const isDisabled =
        isDisabledByUtilization ||
        isDisabledByLoan ||
        isDisabledByCollateral ||
        isDisabledByLimit

      const checkbox = (
        <Checkbox
          checked={isSelected}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          disabled={isDisabled}
        />
      )

      if (isDisabledByUtilization) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">{checkbox}</span>
            </TooltipTrigger>
            <TooltipContent>
              Utilization &gt;99% — unhealthy market
            </TooltipContent>
          </Tooltip>
        )
      }

      if (isDisabledByLoan) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">{checkbox}</span>
            </TooltipTrigger>
            <TooltipContent>{selectedLoan} loan only</TooltipContent>
          </Tooltip>
        )
      }

      if (isDisabledByCollateral) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">{checkbox}</span>
            </TooltipTrigger>
            <TooltipContent>
              Must share a collateral with your selection
            </TooltipContent>
          </Tooltip>
        )
      }

      return checkbox
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'protocol',
    header: ({ column }) => (
      <SortableHeader column={column}>Protocol</SortableHeader>
    ),
    size: 110,
    minSize: 110,
    enableHiding: false,
    enableSorting: true,
    cell: ({ row }) => <ProtocolBadge protocol={row.original.protocol} />,
  },
  {
    accessorKey: 'network',
    header: ({ column }) => (
      <SortableHeader column={column}>Network</SortableHeader>
    ),
    enableHiding: false,
    enableSorting: true,
    cell: ({ row }) => <NetworkBadge networkSlug={row.original.network} />,
  },
  {
    accessorKey: 'poolName',
    header: '',
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'assetSymbol',
    header: ({ column }) => (
      <SortableHeader column={column}>Loan</SortableHeader>
    ),
    cell: ({ row }) => (
      <div className="flex w-full items-center gap-2">
        <TokenIcon symbol={row.original.assetSymbol} />
        <ProductDetailDrawer item={row.original} kind="borrow" />
      </div>
    ),
    enableHiding: false,
    enableSorting: true,
  },
  {
    accessorKey: 'collaterals',
    header: ({ column }) => (
      <SortableHeader column={column}>Collaterals</SortableHeader>
    ),
    cell: ({ row }) => {
      const collaterals = row.original.collaterals
      if (collaterals.length === 0) return null
      if (collaterals.length === 1) {
        return (
          <div className="flex w-full items-center gap-2">
            <TokenIcon symbol={collaterals[0].symbol} />
            <span>{collaterals[0].symbol}</span>
          </div>
        )
      }
      const MAX_VISIBLE = 4
      const visible = collaterals.slice(0, MAX_VISIBLE)
      const overflow = collaterals.slice(MAX_VISIBLE)
      return (
        <div className="flex w-full items-center gap-1">
          {visible.map((collateral) => (
            <Tooltip key={collateral.symbol}>
              <TooltipTrigger asChild>
                <span>
                  <TokenIcon symbol={collateral.symbol} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{collateral.symbol}</TooltipContent>
            </Tooltip>
          ))}
          {overflow.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground hover:text-foreground inline-flex h-5 cursor-default items-center rounded-md border border-dashed px-1.5 text-xs font-medium transition-colors">
                  +{overflow.length}
                </span>
              </TooltipTrigger>
              <TooltipContent className="bg-secondary text-secondary-foreground border-border min-w-36 border p-2">
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {collaterals.map((collateral) => (
                    <div
                      key={collateral.symbol}
                      className="flex items-center gap-2 py-0.5"
                    >
                      <TokenIcon symbol={collateral.symbol} />
                      <span className="text-xs">{collateral.symbol}</span>
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )
    },
    enableHiding: false,
    enableSorting: false,
  },
  {
    accessorKey: 'assetAmountUsd',
    header: ({ column }) => (
      <SortableHeader column={column}>Deposits</SortableHeader>
    ),
    cell: ({ row }) => (
      <div className="flex w-full items-center gap-3">
        <span className="font-mono">
          {formatCompactCurrency(
            row.original.assetAmount,
            row.original.assetSymbol,
            row.original.assetDecimals
          )}
        </span>
        <Badge variant="outline" className="bg-background font-mono">
          {formatCompactCurrency(row.original.assetAmountUsd * rate, currency)}
        </Badge>
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: 'liquidityAmountUsd',
    header: ({ column }) => (
      <SortableHeader column={column}>Liquidity</SortableHeader>
    ),
    cell: ({ row }) => {
      return (
        <div className="flex w-full items-center gap-3">
          <span className="font-mono">
            {formatCompactCurrency(
              row.original.liquidityAmount,
              row.original.assetSymbol,
              row.original.assetDecimals
            )}
          </span>
          <Badge variant="outline" className="bg-background font-mono">
            {formatCompactCurrency(
              row.original.liquidityAmountUsd * rate,
              currency
            )}
          </Badge>
          <PieChartMini
            percentage={(() => {
              if (!row.original.liquidityAmountUsd) return 100
              const used =
                row.original.assetAmountUsd - row.original.liquidityAmountUsd
              const pct = (used / row.original.assetAmountUsd) * 100
              return Math.min(100, pct)
            })()}
          />
          {isOverutilized(row.original) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Utilization &gt;99% — unhealthy market, cannot be optimized
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )
    },
    enableHiding: false,
  },
  {
    accessorKey: HORIZON_CONFIG[horizon].apyKey,
    header: ({ column }) => (
      <SortableHeader column={column}>
        {HORIZON_CONFIG[horizon].columnHeader}
      </SortableHeader>
    ),
    size: 60,
    enableSorting: true,
    sortingFn: 'basic',
    cell: ({ row }) => {
      const apyValue = row.original[HORIZON_CONFIG[horizon].apyKey] as
        | number
        | undefined
      return (
        <span className="font-mono">
          {apyValue !== undefined && !Number.isNaN(apyValue)
            ? apyValue < 0.0001
              ? '<0.01%'
              : apyValue > 10
                ? '>1000%'
                : `${(apyValue * 100).toFixed(2)}%`
            : '-'}
        </span>
      )
    },
    enableHiding: false,
  },
  {
    id: 'actions',
    size: 80,
    minSize: 80,
    cell: ({ row }) =>
      row.original.link ? (
        <Link
          target="_blank"
          href={row.original.link}
          className="flex w-full items-center justify-center"
        >
          <ArrowUpRightFromSquare size={15} />
        </Link>
      ) : null,
  },
]

export function BorrowTableClient() {
  const { baseCurrency, rate } = useCurrency()
  const [horizon, setHorizon] = useState<Horizon>('intraday')
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [optimizerViewStep, setOptimizerViewStep] = useState<
    'buffer' | 'recommendedLtv' | 'configure'
  >('buffer')
  const [snapshotMarkets, setSnapshotMarkets] = useState<BorrowProduct[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'assetSymbol', value: 'USDC' },
    { id: 'collaterals', value: 'WBTC' },
  ])
  const [searchValue, setSearchValue] = useState('')

  const getRowId = useCallback(
    (row: BorrowProduct) =>
      `${row.protocol}-${row.poolChainId}-${row.poolId}-${row.assetAddress}`,
    []
  )

  // One-way flag: once the user touches any filter/search, auto-selection is disabled forever
  const hasUserInteracted = useRef(false)
  const autoSelectedIds = useRef<Set<string>>(new Set())
  const rowSelectionRef = useRef(rowSelection)
  rowSelectionRef.current = rowSelection

  const { data, isPending } = useQuery<BorrowProduct[]>({
    queryKey: ['borrowProducts'],
    queryFn: loadBorrowProducts,
    staleTime: 60_000,
    refetchInterval: 60_000,
    gcTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!data || data.length === 0) return
    if (hasUserInteracted.current) return

    const collateralFilter = columnFilters.find((f) => f.id === 'collaterals')
      ?.value as string | undefined

    const filtered = data.filter(
      (row) =>
        row.assetSymbol === 'USDC' &&
        !isOverutilized(row) &&
        (!collateralFilter ||
          row.collaterals.some((c) => c.symbol === collateralFilter))
    )
    const sorted = [...filtered].sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
    const top3 = sorted.slice(0, 3)
    if (top3.length === 0) return

    const newTopIds = new Set(top3.map(getRowId))

    if (autoSelectedIds.current.size === 0) {
      // First load: always auto-select top 3
      autoSelectedIds.current = newTopIds
      const selection: Record<string, boolean> = {}
      for (const id of newTopIds) selection[id] = true
      setRowSelection(selection)
      return
    }

    // Refetch: only update if the user hasn't changed the selection via checkboxes
    const currentIds = new Set(
      Object.keys(rowSelectionRef.current).filter(
        (k) => rowSelectionRef.current[k]
      )
    )
    const isStillAutoSelection =
      currentIds.size === autoSelectedIds.current.size &&
      [...currentIds].every((id) => autoSelectedIds.current.has(id))

    if (isStillAutoSelection) {
      autoSelectedIds.current = newTopIds
      const selection: Record<string, boolean> = {}
      for (const id of newTopIds) selection[id] = true
      setRowSelection(selection)
    }
  }, [data, getRowId, columnFilters])

  // Wrap filter setter: marks user interaction and clears selection
  const handleFiltersChange = useCallback((newFilters: ColumnFiltersState) => {
    hasUserInteracted.current = true
    setRowSelection({})
    setColumnFilters(newFilters)
    if (newFilters.length > 0) {
      posthog.capture('borrow_table_filter_applied', {
        filters: newFilters.map((f) => ({ column: f.id, value: f.value })),
        filter_count: newFilters.length,
      })
    }
  }, [])

  // Stats-bar CTA: narrow the table down to the one market the card names. The
  // collateral filter is dropped on purpose — keeping it would filter the very
  // market we are pointing the user at back out of the table.
  const jumpToMarket = useCallback((market: BorrowProduct) => {
    hasUserInteracted.current = true
    setRowSelection({})
    setSearchValue('')
    setColumnFilters([
      { id: 'protocol', value: [market.protocol] },
      { id: 'network', value: [market.network] },
      { id: 'assetSymbol', value: market.assetSymbol },
    ])
    posthog.capture('borrow_stats_opportunity_clicked', {
      protocol: market.protocol,
      network: market.network,
      asset: market.assetSymbol,
    })
  }, [])

  // Selection lock: all selected rows must share the same loan asset and at
  // least one common collateral (running intersection across the selection).
  const selectedRows = (data ?? []).filter((row) => rowSelection[getRowId(row)])
  const selectedLoan = selectedRows[0]?.assetSymbol ?? null
  const commonCollaterals = (() => {
    if (selectedRows.length === 0) return null
    let acc = new Set<string>(selectedRows[0].collaterals.map((c) => c.symbol))
    for (const row of selectedRows.slice(1)) {
      const syms = new Set(row.collaterals.map((c) => c.symbol))
      acc = new Set([...acc].filter((s) => syms.has(s)))
    }
    return acc
  })()

  const columns = createColumns(
    baseCurrency,
    rate,
    horizon,
    Object.keys(rowSelection).length,
    selectedLoan,
    commonCollaterals
  )
  const sortColumn = HORIZON_CONFIG[horizon].apyKey as string

  const markets = data || []

  // For non-intraday horizons, hide rows without enough historical data in MongoDB
  const visibleMarkets =
    horizon === 'intraday'
      ? markets
      : markets.filter((m) => m[HORIZON_CONFIG[horizon].apyKey] !== undefined)

  const selectedData = visibleMarkets.filter(
    (row) => rowSelection[getRowId(row)]
  )

  const isFiltered = columnFilters.length > 0 || searchValue !== ''
  const activeFilterCount =
    columnFilters.reduce(
      (n, f) => n + (Array.isArray(f.value) ? f.value.length : 1),
      0
    ) + (searchValue !== '' ? 1 : 0)

  // Filter options
  const protocolOptions = getUniqueColumnValues(visibleMarkets, 'protocol').map(
    (v) => ({
      value: v as string,
      label: (
        <div className="flex items-center gap-2">
          <ProtocolIcon protocol={v as string} />{' '}
          {getProtocolVersionNameById(v)}
        </div>
      ),
    })
  )
  const networkOptions = getUniqueColumnValues(visibleMarkets, 'network').map(
    (v) => ({
      value: v as string,
      label: (
        <div className="flex items-center gap-2">
          <NetworkIcon networkSlug={v as string} />
          {(v as string).charAt(0).toUpperCase() + (v as string).slice(1)}
        </div>
      ),
    })
  )
  const tokenOptions = getUniqueColumnValues(visibleMarkets, 'assetSymbol').map(
    (v) => ({
      value: v as string,
      label: (
        <div className="flex items-center gap-2">
          <TokenIcon symbol={v as string} /> {v}
        </div>
      ),
    })
  )
  const collateralOptions = Array.from(
    new Set(
      visibleMarkets.flatMap((row) => row.collaterals.map((c) => c.symbol))
    )
  )
    .sort()
    .map((symbol) => ({
      value: symbol,
      label: (
        <div className="flex items-center gap-2">
          <TokenIcon symbol={symbol} /> {symbol}
        </div>
      ),
    }))

  // Text search predicate — mirrors DataTable's globalFilter (poolName,
  // assetSymbol, and collateral symbols).
  const matchesSearch = (m: BorrowProduct) => {
    if (searchValue === '') return true
    const q = searchValue.toLowerCase()
    return (
      m.poolName.toLowerCase().includes(q) ||
      m.assetSymbol.toLowerCase().includes(q) ||
      m.collaterals.some((c) => c.symbol.toLowerCase().includes(q))
    )
  }

  // Faceted counts: apply text search + all active filters EXCEPT the target
  // column's own filter, so each chip shows "how many results you'd get by
  // picking that option".
  const applyFiltersExcept = (excludeId: string) =>
    visibleMarkets.filter(
      (m) =>
        matchesSearch(m) &&
        columnFilters.every((f) => {
          if (f.id === excludeId) return true
          if (f.id === 'collaterals') {
            const v = f.value as string
            return m.collaterals.some((c) => c.symbol === v)
          }
          const cell = String(m[f.id as keyof BorrowProduct] ?? '')
          return Array.isArray(f.value)
            ? (f.value as string[]).includes(cell)
            : cell === String(f.value)
        })
    )

  const protocolCounts = applyFiltersExcept('protocol').reduce((acc, m) => {
    acc.set(m.protocol, (acc.get(m.protocol) ?? 0) + 1)
    return acc
  }, new Map<string, number>())

  const networkCounts = applyFiltersExcept('network').reduce((acc, m) => {
    acc.set(m.network, (acc.get(m.network) ?? 0) + 1)
    return acc
  }, new Map<string, number>())

  const tokenCounts = applyFiltersExcept('assetSymbol').reduce((acc, m) => {
    acc.set(m.assetSymbol, (acc.get(m.assetSymbol) ?? 0) + 1)
    return acc
  }, new Map<string, number>())

  const collateralCounts = applyFiltersExcept('collaterals').reduce(
    (acc, m) => {
      m.collaterals.forEach((c) => {
        acc.set(c.symbol, (acc.get(c.symbol) ?? 0) + 1)
      })
      return acc
    },
    new Map<string, number>()
  )

  // The bar is deliberately market-wide, not table-wide: it is what tells a user
  // filtering on USDC that another market borrows cheaper. `note` carries their
  // filtered figure so the two can never be mistaken for one another, and the
  // cheapest-rate card jumps them to the market it names.
  const filteredMarkets = applyFiltersExcept('')
  const stats = computeRateStats(visibleMarkets, horizon)
  const filteredStats = computeRateStats(filteredMarkets, horizon)
  const opportunity = isFiltered
    ? findOpportunity(stats, filteredStats, 'lowest')
    : null
  const horizonLabel = HORIZON_CONFIG[horizon].label

  if (isPending) return <TableSkeleton variant="borrow" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Stats bar */}

      <StatsBar
        stats={[
          {
            label: 'All markets',
            value: stats.count.toString(),
            sub: `${pluralize(stats.protocols, 'protocol')} · ${pluralize(stats.networks, 'network')} · ${pluralize(stats.assets, 'asset')}`,
            note: isFiltered
              ? `${filteredStats.count} match your filter`
              : undefined,
          },
          {
            label: `Cheapest rate · ${horizonLabel}`,
            value: formatApy(stats.lowest?.value),
            sub: formatMarketLabel(
              stats.lowest?.item,
              getProtocolVersionNameById
            ),
            accent: true,
            note: opportunity
              ? `your filter: ${formatApy(opportunity.filteredValue)} — ${opportunity.deltaPts.toFixed(2)} pts cheaper here`
              : isFiltered
                ? 'your filter holds the cheapest rate'
                : undefined,
            noteAccent: opportunity !== null,
            onClick: opportunity
              ? () => jumpToMarket(opportunity.item)
              : undefined,
          },
          {
            label: `Median rate · ${horizonLabel}`,
            value: formatApy(stats.median),
            sub: formatRateRange(stats),
            note: isFiltered
              ? `your filter: ${formatApy(filteredStats.median)}`
              : undefined,
          },
          {
            label: 'Available liquidity',
            value: formatCompactCurrency(
              stats.totalLiquidityUsd * rate,
              baseCurrency
            ),
            sub:
              stats.utilizationPct !== null
                ? `${stats.utilizationPct.toFixed(1)}% of ${formatCompactCurrency(stats.totalDepositsUsd * rate, baseCurrency)} deposits borrowed`
                : undefined,
            note: isFiltered
              ? `your filter: ${formatCompactCurrency(filteredStats.totalLiquidityUsd * rate, baseCurrency)}`
              : undefined,
          },
        ]}
      />

      {/* Page header: title left + all controls right */}
      <div className="border-border/50 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-8 py-5">
        <div>
          <h1 className="text-foreground text-xl font-bold">Borrow products</h1>
          <p className="text-muted-foreground text-xs">
            All available borrowing markets across protocols and chains
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {/* Optimize */}
          {Object.keys(rowSelection).length > 0 && (
            <Dialog
              open={isModalOpen}
              onOpenChange={(open) => {
                setIsModalOpen(open)
                if (!open) {
                  setModalStep(1)
                  setOptimizerViewStep('buffer')
                  setSnapshotMarkets([])
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 text-xs">
                  <Zap className="h-3.5 w-3.5" />
                  Optimize ({Object.keys(rowSelection).length})
                </Button>
              </DialogTrigger>
              <DialogContent
                showCloseButton={false}
                className="gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-4xl"
              >
                <DialogTitle className="sr-only">Borrow Optimizer</DialogTitle>
                <DialogDescription className="sr-only">
                  Review selected markets and configure your borrowing objective
                </DialogDescription>
                {/* Custom header */}
                <div className="border-border flex items-start justify-between border-b px-7 pt-6 pb-5">
                  <div>
                    <div className="mb-1 flex items-center gap-2.5">
                      <div className="bg-primary/15 flex h-7 w-7 items-center justify-center rounded-lg">
                        <ArrowLeftRight className="text-primary h-4 w-4" />
                      </div>
                      <h2 className="text-base font-semibold">
                        Borrow Optimizer
                      </h2>
                    </div>
                    <p className="text-muted-foreground ml-9 text-xs">
                      {modalStep === 1
                        ? `${selectedData.length} market${selectedData.length !== 1 ? 's' : ''} selected — review before optimizing`
                        : optimizerViewStep === 'buffer'
                          ? 'Set your liquidation threshold and buffer'
                          : optimizerViewStep === 'recommendedLtv'
                            ? 'Set your recommended LTV per market'
                            : 'Configure your objective — results update on the right'}
                    </p>
                  </div>

                  {/* Stepper */}
                  {(() => {
                    const currentStep =
                      modalStep === 1
                        ? 1
                        : optimizerViewStep === 'buffer'
                          ? 2
                          : optimizerViewStep === 'recommendedLtv'
                            ? 3
                            : 4
                    const steps = [
                      { step: 1, label: 'Selection' },
                      { step: 2, label: 'Buffer' },
                      { step: 3, label: 'LTV' },
                      { step: 4, label: 'Configure' },
                    ]
                    return (
                      <div className="mr-6 flex items-center gap-1">
                        {steps.map((s, i) => (
                          <div key={s.step} className="flex items-center gap-1">
                            {i > 0 && (
                              <div
                                className={`mx-1 h-px w-8 transition-colors ${currentStep > s.step - 1 ? 'bg-primary/40' : 'bg-border'}`}
                              />
                            )}
                            <div
                              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                                currentStep === s.step
                                  ? 'bg-primary text-primary-foreground'
                                  : currentStep > s.step
                                    ? 'bg-primary/20 text-primary'
                                    : 'bg-secondary text-muted-foreground'
                              }`}
                            >
                              {currentStep > s.step ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                s.step
                              )}
                            </div>
                            <span
                              className={`text-xs font-medium ${currentStep === s.step ? 'text-foreground' : 'text-muted-foreground'}`}
                            >
                              {s.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  <DialogClose className="hover:bg-secondary/60 rounded-lg p-1.5 transition-colors">
                    <X className="text-muted-foreground h-4 w-4" />
                  </DialogClose>
                </div>

                {/* Body */}
                {modalStep === 1 ? (
                  <div className="flex flex-col">
                    {/* Sticky column headers — inner row mirrors the data
                        card's box model (border + p-3.5) so columns line up. */}
                    <div className="border-border/40 border-b px-7">
                      <div className="flex items-center gap-4 border border-transparent px-3.5 pt-4 pb-2.5">
                        <div className="w-1 shrink-0" />
                        <span className="text-muted-foreground/70 w-32 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                          Protocol
                        </span>
                        <span className="text-muted-foreground/70 w-24 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                          Network
                        </span>
                        <span className="text-muted-foreground/70 flex-1 text-[11px] font-semibold tracking-wider uppercase">
                          Market
                        </span>
                        <span className="text-muted-foreground/70 w-24 text-right text-[11px] font-semibold tracking-wider uppercase">
                          Liquidity
                        </span>
                        {['1D', '7D', '1M', '1Y'].map((label) => (
                          <span
                            key={label}
                            className="text-muted-foreground/70 w-16 text-right text-[11px] font-semibold tracking-wider uppercase"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Scrollable rows */}
                    <div className="max-h-[30rem] space-y-2 overflow-y-auto px-7 py-4">
                      {selectedData.map((pool) => {
                        const apyCols = [
                          { key: '1d', value: pool.apy },
                          { key: '7d', value: pool.apyDaily },
                          { key: '1m', value: pool.apyMonthly },
                          { key: '1y', value: pool.apyYearly },
                        ]
                        return (
                          <div
                            key={`${pool.protocol}-${pool.poolChainId}-${pool.poolId}-${pool.assetAddress}`}
                            className="border-border/50 hover:border-border bg-secondary/30 flex items-center gap-4 rounded-xl border p-3.5 transition-colors"
                          >
                            <div className="from-primary to-primary/30 h-10 w-1 shrink-0 rounded-full bg-linear-to-b" />
                            <div className="w-32 shrink-0">
                              <ProtocolBadge protocol={pool.protocol} />
                            </div>
                            <div className="w-24 shrink-0">
                              <NetworkBadge networkSlug={pool.network} />
                            </div>
                            <span className="text-foreground flex-1 truncate text-sm font-medium">
                              {pool.poolName}
                            </span>
                            <span className="text-muted-foreground w-24 text-right font-mono text-xs">
                              {formatCompactCurrency(
                                pool.liquidityAmountUsd * rate,
                                baseCurrency
                              )}
                            </span>
                            {apyCols.map(({ key, value }) => (
                              <span
                                key={key}
                                className={`w-16 text-right font-mono text-xs font-semibold ${
                                  value === undefined || Number.isNaN(value)
                                    ? 'text-muted-foreground/40'
                                    : value > 0.5
                                      ? 'text-orange-400'
                                      : value > 0.1
                                        ? 'text-emerald-400'
                                        : 'text-muted-foreground'
                                }`}
                              >
                                {value === undefined || Number.isNaN(value)
                                  ? '—'
                                  : value < 0.0001
                                    ? '<0.01%'
                                    : value > 10
                                      ? '>1000%'
                                      : `${(value * 100).toFixed(2)}%`}
                              </span>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                    <div className="border-border/40 flex justify-end border-t px-7 py-4">
                      <Button
                        onClick={() => {
                          setSnapshotMarkets(selectedData)
                          setModalStep(2)
                        }}
                      >
                        Configure Optimizer
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="px-7 py-2">
                    <BorrowingOptimizerView
                      markets={snapshotMarkets}
                      selectedCollateralSymbol={
                        columnFilters.find((f) => f.id === 'collaterals')
                          ?.value as string | undefined
                      }
                      onBack={() => {
                        setModalStep(1)
                        setOptimizerViewStep('configure')
                      }}
                      onViewStepChange={setOptimizerViewStep}
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}

          <FilterBar activeCount={activeFilterCount}>
            {/* Search */}
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
              <Input
                placeholder="Filter..."
                value={searchValue}
                onChange={(e) => {
                  hasUserInteracted.current = true
                  setRowSelection({})
                  setSearchValue(e.target.value)
                }}
                className="h-9 w-36 pl-7 text-xs placeholder:text-xs"
              />
            </div>

            {/* Horizon */}
            <HorizonPicker value={horizon} onChange={setHorizon} />

            {/* Filter chips */}
            <FilterChip
              title="Protocol"
              columnId="protocol"
              options={protocolOptions}
              columnFilters={columnFilters}
              onColumnFiltersChange={handleFiltersChange}
              renderIcon={(v) => <ProtocolIcon protocol={v} />}
              counts={protocolCounts}
            />
            <FilterChip
              title="Network"
              columnId="network"
              options={networkOptions}
              columnFilters={columnFilters}
              onColumnFiltersChange={handleFiltersChange}
              renderIcon={(v) => <NetworkIcon networkSlug={v} />}
              counts={networkCounts}
            />
            <FilterChip
              title="Loan"
              columnId="assetSymbol"
              options={tokenOptions}
              multiSelect={false}
              columnFilters={columnFilters}
              onColumnFiltersChange={handleFiltersChange}
              renderIcon={(v) => <TokenIcon symbol={v} />}
              counts={tokenCounts}
            />
            <FilterChip
              title="Collateral"
              columnId="collaterals"
              options={collateralOptions}
              multiSelect={false}
              columnFilters={columnFilters}
              onColumnFiltersChange={handleFiltersChange}
              renderIcon={(v) => <TokenIcon symbol={v} />}
              counts={collateralCounts}
            />

            {/* Reset */}
            <Button
              variant="ghost"
              size="sm"
              className="bg-input/50 border-border h-9 cursor-pointer border px-2 text-xs"
              onClick={() => {
                hasUserInteracted.current = true
                setRowSelection({})
                setColumnFilters([])
                setSearchValue('')
              }}
              disabled={isFiltered ? false : true}
            >
              <X className="h-4 w-4" />
            </Button>
          </FilterBar>
        </div>
      </div>

      <DataTable
        key={horizon}
        fillHeight
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        hiddenColumns={['poolName']}
        searchableColumns={{
          columns: ['poolName', 'assetSymbol'],
          getExtraSearchValues: (row) => row.collaterals.map((c) => c.symbol),
        }}
        filterableColumns={[
          { column: 'protocol', title: 'Protocol', options: protocolOptions },
          { column: 'network', title: 'Network', options: networkOptions },
          {
            column: 'assetSymbol',
            title: 'Token',
            multiSelect: false,
            options: tokenOptions,
          },
          {
            column: 'collaterals',
            title: 'Collateral',
            multiSelect: false,
            getFilterValues: (row: BorrowProduct) =>
              row.collaterals.map((c) => c.symbol),
            options: collateralOptions,
          },
        ]}
        columns={columns}
        data={visibleMarkets}
        initialSorting={[{ id: sortColumn, desc: true }]}
        getRowId={getRowId}
        hideToolbar={true}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        globalFilter={searchValue}
        onGlobalFilterChange={setSearchValue}
        getRowClassName={(row) =>
          isOverutilized(row) ? 'bg-red-500/8 hover:bg-red-500/12' : ''
        }
      />
    </div>
  )
}
