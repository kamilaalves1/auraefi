'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * DecisionLog — Architecture decision viewer
 *
 * Shows all decisions from DECISION_LOG.md with
 * search, date grouping, and expandable rationale.
 */

type Decision = {
  id: string
  date: string
  decision: string
  rationale: string
}

export function DecisionLog() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchData = useCallback(async (q: string) => {
    try {
      const url = q
        ? `http://127.0.0.1:3100/api/decisions?q=${encodeURIComponent(q)}`
        : 'http://127.0.0.1:3100/api/decisions'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDecisions(data.decisions || [])
      setTotal(data.total || 0)
    } catch {
      setDecisions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData('') }, [fetchData])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => fetchData(search), 300)
    return () => clearTimeout(timer)
  }, [search, fetchData])

  // Group by date
  const grouped = decisions.reduce<Record<string, Decision[]>>((acc, d) => {
    if (!acc[d.date]) acc[d.date] = []
    acc[d.date].push(d)
    return acc
  }, {})

  const dates = Object.keys(grouped).sort().reverse()

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  return (
    <div className="space-y-2.5">
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decisions..."
          className="w-full rounded-md border border-border/30 bg-surface-1/20 px-3 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:border-primary/40 focus:outline-none"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/20">{total} decisions</span>
      </div>

      {/* Decisions */}
      <div className="space-y-3 max-h-[340px] overflow-y-auto scrollbar-thin pr-1">
        {dates.map(date => (
          <div key={date}>
            <div className="text-[9px] text-muted-foreground/30 font-mono mb-1 sticky top-0 bg-card z-10 py-0.5">{date}</div>
            <div className="space-y-1">
              {grouped[date].map(d => {
                const isExpanded = expanded === d.id
                return (
                  <div key={d.id}>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : d.id)}
                      className="w-full rounded-md border border-border/15 bg-surface-1/10 px-2.5 py-1.5 text-left transition-all hover:bg-surface-1/25"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-mono font-bold text-primary/70 shrink-0">{d.id}</span>
                        <span className="text-[10px] text-foreground/80 line-clamp-2">{d.decision}</span>
                        <span className={`text-[8px] transition-transform shrink-0 text-muted-foreground/20 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="ml-8 mt-0.5 rounded border border-border/10 bg-surface-1/10 px-2.5 py-1.5 animate-in fade-in duration-200">
                        <div className="text-[9px] text-muted-foreground/30 mb-0.5">Rationale:</div>
                        <div className="text-[9px] text-muted-foreground/50 leading-relaxed">{d.rationale}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
