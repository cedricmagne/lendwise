'use client'

import type { Table } from '@tanstack/react-table'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { DataTableFacetedFilter } from './DataTableFacetedFilter'
import { DataTableViewOptions } from './DataTableViewOption'

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchableColumn?: string
  searchableColumns?: string[]
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  filterableColumns?: {
    column: string
    title: string
    multiSelect?: boolean
    options: {
      value: string
      label: string | React.ReactNode
      icon?: React.ComponentType<{ className?: string }>
    }[]
  }[]
  facetCountsMap?: Record<string, Map<string, number>>
}

export function DataTableToolbar<TData>({
  table,
  searchableColumn,
  searchableColumns,
  globalFilter,
  onGlobalFilterChange,
  filterableColumns,
  facetCountsMap,
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    (globalFilter !== undefined && globalFilter !== '')

  return (
    <div className="border-border/50 flex items-center gap-2 border-b px-6 py-3">
      {searchableColumns && onGlobalFilterChange ? (
        <Input
          placeholder="Filter..."
          value={globalFilter ?? ''}
          onChange={(event) => onGlobalFilterChange(event.target.value)}
          className="h-8 w-37.5 lg:w-50"
        />
      ) : searchableColumn ? (
        <Input
          placeholder="Filter..."
          value={
            (table.getColumn(searchableColumn)?.getFilterValue() as string) ??
            ''
          }
          onChange={(event) =>
            table
              .getColumn(searchableColumn)
              ?.setFilterValue(event.target.value)
          }
          className="h-8 w-37.5 lg:w-50"
        />
      ) : null}
      {filterableColumns?.map(
        (col) =>
          table.getColumn(col.column) && (
            <DataTableFacetedFilter
              key={col.column}
              column={table.getColumn(col.column)}
              title={col.title}
              options={col.options.filter((o) => o.value)}
              multiSelect={col.multiSelect}
              facetCounts={facetCountsMap?.[col.column]}
            />
          )
      )}
      {isFiltered && (
        <Button
          variant="ghost"
          onClick={() => {
            table.resetColumnFilters()
            onGlobalFilterChange?.('')
          }}
          className="h-8 px-2 lg:px-3"
        >
          Reset
          <X className="ml-2 h-4 w-4" />
        </Button>
      )}
      <div className="ml-auto">
        <DataTableViewOptions table={table} />
      </div>
    </div>
  )
}
