/** Every whitespace-separated token has to appear somewhere in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack.toLowerCase()
  return tokens.every((token) => text.includes(token))
}

/** Lower is better: prefix matches on the title first, then word starts, then anywhere. */
export function matchRank(title: string, query: string): number {
  const needle = query.trim().toLowerCase()
  const text = title.toLowerCase()
  if (!needle) return 2
  if (text.startsWith(needle)) return 0
  if (text.split(/\s+/).some((word) => word.startsWith(needle))) return 1
  return 2
}
