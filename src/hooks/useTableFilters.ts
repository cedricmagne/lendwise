'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type TableFilter,
  parseStoredFilters,
  serializeFilters,
} from '@/lib/table-filters'

/**
 * The user's filter list for one table, persisted.
 *
 * Starts on the defaults and adopts the stored list in an effect rather than
 * reading `localStorage` during render: the server renders the defaults, so
 * reading storage on the first client render would hydrate a different tree.
 * The visible cost is one frame of the default set on a customised table; the
 * alternative is a hydration mismatch on every load.
 *
 * The consequence the design accepts: someone who set the floor to 0 a month
 * ago comes back to a table with no guard rail. That is coherent — the filter
 * belongs to them — ON CONDITION that the active rows stay visible without
 * opening a menu. `FilterBuilder` renders them as chips for that reason.
 */
export function useTableFilters(
  storageKey: string,
  defaults: TableFilter[]
): {
  filters: TableFilter[]
  setFilters: (next: TableFilter[]) => void
  /** Every filter off. Persisted, so it survives a reload. */
  clear: () => void
  /** Back to the shipped defaults, and forget what was stored. */
  reset: () => void
} {
  const [filters, setState] = useState<TableFilter[]>(defaults)

  useEffect(() => {
    // Reading the `window.localStorage` property itself can throw
    // (`SecurityError` in Chromium with cookies/site-data blocked), not just
    // the `getItem` call — guard the whole access. The existing
    // `parseStoredFilters`/defaults fallback already handles "we have
    // nothing," which is the correct behaviour when storage is unavailable
    // too, so a no-op catch is enough.
    try {
      const stored = parseStoredFilters(window.localStorage.getItem(storageKey))
      if (stored !== null) setState(stored)
    } catch {
      // Storage unavailable — keep the defaults already in state.
    }
  }, [storageKey])

  const setFilters = useCallback(
    (next: TableFilter[]) => {
      setState(next)
      try {
        window.localStorage.setItem(storageKey, serializeFilters(next))
      } catch {
        // Storage unavailable — the in-memory state above still updates.
      }
    },
    [storageKey]
  )

  const clear = useCallback(() => setFilters([]), [setFilters])

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable — resetting in-memory state below is still safe.
    }
    setState(defaults)
  }, [storageKey, defaults])

  return { filters, setFilters, clear, reset }
}
