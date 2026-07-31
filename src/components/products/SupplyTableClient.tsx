'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import {
  AlertTriangle,
  ArrowUpRightFromSquare,
  CheckCircle2,
  ChevronRight,
  Gift,
  Search,
  X,
  Zap,
} from 'lucide-react'
import posthog from 'posthog-js'

import { loadSupplyProducts } from '@/app/actions/products.actions'
import { NetworkBadge } from '@/components/badge/NetworkBadge'
import { ProtocolBadge } from '@/components/badge/ProtocolBadge'
import { NetworkIcon, ProtocolIcon, TokenIcon } from '@/components/icon'
import { SupplyingOptimizerView } from '@/components/optimizer/SupplyingOptimizerButton'
import { ProductDetailDrawer } from '@/components/products/ProductDetailDrawer'
import { TableSkeleton } from '@/components/products/TableSkeleton'
import { StatsBar } from '@/components/stats/StatsBar'
import {
  FilterBar,
  FilterBuilder,
  FilterChip,
  HorizonPicker,
  RefreshButton,
} from '@/components/table'
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
import { protocolVersionName } from '@/config/protocols-meta'
import {
  DEFAULT_MAX_ABS_NET_APY,
  DEFAULT_SUPPLY_FILTERS,
} from '@/config/table-filters'
import { useCurrency } from '@/contexts'
import { useTableFilters } from '@/hooks/useTableFilters'
import { formatCompactCurrency } from '@/lib/format-currency'
import {
  computeRateStats,
  findOpportunity,
  formatApy,
  formatMarketLabel,
  formatRateRange,
  pluralize,
} from '@/lib/product-stats'
import {
  SUPPLY_FILTERS_KEY,
  fieldValue,
  matchesFilters,
} from '@/lib/table-filters'
import { SupplyProduct } from '@/types'

export type Horizon = HorizonKey

// Derived from the filter registry, so the Utilization column and the
// Utilization filter cannot mean two different things.
const getUtilizationPct = (row: SupplyProduct) =>
  (fieldValue(row, 'utilization', 'intraday') ?? 0) * 100

const isOverutilized = (row: SupplyProduct) => getUtilizationPct(row) > 99

