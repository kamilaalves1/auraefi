'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * CapabilityMatrix — Operational maturity registry
 *
 * Shows all capabilities with status badges,
 * progress bar, and expandable details.
 */

type Capability = {
  id: string
  name: string
  description: string
  status: string
  category: string
  proof: string
  reusable: string
  clientSafe: string
  notes: string
}

type Stats = {
  proven: number
  partially: number
  planned: number
  parked: number
  future: number
  archived: number
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  proven: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', icon: '●' },
  partially: { color: 'text-amber-400', bg: 'bg-amber-500/15', icon: '◐' },
  planned: { color: 'text-blue-400', bg: 'bg-blue-500/15', icon: '○' },
  parked: { color: 'text-zinc-400', bg: 'bg-zinc-500/15', icon: '⊘' },
  future: { color: 'text-purple-400', bg: 'bg-purple-500/15', icon: '◇' },
  archived: { color: 'text-red-400/50', bg: 'bg-red-500/10', icon: '✕' },
}

export function CapabilityMatrix() {
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/capabilities')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCapabilities(data.capabilities || [])
      setStats(data.stats || null)
      setTotal(data.total || 0)
    } catch {
      setCapabilities([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const filtered = filter === 'all' ? capabilities : capabilities.filter(c => c.category === filter)
  const provenPct = stats ? Math.round((stats.proven / total) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Maturity gauge */}
      {stats && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-emerald-400">{stats.proven}</span>
              <span className="text-[10px] text-muted-foreground/40">/ {total} proven</span>
            </div>
            <span className="text-[10px] text-muted-foreground/30">{provenPct}% maturity</span>
          </div>
          <div className="h-2 rounded-full bg-surface-1/30 overflow-hidden">
            <div className="h-full flex">
              <div className="bg-emerald-500/60 transition-all" style={{ width: `${(stats.proven / total) * 100}%` }} />
              <div className="bg-amber-500/60 transition-all" style={{ width: `${(stats.partially / total) * 100}%` }} />
              <div className="bg-blue-500/40 transition-all" style={{ width: `${(stats.planned / total) * 100}%` }} />
              <div className="bg-zinc-500/30 transition-all" style={{ width: `${((stats.parked + stats.future + stats.archived) / total) * 100}%` }} />
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap">
            {([
              ['proven', stats.proven],
              ['partially', stats.partially],
              ['planned', stats.planned],
              ['parked', stats.parked],
              ['future', stats.future],
              ['archived', stats.archived],
            ] as [string, number][]).map(([cat, count]) => {
              const cfg = STATUS_CONFIG[cat]
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(filter === cat ? 'all' : cat)}
                  className={`flex items-center gap-1 text-[9px] rounded-full px-1.5 py-0.5 transition-all ${
                    filter === cat ? `${cfg.bg} ${cfg.color} font-medium` : 'text-muted-foreground/30 hover:text-muted-foreground/50'
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span>{cat} ({count})</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Capability list */}
      <div className="space-y-1.5 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
        {filtered.map(cap => {
          const cfg = STATUS_CONFIG[cap.category] || STATUS_CONFIG.planned
          const isExpanded = expanded === cap.id

          return (
            <div key={cap.id}>
              <button
                onClick={() => setExpanded(isExpanded ? null : cap.id)}
                className="w-full rounded-md border border-border/20 bg-surface-1/15 px-2.5 py-1.5 text-left transition-all hover:bg-surface-1/30"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono font-bold ${cfg.color}`}>{cap.id}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                    {cfg.icon} {cap.status}
                  </span>
                  <span className="text-[10px] text-foreground truncate flex-1">{cap.name}</span>
                  <span className={`text-[8px] transition-transform ${isExpanded ? 'rotate-180' : ''} text-muted-foreground/20`}>▼</span>
                </div>
              </button>

              {isExpanded && (
                <div className="ml-4 mt-0.5 rounded border border-border/10 bg-surface-1/10 px-2.5 py-2 space-y-1 text-[9px] animate-in fade-in duration-200">
                  <div className="text-muted-foreground/50">{cap.description}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pt-1">
                    <div><span className="text-muted-foreground/30">Proof:</span> <span className="text-foreground/60">{cap.proof}</span></div>
                    <div><span className="text-muted-foreground/30">Reusable:</span> <span className="text-foreground/60">{cap.reusable}</span></div>
                    <div><span className="text-muted-foreground/30">Client Safe:</span> <span className={cap.clientSafe === 'Yes' ? 'text-emerald-400' : 'text-amber-400'}>{cap.clientSafe}</span></div>
                    {cap.notes && <div className="col-span-2"><span className="text-muted-foreground/30">Notes:</span> <span className="text-muted-foreground/40 italic">{cap.notes}</span></div>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
