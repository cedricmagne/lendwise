'use client'

import { type ReactNode, useState } from 'react'

import type { ColumnFiltersState } from '@tanstack/react-table'
import { SlidersHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const MAX_VISIBLE_ICONS = 3

export function FilterChip({
  title,
  columnId,
  options,
  multiSelect = true,
  columnFilters,
  onColumnFiltersChange,
  renderIcon,
  counts,
}: {
  title: string
  columnId: string
  options: { value: string; label: ReactNode }[]
  multiSelect?: boolean
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: (filters: ColumnFiltersState) => void
  renderIcon?: (value: string) => ReactNode
  counts?: Map<string, number>
}) {
  const [open, setOpen] = useState(false)
  const current = columnFilters.find((f) => f.id === columnId)
  const selectedValues = new Set<string>(
    multiSelect
      ? ((current?.value as string[]) ?? [])
      : current?.value
        ? [current.value as string]
        : []
  )

  const toggle = (value: string) => {
    const next = new Set(selectedValues)
    if (multiSelect) {
      if (next.has(value)) {
        next.delete(value)
      } else {
        next.add(value)
      }
      onColumnFiltersChange(
        columnFilters
          .filter((f) => f.id !== columnId)
          .concat(next.size ? [{ id: columnId, value: [...next] }] : [])
      )
    } else {
      if (next.has(value)) {
        onColumnFiltersChange(columnFilters.filter((f) => f.id !== columnId))
        setOpen(false)
      } else {
        onColumnFiltersChange(
          columnFilters
            .filter((f) => f.id !== columnId)
            .concat([{ id: columnId, value }])
        )
        setOpen(false)
      }
    }
  }

  const clear = () =>
    onColumnFiltersChange(columnFilters.filter((f) => f.id !== columnId))

  const selectedArray = [...selectedValues]
  const visibleIcons = selectedArray.slice(0, MAX_VISIBLE_ICONS)
  const overflowCount = selectedArray.length - visibleIcons.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 border text-xs"
        >
          <SlidersHorizontal className="text-muted-foreground" />
          {title}
          {selectedValues.size > 0 && renderIcon ? (
            <span className="flex items-center">
              {visibleIcons.map((v, i) => (
                <span
                  key={v}
                  className="border-background bg-muted flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2"
                  style={{
                    marginLeft: i === 0 ? 0 : '-6px',
                    zIndex: visibleIcons.length - i,
                  }}
                >
                  {renderIcon(v)}
                </span>
              ))}
              {overflowCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-2xs ml-0.5 rounded-full px-1"
                  style={{ marginLeft: '-4px' }}
                >
                  +{overflowCount}
                </Badge>
              )}
            </span>
          ) : selectedValues.size > 0 ? (
            <Badge variant="secondary" className="text-2xs rounded-sm px-1">
              {selectedValues.size}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  onSelect={() => toggle(opt.value)}
                  className="text-xs"
                >
                  <div
                    className={`text-2xs mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                      multiSelect ? 'rounded-sm' : 'rounded-full'
                    } ${
                      selectedValues.has(opt.value)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/50 bg-transparent'
                    }`}
                  >
                    {selectedValues.has(opt.value) &&
                      (multiSelect ? (
                        '✓'
                      ) : (
                        <div className="h-1.5 w-1.5 rounded-full bg-current" />
                      ))}
                  </div>
                  <span className="flex-1">{opt.label}</span>
                  {counts?.get(opt.value) !== undefined && (
                    <span className="text-muted-foreground ml-auto pl-2 tabular-nums">
                      {counts.get(opt.value)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <CommandGroup>
                <CommandItem
                  onSelect={clear}
                  className="justify-center text-center text-xs"
                >
                  Clear
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
