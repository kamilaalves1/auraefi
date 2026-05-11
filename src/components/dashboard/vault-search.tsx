'use client'

import { useState, useCallback } from 'react'

/**
 * VaultSearch — Search the Sovereign Vault from the dashboard
 *
 * Uses the bridge's /api/vault/search endpoint to find
 * knowledge across the neural refs and inbox.
 */

type SearchResult = {
  file: string
  title: string
  domain: string
  path: string
  snippet: string
}

const DOMAIN_BADGES: Record<string, { icon: string; bg: string }> = {
  ai_ml: { icon: '🤖', bg: 'bg-purple-500/15 text-purple-300' },
  business: { icon: '💼', bg: 'bg-blue-500/15 text-blue-300' },
  cognitive_science: { icon: '🧠', bg: 'bg-pink-500/15 text-pink-300' },
  film_production: { icon: '🎬', bg: 'bg-amber-500/15 text-amber-300' },
  operations: { icon: '⚙️', bg: 'bg-emerald-500/15 text-emerald-300' },
  safety_ethics: { icon: '🛡️', bg: 'bg-red-500/15 text-red-300' },
  seo_web: { icon: '🌐', bg: 'bg-cyan-500/15 text-cyan-300' },
  unknown: { icon: '📄', bg: 'bg-zinc-500/15 text-zinc-300' },
}

export function VaultSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)

    try {
      const res = await fetch(`http://127.0.0.1:3100/api/vault/search?q=${encodeURIComponent(query.trim())}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResults(data.results || [])
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch()
  }

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 text-xs">🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search the Sovereign Vault..."
            className="w-full rounded-md border border-border/40 bg-surface-1 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={doSearch}
          disabled={searching || !query.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {searching ? '...' : 'Search'}
        </button>
      </div>

      {/* Results */}
      {error && (
        <div className="text-xs text-red-400 px-1">⚠️ {error}</div>
      )}

      {searched && results.length === 0 && !error && (
        <div className="text-center py-6">
          <span className="text-muted-foreground/30 text-xs">No results for &ldquo;{query}&rdquo;</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground/40 px-1">
            {results.length} results found
          </div>
          {results.map((r, i) => {
            const badge = DOMAIN_BADGES[r.domain] || DOMAIN_BADGES.unknown
            return (
              <div
                key={i}
                className="rounded-lg border border-border/30 bg-surface-1/30 p-2.5 hover:bg-surface-1/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-xs font-medium text-foreground truncate flex-1" title={r.title}>
                    {r.title}
                  </div>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badge.bg}`}>
                    {badge.icon} {r.domain}
                  </span>
                </div>
                {r.snippet && (
                  <div className="text-[10px] text-muted-foreground/50 line-clamp-2 font-mono leading-relaxed">
                    {r.snippet}
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground/25 mt-1 truncate font-mono" title={r.path}>
                  {r.path}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!searched && (
        <div className="text-center py-6 space-y-1">
          <div className="text-lg">🔮</div>
          <div className="text-[10px] text-muted-foreground/30">Search across neural refs, knowledge, and inbox</div>
        </div>
      )}
    </div>
  )
}
