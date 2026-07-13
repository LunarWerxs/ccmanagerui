// useSortable — click-header sort (asc → desc → none) for a rows+columns table.
// Generic over the row type; each column declares its own accessor so callers don't need
// to pre-shape their data. Kept tiny and dependency-free so it's easy to reuse on other
// tables (Sessions/Queue) later, per PLAN.md §4.
import { computed, ref } from 'vue'

export type SortDirection = 'asc' | 'desc' | null

export interface SortableColumn<Row> {
  /** Stable key identifying this column; also what `sortKey` holds while active. */
  key: string
  /** Extracts the comparable value for a row. Return null/undefined to sort it last. */
  accessor: (row: Row) => string | number | boolean | null | undefined
}

/**
 * Click-to-sort state machine for a table. Cycles a column through
 * asc -> desc -> none (back to the original/unsorted `rows` order) on repeated clicks.
 */
export function useSortable<Row>(rows: () => readonly Row[], columns: SortableColumn<Row>[]) {
  const sortKey = ref<string | null>(null)
  const sortDirection = ref<SortDirection>(null)

  const columnsByKey = new Map(columns.map((c) => [c.key, c]))

  function toggleSort(key: string) {
    if (!columnsByKey.has(key)) return
    if (sortKey.value !== key) {
      sortKey.value = key
      sortDirection.value = 'asc'
      return
    }
    if (sortDirection.value === 'asc') {
      sortDirection.value = 'desc'
    } else if (sortDirection.value === 'desc') {
      sortKey.value = null
      sortDirection.value = null
    } else {
      sortDirection.value = 'asc'
    }
  }

  /** Sort indicator for a given column key: 'asc' | 'desc' | null (not the active sort). */
  function indicatorFor(key: string): SortDirection {
    return sortKey.value === key ? sortDirection.value : null
  }

  function compareValues(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  }

  const sortedRows = computed<readonly Row[]>(() => {
    const source = rows()
    const key = sortKey.value
    const dir = sortDirection.value
    if (!key || !dir) return source
    const col = columnsByKey.get(key)
    if (!col) return source
    const copy = source.slice()
    copy.sort((a, b) => {
      const cmp = compareValues(col.accessor(a), col.accessor(b))
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  })

  return { sortKey, sortDirection, sortedRows, toggleSort, indicatorFor }
}