const createColumns = (
  currency: string,
  rate: number,
  horizon: HorizonKey,
  selectedCount: number,
  selectedAsset: string | null
): ColumnDef<SupplyProduct>[] => [
  {
    id: 'select',
    size: 40,
    header: '',
    cell: ({ row }) => {
      const isSelected = row.getIsSelected()
      const isDisabledByUtilization =
        !isSelected && isOverutilized(row.original)
      const isDisabledByAsset =
        !isSelected &&
        !isDisabledByUtilization &&
        selectedAsset !== null &&
        row.original.assetSymbol !== selectedAsset
      const isDisabledByLimit =
        !isSelected && !isDisabledByUtilization && selectedCount >= 10
      const isDisabled =
        isDisabledByUtilization || isDisabledByAsset || isDisabledByLimit

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

      if (isDisabledByAsset) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">{checkbox}</span>
            </TooltipTrigger>
            <TooltipContent>{selectedAsset}-only selection</TooltipContent>
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
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    cell: ({ row }) => (
      <div className="flex w-full items-center gap-2">
        <TokenIcon symbol={row.original.assetSymbol} />
        <ProductDetailDrawer item={row.original} kind="supply" />
      </div>
    ),
    enableHiding: false,
    enableSorting: true,
  },
  {
    accessorKey: 'assetSymbol',
    header: '',
    enableSorting: false,
    enableHiding: false,
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
    cell: ({ row }) => (
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
      </div>
    ),
    enableHiding: false,
  },
  {
    id: 'utilization',
    accessorFn: (row) => getUtilizationPct(row),
    header: ({ column }) => (
      <SortableHeader column={column}>Utilization</SortableHeader>
    ),
    cell: ({ row }) => (
      <div className="flex items-center">
        <PieChartMini
          percentage={Math.min(
            100,
            Math.max(0, getUtilizationPct(row.original))
          )}
        />
        <span className="inline-flex w-3.5 shrink-0 items-center">
          {isOverutilized(row.original) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              </TooltipTrigger>
              <TooltipContent>
                Utilization &gt;99% — unhealthy market, cannot be optimized
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
    ),
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
      const rewardsValue = row.original[HORIZON_CONFIG[horizon].rewardsKey] as
        | number
        | undefined
      const hasRewards = rewardsValue !== undefined && rewardsValue > 0
      return (
        <div className="flex items-center gap-1.5">
          <span className="font-mono">{formatApy(apyValue)}</span>
          <span className="inline-flex w-3.5 shrink-0 items-center">
            {hasRewards && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Gift className="h-3.5 w-3.5 text-emerald-400" />
                </TooltipTrigger>
                <TooltipContent>
                  Includes {(rewardsValue * 100).toFixed(2)}% of token rewards
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        </div>
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
        <a
          target="_blank"
          rel="noopener noreferrer"
          href={row.original.link}
          className="flex w-full items-center justify-center"
        >
          <ArrowUpRightFromSquare size={15} />
        </a>
      ) : null,
  },
]

export function SupplyTableClient() {
  const { baseCurrency, rate } = useCurrency()
  const [horizon, setHorizon] = useState<Horizon>('intraday')
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalStep, setModalStep] = useState(1)
  const [snapshotMarkets, setSnapshotMarkets] = useState<SupplyProduct[]>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    { id: 'assetSymbol', value: 'USDC' },
  ])
  const [searchValue, setSearchValue] = useState('')

  const {
    filters: tableFilters,
    setFilters: setTableFilters,
    clear: clearTableFilters,
    reset: resetTableFilters,
  } = useTableFilters(SUPPLY_FILTERS_KEY, DEFAULT_SUPPLY_FILTERS)

  const getRowId = useCallback(
    (row: SupplyProduct) =>
      `${row.protocol}-${row.poolChainId}-${row.poolId}-${row.assetAddress}`,
    []
  )

  // One-way flag: once the user touches any filter/search, auto-selection is disabled forever
  const hasUserInteracted = useRef(false)
  const autoSelectedIds = useRef<Set<string>>(new Set())
  const rowSelectionRef = useRef(rowSelection)
  rowSelectionRef.current = rowSelection

  const { data, isPending, isFetching, dataUpdatedAt, refetch } = useQuery<
    SupplyProduct[]
  >({
    queryKey: ['supplyProducts'],
    queryFn: loadSupplyProducts,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    gcTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!data || data.length === 0) return
    if (hasUserInteracted.current) return

    // Candidates must come from `visibleMarkets`, not the raw `data` fetch:
    // everything else on the page (the table, StatsBar, faceted counts) reads
    // `visibleMarkets`, and auto-selecting a row the active filters have
    // already hidden opens the Optimize button on a selection the user never
    // sees on screen.
    const filtered = visibleMarkets.filter(
      (row) => row.assetSymbol === 'USDC' && !isOverutilized(row)
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
  }, [data, getRowId, tableFilters])

  // Wrap filter setter: marks user interaction and clears selection
  const handleFiltersChange = useCallback((newFilters: ColumnFiltersState) => {
    hasUserInteracted.current = true
    setRowSelection({})
    setColumnFilters(newFilters)
    if (newFilters.length > 0) {
      posthog.capture('supply_table_filter_applied', {
        filters: newFilters.map((f) => ({ column: f.id, value: f.value })),
        filter_count: newFilters.length,
      })
    }
  }, [])

  const handleRefresh = useCallback(() => {
    posthog.capture('supply_table_refreshed')
    void refetch()
  }, [refetch])

  // Stats-bar CTA: narrow the table down to the one market the card names.
  const jumpToMarket = useCallback((market: SupplyProduct) => {
    hasUserInteracted.current = true
    setRowSelection({})
    setSearchValue('')
    setColumnFilters([
      { id: 'protocol', value: [market.protocol] },
      { id: 'network', value: [market.network] },
      { id: 'assetSymbol', value: market.assetSymbol },
    ])
    posthog.capture('supply_stats_opportunity_clicked', {
      protocol: market.protocol,
      network: market.network,
      asset: market.assetSymbol,
    })
  }, [])

  const selectedAsset = (() => {
    if (!data) return null
    const selectedRows = data.filter((row) => rowSelection[getRowId(row)])
    return selectedRows.length > 0 ? selectedRows[0].assetSymbol : null
  })()

  const columns = createColumns(
    baseCurrency,
    rate,
    horizon,
    Object.keys(rowSelection).length,
    selectedAsset
  )

  const sortColumn = HORIZON_CONFIG[horizon].apyKey as string

  /**
   * The rows the user is looking at.
   *
   * The numeric predicates are applied HERE rather than through TanStack's
   * `columnFilters`, for two reasons. A per-column `filterFn` would be a THIRD
   * writer of a predicate the whole design says there are two of. And
   * `ColumnFiltersState` holds one entry per column, while Net APY carries two
   * bounds by default.
   *
   * Filtering here also keeps everything downstream honest for free: the
   * StatsBar, the faceted counts and the top-3 auto-selection all read this
   * array, so the headline always describes the lines below it.
   */
  const markets = data || []

  const withHorizonData =
    horizon === 'intraday'
      ? markets
      : markets.filter((m) => m[HORIZON_CONFIG[horizon].apyKey] !== undefined)

  const visibleMarkets = withHorizonData.filter((m) =>
    matchesFilters(m, tableFilters, horizon)
  )

  const selectedData = visibleMarkets.filter(
    (row) => rowSelection[getRowId(row)]
  )

  const isFiltered =
    columnFilters.length > 0 || searchValue !== '' || tableFilters.length > 0
  const activeFilterCount =
    columnFilters.reduce(
      (n, f) => n + (Array.isArray(f.value) ? f.value.length : 1),
      0
    ) +
    (searchValue !== '' ? 1 : 0) +
    tableFilters.length

  // Filter options
  const protocolOptions = getUniqueColumnValues(visibleMarkets, 'protocol').map(
    (v) => ({
      value: v as string,
      label: (
        <div className="flex items-center gap-2">
          <ProtocolIcon protocol={v as string} />
          {protocolVersionName(v)}
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

  // Text search predicate — mirrors DataTable's globalFilter (poolName only)
  const matchesSearch = (m: SupplyProduct) =>
    searchValue === '' ||
    m.poolName.toLowerCase().includes(searchValue.toLowerCase())

  // Faceted counts: apply text search + all active filters except the target column
  const applyFiltersExcept = (excludeId: string) =>
    visibleMarkets.filter(
      (m) =>
        matchesSearch(m) &&
        columnFilters.every((f) => {
          if (f.id === excludeId) return true
          const cell = String(m[f.id as keyof SupplyProduct] ?? '')
          return Array.isArray(f.value)
            ? (f.value as string[]).includes(cell)
            : cell === String(f.value)
        })
    )

  const protocolCounts = new Map<string, number>(
    protocolOptions
      .map((o) => o.value)
      .map((v) => [
        v,
        applyFiltersExcept('protocol').filter((m) => m.protocol === v).length,
      ])
  )
  const networkCounts = new Map<string, number>(
    networkOptions
      .map((o) => o.value)
      .map((v) => [
        v,
        applyFiltersExcept('network').filter((m) => m.network === v).length,
      ])
  )
  const tokenCounts = new Map<string, number>(
    tokenOptions
      .map((o) => o.value)
      .map((v) => [
        v,
        applyFiltersExcept('assetSymbol').filter((m) => m.assetSymbol === v)
          .length,
      ])
  )

  // The bar is deliberately market-wide, not table-wide: it is what tells a user
  // filtering on USDC that ETH pays more somewhere else. `note` carries their
  // filtered figure so the two can never be mistaken for one another, and the
  // best-rate card jumps them to the market it names.
  const filteredMarkets = applyFiltersExcept('')
  // The active Net APY ceiling, not the shipped default: a user who raises it
  // in FilterBuilder has already let those rows into `visibleMarkets`, and
  // the stats ceiling must not silently exclude them again.
  const activeMaxAbsNetApy =
    tableFilters.find((f) => f.field === 'netApy' && f.op === 'lte')?.value ??
    DEFAULT_MAX_ABS_NET_APY
  const stats = computeRateStats(visibleMarkets, horizon, activeMaxAbsNetApy)
  const filteredStats = computeRateStats(
    filteredMarkets,
    horizon,
    activeMaxAbsNetApy
  )
  const opportunity = isFiltered
    ? findOpportunity(stats, filteredStats, 'highest')
    : null
  const horizonLabel = HORIZON_CONFIG[horizon].label

  if (isPending) return <TableSkeleton variant="supply" />

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
            label: `Best APY · ${horizonLabel}`,
            value: formatApy(stats.highest?.value),
            sub: formatMarketLabel(stats.highest?.item, protocolVersionName),
            accent: true,
            note: opportunity
              ? `your filter: ${formatApy(opportunity.filteredValue)} — +${opportunity.deltaPts.toFixed(2)} pts here`
              : isFiltered
                ? 'your filter holds the best rate'
                : undefined,
            noteAccent: opportunity !== null,
            onClick: opportunity
              ? () => jumpToMarket(opportunity.item)
              : undefined,
          },
          {
            label: `Median APY · ${horizonLabel}`,
            value: formatApy(stats.median),
            sub: formatRateRange(stats),
            note: isFiltered
              ? `your filter: ${formatApy(filteredStats.median)}`
              : undefined,
          },
          {
            label: 'Total deposits',
            value: formatCompactCurrency(
              stats.totalDepositsUsd * rate,
              baseCurrency
            ),
            note: isFiltered
              ? `your filter: ${formatCompactCurrency(filteredStats.totalDepositsUsd * rate, baseCurrency)}`
              : undefined,
            sub:
              stats.utilizationPct !== null
                ? `${stats.utilizationPct.toFixed(1)}% utilized · ${formatCompactCurrency(stats.totalLiquidityUsd * rate, baseCurrency)} withdrawable`
                : undefined,
          },
        ]}
      />

      {/* Page header: title left + all controls right */}
      <div className="border-border/50 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-8 py-5">
        <div>
          <h1 className="text-foreground text-xl font-bold">Supply products</h1>
          <p className="text-muted-foreground text-xs">
            All available supplying products across protocols and chains
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
                <DialogTitle className="sr-only">Supply Optimizer</DialogTitle>
                <DialogDescription className="sr-only">
                  Review selected markets and configure your supply objective
                </DialogDescription>
                {/* Custom header */}
                <div className="border-border flex items-start justify-between border-b px-7 pt-6 pb-5">
                  <div>
                    <div className="mb-1 flex items-center gap-2.5">
                      <div className="bg-primary/15 flex h-7 w-7 items-center justify-center rounded-lg">
                        <Zap className="text-primary h-4 w-4" />
                      </div>
                      <h2 className="text-base font-semibold">
                        Supply Optimizer
                      </h2>
                    </div>
                    <p className="text-muted-foreground ml-9 text-xs">
                      {modalStep === 1
                        ? `${selectedData.length} pool${selectedData.length !== 1 ? 's' : ''} selected — review before optimizing`
                        : 'Configure your supply objective'}
                    </p>
                  </div>

                  {/* Stepper */}
                  <div className="mr-6 flex items-center gap-1">
                    {[
                      { step: 1, label: 'Selection' },
                      { step: 2, label: 'Configure' },
                    ].map((s, i) => (
                      <div key={s.step} className="flex items-center gap-1">
                        {i > 0 && (
                          <div
                            className={`mx-1 h-px w-8 transition-colors ${modalStep > 1 ? 'bg-primary/40' : 'bg-border'}`}
                          />
                        )}
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                            modalStep === s.step
                              ? 'bg-primary text-primary-foreground'
                              : modalStep > s.step
                                ? 'bg-primary/20 text-primary'
                                : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {modalStep > s.step ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            s.step
                          )}
                        </div>
                        <span
                          className={`text-xs font-medium ${modalStep === s.step ? 'text-foreground' : 'text-muted-foreground'}`}
                        >
                          {s.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  <DialogClose className="hover:bg-secondary/60 rounded-lg p-1.5 transition-colors">
                    <X className="text-muted-foreground h-4 w-4" />
                  </DialogClose>
                </div>

                {/* Body */}
                {modalStep === 1 ? (
                  <div className="flex flex-col">
                    {/* Sticky column headers */}
                    <div className="border-border/40 flex items-center gap-4 border-b px-7 pt-4 pb-2.5">
                      <div className="w-1 shrink-0" />
                      <span className="text-muted-foreground/70 w-32 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                        Protocol
                      </span>
                      <span className="text-muted-foreground/70 w-24 shrink-0 text-[11px] font-semibold tracking-wider uppercase">
                        Network
                      </span>
                      <span className="text-muted-foreground/70 flex-1 text-[11px] font-semibold tracking-wider uppercase">
                        Pool
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
                            <div className="from-primary to-primary/30 h-10 w-1 shrink-0 rounded-full bg-gradient-to-b" />
                            <div className="w-32 shrink-0">
                              <ProtocolBadge protocol={pool.protocol} />
                            </div>
                            <div className="w-24 shrink-0">
                              <NetworkBadge networkSlug={pool.network} />
                            </div>
                            <span className="text-foreground flex-1 truncate text-sm font-medium">
                              {pool.poolName}
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
                                  : formatApy(value)}
                              </span>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                    <div className="border-border/40 flex justify-end border-t px-7 py-4">
                      <Button
                        onClick={() => {
                          // A market with no measured rate is not a 0% rate —
                          // exclude it so the optimizer never treats "unknown"
                          // as "free".
                          setSnapshotMarkets(
                            selectedData.filter((m) => m.apy !== undefined)
                          )
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
                    <SupplyingOptimizerView
                      markets={snapshotMarkets}
                      onBack={() => setModalStep(1)}
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

            {/* Display filters */}
            <FilterBuilder
              filters={tableFilters}
              onChange={(next) => {
                hasUserInteracted.current = true
                setRowSelection({})
                setTableFilters(next)
              }}
              onClear={() => {
                hasUserInteracted.current = true
                setRowSelection({})
                clearTableFilters()
              }}
              onReset={() => {
                hasUserInteracted.current = true
                setRowSelection({})
                resetTableFilters()
              }}
            />

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
              title="Token"
              columnId="assetSymbol"
              options={tokenOptions}
              multiSelect={false}
              columnFilters={columnFilters}
              onColumnFiltersChange={handleFiltersChange}
              renderIcon={(v) => <TokenIcon symbol={v} />}
              counts={tokenCounts}
            />

            {/* Refresh */}
            <RefreshButton
              onRefresh={handleRefresh}
              isRefreshing={isFetching}
              updatedAt={dataUpdatedAt}
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
                resetTableFilters()
              }}
              disabled={
                !isFiltered &&
                JSON.stringify(tableFilters) ===
                  JSON.stringify(DEFAULT_SUPPLY_FILTERS)
              }
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
        hiddenColumns={['assetSymbol']}
        searchableColumn="poolName"
        columns={columns}
        data={visibleMarkets}
        initialSorting={[{ id: sortColumn, desc: true }]}
        getRowId={getRowId}
        hideToolbar={true}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        globalFilter={searchValue}
        getRowClassName={(row) =>
          isOverutilized(row) ? 'bg-red-500/8 hover:bg-red-500/12' : ''
        }
        filterableColumns={[
          { column: 'protocol', title: 'Protocol', options: protocolOptions },
          { column: 'network', title: 'Network', options: networkOptions },
          {
            column: 'assetSymbol',
            title: 'Token',
            multiSelect: false,
            options: tokenOptions,
          },
        ]}
      />
    </div>
  )
}
