'use client'

import { useMemo, useState } from 'react'

import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SortAsc,
  SortDesc,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { DataTableToolbar } from './DataTableToolbar'

// Filter function for scalar columns — OR logic across selected values
const arrayFilterFn = <_TData,>(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: string[] | string
): boolean => {
  if (
    !filterValue ||
    (Array.isArray(filterValue) && filterValue.length === 0)
  ) {
    return true
  }
  const value = row.getValue(columnId)

  if (Array.isArray(filterValue)) {
    return filterValue.includes(String(value))
  }
  return String(value) === String(filterValue)
}

// Filter function for array-of-objects columns (e.g. collaterals)
// getKeys receives the full row original and returns the list of filterable strings.
const makeCollectionFilterFn = <TData,>(getKeys: (row: TData) => string[]) =>
  Object.assign(
    (
      row: Row<TData>,
      _columnId: string,
      filterValue: string[] | string
    ): boolean => {
      if (
        !filterValue ||
        (Array.isArray(filterValue) && filterValue.length === 0)
      ) {
        return true
      }
      const keys = getKeys(row.original)
      if (Array.isArray(filterValue)) {
        return filterValue.some((v) => keys.includes(v))
      }
      return keys.includes(filterValue)
    },
    {
      autoRemove: (val: unknown) =>
        !val || (Array.isArray(val) && val.length === 0),
    }
  )

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchableColumn?: string
  searchableColumns?: {
    columns: string[]
    getExtraSearchValues?: (row: TData) => string[]
  }
  filterableColumns?: {
    column: string
    title: string
    multiSelect?: boolean
    /** For array-of-objects columns: extract the filterable key from each item */
    getFilterValues?: (row: TData) => string[]
    options: {
      value: string
      label: string | React.ReactNode
      icon?: React.ComponentType<{ className?: string }>
    }[]
  }[]
  hiddenColumns?: string[]
  onRowClick?: (row: TData) => void
  onRowSelectionChange?: React.Dispatch<React.SetStateAction<RowSelectionState>>
  initialSorting?: SortingState
  initialColumnFilters?: ColumnFiltersState
  rowSelection?: RowSelectionState
  getRowId?: (originalRow: TData, index: number, parent?: unknown) => string
  hideHeader?: boolean
  hidePagination?: boolean
  hideToolbar?: boolean
  /** Fill parent height: header/pagination stay fixed, only rows scroll */
  fillHeight?: boolean
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: React.Dispatch<
    React.SetStateAction<ColumnFiltersState>
  >
  globalFilter?: string
  onGlobalFilterChange?: (value: string) => void
  getRowClassName?: (row: TData) => string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchableColumn,
  searchableColumns,
  filterableColumns,
  hiddenColumns = [],
  onRowClick: _onRowClick,
  initialSorting = [],
  initialColumnFilters = [],
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
  getRowId,
  hideHeader = false,
  hidePagination = false,
  hideToolbar = false,
  fillHeight = false,
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange: controlledOnColumnFiltersChange,
  globalFilter: controlledGlobalFilter,
  onGlobalFilterChange: controlledOnGlobalFilterChange,
  getRowClassName,
}: DataTableProps<TData, TValue>) {
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({})

  const rowSelection = controlledRowSelection ?? internalRowSelection
  const setRowSelection = onRowSelectionChange ?? setInternalRowSelection

  // Initialize column visibility with hidden columns set to false
  const initialVisibility = hiddenColumns.reduce(
    (acc, col) => ({ ...acc, [col]: false }),
    {} as VisibilityState
  )
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(initialVisibility)
  const [internalColumnFilters, setInternalColumnFilters] =
    useState<ColumnFiltersState>(initialColumnFilters)
  const columnFilters = controlledColumnFilters ?? internalColumnFilters
  const setColumnFilters =
    controlledOnColumnFiltersChange ?? setInternalColumnFilters
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('')
  const globalFilter = controlledGlobalFilter ?? internalGlobalFilter
  const setGlobalFilter =
    controlledOnGlobalFilterChange ?? setInternalGlobalFilter
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  })

  // Configure filter functions for filterable columns
  const columnDefs = columns.map((col) => {
    const columnId = 'accessorKey' in col ? col.accessorKey : col.id
    const filterableDef = filterableColumns?.find(
      (fc) => fc.column === columnId
    )

    if (filterableDef) {
      if (filterableDef.getFilterValues) {
        const getter = filterableDef.getFilterValues
        return {
          ...col,
          filterFn: makeCollectionFilterFn<TData>(getter),
        }
      }
      return {
        ...col,
        filterFn: arrayFilterFn,
      }
    }
    return col
  })

  const multiColumnFilterFn: FilterFn<TData> = (
    row: Row<TData>,
    _columnId: string,
    filterValue: string
  ): boolean => {
    if (!filterValue) return true
    const q = filterValue.toLowerCase()
    const cols = searchableColumns?.columns ?? []
    const extra = searchableColumns?.getExtraSearchValues?.(row.original) ?? []
    return (
      cols.some((col) =>
        String(row.getValue(col) ?? '')
          .toLowerCase()
          .includes(q)
      ) || extra.some((v) => v.toLowerCase().includes(q))
    )
  }

  const table = useReactTable({
    data,
    columns: columnDefs,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
      ...(searchableColumns || controlledGlobalFilter !== undefined
        ? { globalFilter }
        : {}),
    },
    getRowId,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters as React.Dispatch<
      React.SetStateAction<ColumnFiltersState>
    >,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    ...(searchableColumns ||
    (searchableColumn && controlledGlobalFilter !== undefined)
      ? {
          globalFilterFn: searchableColumns
            ? multiColumnFilterFn
            : (((row: Row<TData>, _colId: string, filterValue: string) => {
                if (!filterValue) return true
                const val = String(
                  searchableColumn ? row.getValue(searchableColumn) : ''
                ).toLowerCase()
                return val.includes(filterValue.toLowerCase())
              }) as FilterFn<TData>),
          onGlobalFilterChange: setGlobalFilter,
        }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  // Pre-compute facet counts for collection columns (array-of-objects)
  const facetCountsMap = useMemo(() => {
    const collectionCols = (filterableColumns ?? []).filter(
      (fc) => fc.getFilterValues
    )
    if (collectionCols.length === 0) return undefined

    const result: Record<string, Map<string, number>> = {}
    const allRows = table.getPreFilteredRowModel().rows

    for (const fc of collectionCols) {
      const counts = new Map<string, number>()
      for (const row of allRows) {
        const keys = fc.getFilterValues ? fc.getFilterValues(row.original) : []
        for (const key of keys) {
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      result[fc.column] = counts
    }
    return result
  }, [filterableColumns, table])

  // Check if a select column (checkbox) is present
  const hasSelectColumn = columns.some(
    (col) => 'id' in col && col.id === 'select'
  )

  return (
    <div className={cn('flex flex-col', fillHeight && 'h-full min-h-0 flex-1')}>
      {!hideToolbar && (
        <DataTableToolbar
          table={table}
          searchableColumn={searchableColumn}
          searchableColumns={searchableColumns?.columns}
          globalFilter={searchableColumns ? globalFilter : undefined}
          onGlobalFilterChange={searchableColumns ? setGlobalFilter : undefined}
          facetCountsMap={facetCountsMap}
          filterableColumns={filterableColumns}
        />
      )}
      <div className={cn(fillHeight && 'min-h-0 flex-1 overflow-auto')}>
        <Table className="text-xs">
          {!hideHeader && (
            <TableHeader className="bg-card/90 sticky top-0 z-10 backdrop-blur-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="border-border border-b hover:bg-transparent"
                >
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        style={{
                          width: header.getSize(),
                          minWidth: header.column.columnDef.minSize,
                        }}
                        className="text-muted-foreground px-6 py-5 text-xs font-medium uppercase"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
          )}
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && 'selected'}
                    className={cn(
                      'border-border/30 hover:bg-secondary/20 border-b transition-colors duration-150',
                      getRowClassName?.(row.original)
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.columnDef.minSize,
                        }}
                        className="px-6 py-3"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {!hidePagination && (
        <div className="border-border/50 flex items-center justify-between border-t px-6 py-3">
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {hasSelectColumn && (
              <span>
                {table.getFilteredSelectedRowModel().rows.length} of{' '}
                {table.getFilteredRowModel().rows.length} row(s) selected.
              </span>
            )}
          </div>
          <div className="flex w-fit items-center justify-end gap-8">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{' '}
              {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SortableHeader<TData>({
  column,
  children,
}: {
  column: Column<TData, unknown>
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="hover:text-foreground flex cursor-pointer items-center gap-1 text-xs uppercase"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {children}
      {column.getIsSorted() === 'asc' ? (
        <SortAsc className="h-3 w-3" />
      ) : (
        <SortDesc className="h-3 w-3" />
      )}
    </button>
  )
}
