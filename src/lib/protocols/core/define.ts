import type { YieldAdapter } from './types'

/**
 * Typed identity — anchors inference and documentation for adapter authors.
 * An adapter is a plain object; this function only pins its type.
 */
export function defineYieldAdapter(adapter: YieldAdapter): YieldAdapter {
  return adapter
}
