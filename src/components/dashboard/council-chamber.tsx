'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * CouncilChamber — Multi-Model Council decisions viewer
 *
 * Shows council cases with 4 advisor votes,
 * verdict indicators, and case timelines.
 */

type Vote = {
  icon: string
  name: string
  vote: string
  timestamp: string
}

type CouncilCase = {
  id: string
  title: string
  source: string
  created: string
  votes: Record<string, Vote>
  verdict: string
  completed: string
}

const VOTE_COLORS: Record<string, { bg: string; text: string }> = {
  approve: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  caution: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  reject: { bg: 'bg-red-500/15', text: 'text-red-400' },
  abstain: { bg: 'bg-zinc-500/15', text: 'text-zinc-400' },
}

const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  weekly_review: { icon: '📅', label: 'Weekly' },
  telegram: { icon: '💬', label: 'Telegram' },
  anomaly_trigger: { icon: '⚠️', label: 'Anomaly' },
  test: { icon: '🧪', label: 'Test' },
  manual: { icon: '🖐️', label: 'Manual' },
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const dt = new Date(dateStr.replace(' ', 'T'))
  const diff = Date.now() - dt.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CouncilChamber() {
  const [cases, setCases] = useState<CouncilCase[]>([])
  const [totalCases, setTotalCases] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/council')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCases(data.cases || [])
      setTotalCases(data.totalCases || 0)
    } catch {
      setCases([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-lg bg-surface-1/30" />)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground/40">{totalCases} cases recorded</span>
        <button onClick={fetchData} className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors">↻ Refresh</button>
      </div>

      {cases.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-2xl mb-1">🏛️</div>
          <div className="text-[10px] text-muted-foreground/30">No council cases yet</div>
        </div>
      ) : (
        cases.map(c => {
          const isExpanded = expanded === c.id
          const votes = Object.values(c.votes)
          const approves = votes.filter(v => v.vote === 'approve').length
          const source = SOURCE_BADGES[c.source] || { icon: '📋', label: c.source }

          return (
            <div key={c.id}>
              <button
                onClick={() => setExpanded(isExpanded ? null : c.id)}
                className="w-full rounded-lg border border-border/30 bg-surface-1/20 px-3 py-2.5 text-left transition-all hover:bg-surface-1/40"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-primary/60">{c.id}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-1/40 text-muted-foreground/40">{source.icon} {source.label}</span>
                    </div>
                    <div className="text-xs font-medium text-foreground mt-0.5 truncate">{c.title}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[9px] text-muted-foreground/30">{timeAgo(c.created)}</div>
                    <span className={`text-[10px] text-muted-foreground/20 transition-transform inline-block ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </div>

                {/* Vote strip */}
                <div className="flex items-center gap-1.5">
                  {votes.map(v => {
                    const colors = VOTE_COLORS[v.vote] || VOTE_COLORS.abstain
                    return (
                      <div key={v.name} className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${colors.bg}`}>
                        <span className="text-[10px]">{v.icon}</span>
                        <span className={`text-[9px] font-medium ${colors.text}`}>{v.vote}</span>
                      </div>
                    )
                  })}
                  <span className="text-[9px] text-muted-foreground/30 ml-auto">{approves}/{votes.length} approve</span>
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-1 ml-3 rounded-md border border-border/15 bg-surface-1/15 px-3 py-2 space-y-2 animate-in fade-in duration-200">
                  {/* Advisor timeline */}
                  {votes.map(v => {
                    const colors = VOTE_COLORS[v.vote] || VOTE_COLORS.abstain
                    return (
                      <div key={v.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{v.icon}</span>
                          <div>
                            <span className="text-[11px] font-medium text-foreground">{v.name}</span>
                            <span className={`text-[10px] ml-1.5 font-medium ${colors.text}`}>{v.vote}</span>
                          </div>
                        </div>
                        <span className="text-[9px] text-muted-foreground/30 font-mono">{v.timestamp}</span>
                      </div>
                    )
                  })}

                  {/* Verdict */}
                  <div className="border-t border-border/10 pt-1.5 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/40">Chairman Verdict:</span>
                    <span className={`text-[10px] font-bold ${
                      c.verdict === 'approve' ? 'text-emerald-400' :
                      c.verdict === 'reject' ? 'text-red-400' :
                      c.verdict === 'caution' ? 'text-amber-400' : 'text-zinc-400'
                    }`}>
                      {c.verdict.toUpperCase()}
                    </span>
                  </div>

                  {c.completed && (
                    <div className="text-[8px] text-muted-foreground/20 font-mono">Completed: {c.completed}</div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
