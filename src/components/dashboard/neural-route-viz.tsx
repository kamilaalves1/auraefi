'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * NeuralRouteViz — Cognitive routing visualizer
 *
 * Shows how Amy routes queries through her cognition layers:
 * Neural (knowledge) vs Hybrid (blended) vs None (chat).
 * Rendered as a flow diagram with decision breakdown.
 */

type RouteEntry = {
  timestamp: string
  route: string
  reason: string
  confidence: string
  query_preview: string
}

const ROUTE_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string; desc: string }> = {
  neural: { color: 'text-purple-400', bg: 'bg-purple-500/15', icon: '🧠', label: 'Neural', desc: 'Knowledge retrieval' },
  hybrid: { color: 'text-amber-400', bg: 'bg-amber-500/15', icon: '⚡', label: 'Hybrid', desc: 'Blended reasoning' },
  none:   { color: 'text-zinc-400', bg: 'bg-zinc-500/15', icon: '💬', label: 'Chat', desc: 'Direct response' },
}

const CONF_COLORS: Record<string, string> = {
  high: 'text-emerald-400',
  medium: 'text-amber-400',
  low: 'text-red-400',
  none: 'text-zinc-500',
}

export function NeuralRouteViz() {
  const [entries, setEntries] = useState<RouteEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/audit')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // Extract neural-route events and reshape
      const routes = (data.events || [])
        .filter((e: any) => e.source === 'neural-route')
        .map((e: any) => {
          const parts = e.detail.split(' — ')
          return {
            timestamp: e.timestamp,
            route: e.action.replace('route:', ''),
            reason: parts[0] || '',
            confidence: '',
            query_preview: parts[1] || '',
          }
        })
      setEntries(routes)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  // Count routes
  const routeCounts: Record<string, number> = {}
  entries.forEach(e => { routeCounts[e.route] = (routeCounts[e.route] || 0) + 1 })

  const total = entries.length

  return (
    <div className="space-y-3">
      {/* Route flow visualization */}
      <div className="relative flex items-center justify-center gap-3 py-3">
        {/* Input */}
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-surface-1/30 border border-border/20 flex items-center justify-center text-sm">
            💭
          </div>
          <span className="text-[7px] text-muted-foreground/25 mt-1">Query</span>
        </div>

        {/* Arrow */}
        <div className="w-8 h-px bg-gradient-to-r from-muted-foreground/20 to-primary/30 relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-l-4 border-l-primary/30 border-y-2 border-y-transparent" />
        </div>

        {/* Router */}
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center text-lg animate-pulse">
            🔀
          </div>
          <span className="text-[7px] text-primary/50 mt-1 font-medium">Router</span>
          <span className="text-[6px] text-muted-foreground/20">{total} decisions</span>
        </div>

        {/* Arrows to routes */}
        <div className="flex flex-col gap-2">
          {Object.entries(ROUTE_CONFIG).map(([key, cfg]) => {
            const count = routeCounts[key] || 0
            const pct = total > 0 ? Math.round((count / total) * 100) : 0
            return (
              <div key={key} className="flex items-center gap-2">
                <div className="w-6 h-px bg-gradient-to-r from-primary/20 to-transparent relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-l-3 border-l-primary/20 border-y-[1.5px] border-y-transparent" />
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${cfg.bg} border border-border/10`}>
                  <span className="text-xs">{cfg.icon}</span>
                  <span className={`text-[9px] font-medium ${cfg.color}`}>{cfg.label}</span>
                  <span className="text-[8px] text-muted-foreground/25">{count}</span>
                  {pct > 0 && <span className="text-[7px] text-muted-foreground/20">({pct}%)</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent route decisions */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1.5">Recent routing decisions</div>
        <div className="space-y-1 max-h-[180px] overflow-y-auto scrollbar-thin pr-1">
          {entries.map((e, i) => {
            const cfg = ROUTE_CONFIG[e.route] || ROUTE_CONFIG.none
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-border/10 bg-surface-1/10 px-2 py-1.5 text-[9px]"
              >
                <span className="shrink-0 mt-0.5">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-muted-foreground/20">·</span>
                    <span className="text-muted-foreground/25 truncate">{e.reason}</span>
                  </div>
                  <div className="text-foreground/40 truncate italic">"{e.query_preview}"</div>
                </div>
                <span className="text-muted-foreground/15 font-mono text-[8px] shrink-0">
                  {e.timestamp.split(' ')[1] || e.timestamp.substring(5)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
