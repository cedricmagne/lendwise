/**
 * Shared test helper: reassemble the Drizzle `sql` statement handed to a
 * stubbed `db.execute`, whitespace-collapsed.
 *
 * Drizzle nests a `sql.raw()` fragment (used for every raw column identifier,
 * e.g. in meanSetClause/lastSetClause) as its own chunk tree, so a predicate
 * built from raw column names is split across objects and no regex reads it
 * off the raw JSON — a plain `JSON.stringify` puts JSON punctuation between a
 * column name and the clause text that follows it. Walking the chunks puts
 * the statement back together; bound parameters are values rather than
 * chunks and drop out, which is what we want — the shape is under test, not
 * the data.
 */

/** The minimal shape of a `vi.fn()` mock this helper reads from. */
interface ExecuteMock {
  mock: { calls: unknown[][] }
}

export function issuedSql(execute: ExecuteMock): string {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const { value, queryChunks } = node as {
      value?: unknown
      queryChunks?: unknown
    }
    if (Array.isArray(value)) return void out.push(value.join(''))
    if (queryChunks) walk(queryChunks)
  }
  walk(execute.mock.calls[0][0])
  return out.join('').replace(/\s+/g, ' ')
}
