'use client'

import { useState, useTransition } from 'react'

import Link from 'next/link'

import { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'
import {
  AlertCircle,
  ArrowUpRightFromSquare,
  HeartPulse,
  Search,
  TrendingUp,
  X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { loadMarketBorrowHistoryRates } from '@/app/actions/market-rates.actions'
import { NetworkIcon, ProtocolIcon, TokenIcon } from '@/components/icon'
import {
  DataTable,
  FilterChip,
  SortableHeader,
  getUniqueColumnValues,
} from '@/components/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { WalletAvatar } from '@/components/wallet/WalletAvatar'
import { protocolVersionName } from '@/config/protocols-meta'
import { useCurrency } from '@/contexts'
import { useIsMobile } from '@/hooks/useMobile'
import { formatCompactCurrency } from '@/lib/format-currency'
import { formatAddress } from '@/lib/utils'
import { TIMEFRAME_OPTIONS, TimeframeLabel } from '@/types'
import { BorrowPosition, MarketRate } from '@/types'

import { AddressBadge } from '../badge/AddressBadge'
import { NetworkBadge } from '../badge/NetworkBadge'
import { ProtocolBadge } from '../badge/ProtocolBadge'
import { LiquidationRiskBar } from '../borrowing/LiquidationRiskBar'
import { addressColumn } from './columns.shared'

const createColumns = (
  currency: string,
  _rate: number,
  _isMobile: boolean
): ColumnDef<BorrowPosition>[] => [
  {
    accessorKey: 'protocol',
    header: 'Protocol',
    cell: ({ row }) => <ProtocolBadge protocol={row.original.protocol} />,
    meta: {
      isMobileHidden: true,
    },
  },
  {
    accessorKey: 'network',
    header: 'Network',
    cell: ({ row }) => <NetworkBadge networkSlug={row.original.network} />,
    meta: {
      isMobileHidden: true,
    },
  },
  addressColumn<BorrowPosition>(),
  {
    accessorKey: 'poolName',
    header: 'Vault / Pool',
    cell: ({ row }) => (
      <div className="flex w-full items-center gap-2">
        <TokenIcon symbol={row.original.loanAssetSymbol} />
        <TableCellViewer item={row.original} />
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: 'loanAssetAmount',
    header: ({ column }) => (
      <SortableHeader column={column}>Debt</SortableHeader>
    ),
    cell: ({ row }) => (
      <div className="flex w-full flex-col items-start text-xs">
        <span className="font-mono font-medium">
          {formatCompactCurrency(
            Number(row.original.loanAssetAmount),
            row.original.loanAssetSymbol
          )}
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          {formatCompactCurrency(row.original.loanLiveAssetAmountUsd, currency)}
        </span>
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: 'collaterals',
    header: ({ column }) => (
      <SortableHeader column={column}>Collaterals</SortableHeader>
    ),
    size: 130,
    cell: ({ row }) => {
      const collaterals = row.original.collaterals ?? []

      if (!collaterals.length) return '-'

      const totalCollateralUsd = collaterals.reduce(
        (acc, collateral) => acc + collateral.amountUsd,
        0
      )

      const visibleCollaterals = collaterals.slice(0, 3)
      const remaining = collaterals.length - visibleCollaterals.length

      return (
        <HoverCard openDelay={50} closeDelay={50}>
          <HoverCardTrigger asChild>
            <div className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md p-1.5 shadow-sm transition-colors">
              <div className="flex -space-x-2">
                {visibleCollaterals.map((collateral) => (
                  <TokenIcon
                    key={`${row.id}-${collateral.symbol}`}
                    symbol={collateral.symbol}
                    className="rounded-full"
                  />
                ))}
                {remaining > 0 && (
                  <span className="bg-muted/70 text-muted-foreground flex items-center justify-center rounded-full text-xs font-semibold">
                    +{remaining}
                  </span>
                )}
              </div>
              <span className="text-muted-foreground font-mono text-xs">
                {formatCompactCurrency(totalCollateralUsd, currency)}
              </span>
            </div>
          </HoverCardTrigger>
          <HoverCardContent
            align="start"
            className="border-border/60 bg-popover/95 w-50 rounded-md border p-0 shadow-2xl backdrop-blur-sm"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-muted-foreground text-xs">Collateral value</p>
              <p className="font-mono text-sm">
                {formatCompactCurrency(totalCollateralUsd, currency)}
              </p>
            </div>
            <Separator className="bg-border/60" />
            <div className="overflow-auto py-3 text-xs">
              {collaterals.map((collateral) => (
                <div
                  key={`${row.id}-${collateral.symbol}-detail`}
                  className="flex items-center justify-between px-4 py-1"
                >
                  <div className="flex items-center gap-2">
                    <TokenIcon symbol={collateral.symbol} className="h-5 w-5" />
                    <div className="flex flex-col">
                      <span className="text-xs">{collateral.symbol}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {collateral.amountUsd === 0 && (
                      <Badge
                        variant="secondary"
                        className="text-2xs px-1.5 py-0 uppercase"
                      >
                        Idle
                      </Badge>
                    )}
                    <span className="font-mono text-xs">
                      {formatCompactCurrency(collateral.amountUsd, currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </HoverCardContent>
        </HoverCard>
      )
    },
    enableHiding: false,
  },
  {
    accessorKey: 'apy',
    header: ({ column }) => (
      <SortableHeader column={column}>Rate</SortableHeader>
    ),
    cell: ({ row }) => <span className="font-mono">{row.original.apy}%</span>,
    size: 60,
    enableHiding: false,
    enableSorting: true,
  },
  {
    accessorKey: 'healthFactor',
    header: ({ column }) => (
      <SortableHeader column={column}>Health</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono">
        {Number(row.original.healthFactor).toFixed(2)}
      </span>
    ),
    size: 60,
    enableHiding: false,
    enableSorting: true,
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

const chartConfig = {
  rate: {
    label: 'Rate',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

function TableCellViewer({ item }: { item: BorrowPosition }) {
  const isMobile = useIsMobile()
  const [rates, setRates] = useState<MarketRate[]>([])
  const [selectedTimeframe, setSelectedTimeframe] =
    useState<TimeframeLabel>('7d')
  const [pending, startTransition] = useTransition()

  const handleLoadRates = async (timeframeLabel: TimeframeLabel) => {
    const option = TIMEFRAME_OPTIONS.find((o) => o.label === timeframeLabel)
    if (!option) return

    startTransition(async () => {
      setSelectedTimeframe(timeframeLabel)

      let fromTimestamp = item.loanTimestamp
      if (option.days) {
        const now = Math.floor(Date.now() / 1000)
        fromTimestamp = now - option.days * 24 * 60 * 60
      }

      try {
        const rates = await loadMarketBorrowHistoryRates({
          protocolId: item.protocol,
          chainId: item.poolChainId,
          poolId: item.poolId,
          tokenId: item.loanAssetAddress,
          interval: option.label,
          fromTimestamp,
        })
        setRates(rates)
      } catch (error) {
        console.error('Failed to load market rates:', error)
      }
    })
  }

  const hasData = rates && rates.length > 0

  return (
    <Drawer direction={isMobile ? 'bottom' : 'right'}>
      <DrawerTrigger asChild>
        <Button
          variant="link"
          className="text-foreground decoration-muted-foreground w-fit cursor-pointer px-0 text-left text-xs underline decoration-dashed underline-offset-6"
          onClick={() => {
            handleLoadRates('7d')
          }}
        >
          {item.poolName}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="gap-1">
          <DrawerTitle>{item.poolName}</DrawerTitle>
          <DrawerDescription asChild>
            <div className="flex flex-wrap gap-2">
              <ProtocolBadge protocol={item.protocol} />
              <NetworkBadge networkSlug={item.network} />
              <AddressBadge address={item.userAddress} noCopy border />
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
          <div className="grid gap-2">
            <div className="flex gap-2 leading-none font-medium">
              Health factor <HeartPulse className="size-4" />
            </div>
            <div className="my-4 w-full">
              <LiquidationRiskBar
                borrowCapacity={2.75}
                borrowing={item.loanAssetAmountUsd}
              />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-2 leading-none font-medium">
            <div className="flex items-center gap-2">
              Borrowing rate <TrendingUp className="size-4" />
            </div>
            <div className="flex items-center gap-1">
              <Select
                value={selectedTimeframe}
                onValueChange={(value) =>
                  handleLoadRates(value as TimeframeLabel)
                }
              >
                <SelectTrigger className="h-7 w-[80px] text-xs">
                  <SelectValue placeholder="Select timeframe" />
                </SelectTrigger>
                <SelectContent align="end">
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.label}
                      value={option.label}
                      className="text-xs"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {pending ? (
            <div className="text-muted-foreground flex aspect-video items-center justify-center text-sm">
              Loading...
            </div>
          ) : (
            <div className="relative w-full">
              <ChartContainer config={chartConfig} className="h-full w-full">
                <AreaChart
                  accessibilityLayer
                  data={rates}
                  margin={{
                    top: 10,
                    right: -45,
                    left: 0,
                    bottom: 0,
                  }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    tickFormatter={(value) => {
                      return new Date(value * 1000).toLocaleDateString(
                        'en-US',
                        {
                          month: 'short',
                          day: 'numeric',
                        }
                      )
                    }}
                  />
                  <YAxis
                    dataKey="rate"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={-45}
                    width={50}
                    tick={{
                      fill: 'var(--muted-foreground)',
                      fontSize: 11,
                    }}
                    tickFormatter={(value) =>
                      `${Number(value * 100).toFixed(2)}%`
                    }
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        indicator="line"
                        labelFormatter={(value) => {
                          return new Date(
                            Number(value) * 1000
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            ...(selectedTimeframe === '24h' && {
                              hour: 'numeric',
                              minute: 'numeric',
                            }),
                          })
                        }}
                        valueFormatter={(value) => {
                          return `${(Number(value) * 100).toFixed(2)}%`
                        }}
                      />
                    }
                  />
                  <Area
                    dataKey="rate"
                    type="natural"
                    fill="var(--color-rate)"
                    fillOpacity={0.4}
                    stroke="var(--color-rate)"
                    stackId="a"
                  />
                </AreaChart>
              </ChartContainer>
              {!hasData && (
                <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-sm">
                  <AlertCircle className="mb-2 h-6 w-6 opacity-40" />
                  <p>No data available</p>
                </div>
              )}
            </div>
          )}
        </div>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function BorrowingTable({ data }: { data: BorrowPosition[] }) {
  const { baseCurrency, rate } = useCurrency()
  const isMobile = useIsMobile()
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [searchValue, setSearchValue] = useState('')

  const columns = createColumns(baseCurrency, rate, isMobile).filter(
    (column) => !isMobile || !column.meta?.isMobileHidden
  )

  const protocolOptions = getUniqueColumnValues(data, 'protocol').map((v) => ({
    value: v as string,
    label: (
      <div className="flex items-center gap-2">
        <ProtocolIcon protocol={v as string} />
        {protocolVersionName(v)}
      </div>
    ),
  }))

  const networkOptions = getUniqueColumnValues(data, 'network').map((v) => ({
    value: v as string,
    label: (
      <div className="flex items-center gap-2">
        <NetworkIcon networkSlug={v as string} />
        {(v as string).charAt(0).toUpperCase() + (v as string).slice(1)}
      </div>
    ),
  }))

  const addressOptions = getUniqueColumnValues(data, 'userAddress').map(
    (v) => ({
      value: v as string,
      label: (
        <div className="flex items-center gap-2">
          <WalletAvatar address={v as string} size={20} />
          {formatAddress(v as string)}
        </div>
      ),
    })
  )

  const isFiltered = columnFilters.length > 0 || searchValue !== ''

  const filterableColumns = [
    {
      column: 'protocol',
      title: 'Protocol',
      options: protocolOptions,
    },
    {
      column: 'network',
      title: 'Network',
      options: networkOptions,
    },
    {
      column: 'userAddress',
      title: 'Address',
      options: addressOptions,
    },
  ]

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex flex-wrap items-center justify-between gap-3 border-b px-8 py-5">
        <div>
          <h2 className="text-foreground text-xl font-bold">
            Borrowing positions
          </h2>
          <p className="text-muted-foreground text-xs">
            Active borrow positions across protocols and chains
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
            <Input
              placeholder="Filter..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="h-9 w-36 pl-7 text-xs placeholder:text-xs"
            />
          </div>
          <FilterChip
            title="Protocol"
            columnId="protocol"
            options={protocolOptions}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            renderIcon={(v) => <ProtocolIcon protocol={v} />}
          />
          <FilterChip
            title="Network"
            columnId="network"
            options={networkOptions}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            renderIcon={(v) => <NetworkIcon networkSlug={v} />}
          />
          <FilterChip
            title="Address"
            columnId="userAddress"
            options={addressOptions}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
          />
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => {
                setColumnFilters([])
                setSearchValue('')
              }}
            >
              Reset <X className="ml-1 h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumn="poolName"
        initialSorting={[{ id: 'apy', desc: true }]}
        filterableColumns={filterableColumns}
        hideToolbar={true}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        globalFilter={searchValue}
        onGlobalFilterChange={setSearchValue}
      />
    </div>
  )
}
