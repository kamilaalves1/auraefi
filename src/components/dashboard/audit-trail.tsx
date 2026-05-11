'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * AuditTrail — Governance audit panel
 *
 * Shows approval events, neural routes, and sync operations
 * with type filtering and timeline display.
 */

type AuditEvent = {
  timestamp: string
  source: string
  type: string
  action: string
  detail: string
}

const TYPE_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  proposed: { color: 'text-blue-400', bg: 'bg-blue-500/15', icon: '📋', label: 'Proposed' },
  approved: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', icon: '✅', label: 'Approved' },
  rejected: { color: 'text-red-400', bg: 'bg-red-500/15', icon: '❌', label: 'Rejected' },
  executed: { color: 'text-purple-400', bg: 'bg-purple-500/15', icon: '⚡', label: 'Executed' },
  route: { color: 'text-amber-400', bg: 'bg-amber-500/15', icon: '🧠', label: 'Neural Route' },
  sync: { color: 'text-cyan-400', bg: 'bg-cyan-500/15', icon: '🔄', label: 'Sync' },
  info: { color: 'text-zinc-400', bg: 'bg-zinc-500/15', icon: 'ℹ️', label: 'Info' },
}

export function AuditTrail() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [types, setTypes] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/audit')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEvents(data.events || [])
      setTypes(data.types || {})
      setTotal(data.total || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter)

  // Approval rate
  const approved = types.approved || 0
  const proposed = types.proposed || 0
  const approvalRate = proposed > 0 ? Math.round((approved / proposed) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Stats strip */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-bold text-foreground">{total}</span>
          <span className="text-[10px] text-muted-foreground/30">events</span>
        </div>
        <div className="h-4 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-emerald-400">{approvalRate}%</span>
          <span className="text-[9px] text-muted-foreground/30">approval rate</span>
        </div>
      </div>

      {/* Type filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`text-[9px] rounded-full px-2 py-0.5 transition-all ${
            filter === 'all' ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground/30 hover:text-muted-foreground/50'
          }`}
        >
          all ({total})
        </button>
        {Object.entries(types).map(([type, count]) => {
          const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.info
          return (
            <button
              key={type}
              onClick={() => setFilter(filter === type ? 'all' : type)}
              className={`text-[9px] rounded-full px-2 py-0.5 transition-all ${
                filter === type ? `${cfg.bg} ${cfg.color} font-medium` : 'text-muted-foreground/30 hover:text-muted-foreground/50'
              }`}
            >
              {cfg.icon} {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Event timeline */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto scrollbar-thin pr-1">
        {filtered.slice(0, 50).map((e, i) => {
          const cfg = TYPE_CONFIG[e.type] || TYPE_CONFIG.info
          return (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-border/10 bg-surface-1/10 px-2 py-1.5 text-[9px]"
            >
              <span className="shrink-0 mt-0.5">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`${cfg.color} font-medium`}>{cfg.label}</span>
                  <span className="text-muted-foreground/20">·</span>
                  <span className="text-muted-foreground/25 font-mono">{e.source}</span>
                </div>
                <div className="text-foreground/50 truncate">{e.detail}</div>
              </div>
              <span className="text-muted-foreground/15 font-mono text-[8px] shrink-0 whitespace-nowrap">
                {e.timestamp.split(' ')[1] || e.timestamp}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
