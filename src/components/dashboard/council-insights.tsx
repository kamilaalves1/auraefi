'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * CouncilInsights — Multi-Model AI Council Analytics
 *
 * Phase 128: Shows advisor voting patterns, case sources,
 * verdict distribution, and recent deliberation history.
 */

type AdvisorData = {
  name: string
  emoji: string
  provider: string
  votes: { approve: number; caution: number; reject: number }
  total_votes: number
  tendency: string
  confidence: number
}

type CaseData = {
  id: string
  title: string
  source: string
  ts: string
  votes: Record<string, string>
  verdict?: string
}

type CouncilData = {
  total_cases: number
  total_deliberations: number
  advisors: AdvisorData[]
  verdicts: Record<string, number>
  sources: Record<string, number>
  recent_cases: CaseData[]
  contradictions: ContradictionData[]
  contradiction_count: number
  timestamp: string
}

type ContradictionData = {
  case_id: string
  title: string
  groups: Record<string, string[]>
  severity: 'high' | 'moderate'
}

const VOTE_COLORS = {
  approve: { bg: 'bg-emerald-400/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  caution: { bg: 'bg-amber-400/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  reject: { bg: 'bg-red-400/15', text: 'text-red-400', dot: 'bg-red-400' },
  unknown: { bg: 'bg-zinc-400/15', text: 'text-zinc-400', dot: 'bg-zinc-400' },
  neutral: { bg: 'bg-zinc-400/15', text: 'text-zinc-400', dot: 'bg-zinc-400' },
}

const SOURCE_ICONS: Record<string, string> = {
  telegram: '💬', auto: '⚙️', test: '🧪', anomaly_trigger: '⚠️', manual: '👤', weekly: '📅',
}

export function CouncilInsights() {
  const [data, setData] = useState<CouncilData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/council-insights')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-surface-2 rounded w-1/3" />
        <div className="h-24 bg-surface-2 rounded" />
      </div>
    </div>
  )

  if (!data) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <p className="text-muted-foreground text-sm">Council insights unavailable</p>
    </div>
  )

  const totalVerdicts = Object.values(data.verdicts).reduce((a, b) => a + b, 0)

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">🏛️</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Council Insights</h3>
              <p className="text-xs text-muted-foreground">Multi-model AI advisory board</p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-violet-400/10 text-violet-300 border border-violet-400/20">
              {data.total_cases} cases
            </span>
            <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-blue-400/10 text-blue-300 border border-blue-400/20">
              {data.total_deliberations} deliberations
            </span>
            {data.contradiction_count > 0 && (
              <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-red-400/10 text-red-300 border border-red-400/20 animate-pulse">
                ⚡ {data.contradiction_count} split{data.contradiction_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Advisor cards */}
      <div className="grid grid-cols-4 divide-x divide-border/20">
        {data.advisors.map((advisor) => {
          const tendencyColors = VOTE_COLORS[advisor.tendency as keyof typeof VOTE_COLORS] || VOTE_COLORS.neutral
          const totalVotes = advisor.total_votes || 1
          return (
            <div key={advisor.name} className="px-4 py-3 text-center">
              {/* Avatar + name */}
              <div className="text-2xl mb-1">{advisor.emoji}</div>
              <div className="text-xs font-semibold text-foreground">{advisor.name}</div>
              <div className="text-[9px] text-muted-foreground/60 mb-2">{advisor.provider}</div>

              {/* Vote distribution bar */}
              <div className="h-1.5 rounded-full bg-surface-2/60 overflow-hidden flex mb-1.5">
                {advisor.votes.approve > 0 && (
                  <div className="bg-emerald-400 h-full transition-all" style={{ width: `${(advisor.votes.approve / totalVotes) * 100}%` }} />
                )}
                {advisor.votes.caution > 0 && (
                  <div className="bg-amber-400 h-full transition-all" style={{ width: `${(advisor.votes.caution / totalVotes) * 100}%` }} />
                )}
                {advisor.votes.reject > 0 && (
                  <div className="bg-red-400 h-full transition-all" style={{ width: `${(advisor.votes.reject / totalVotes) * 100}%` }} />
                )}
              </div>

              {/* Tendency badge */}
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${tendencyColors.bg} ${tendencyColors.text}`}>
                <span className={`w-1 h-1 rounded-full ${tendencyColors.dot}`} />
                {advisor.tendency} {advisor.confidence}%
              </span>

              {/* Vote counts */}
              <div className="flex justify-center gap-2 mt-1.5">
                <span className="text-[9px] text-emerald-400/70">{advisor.votes.approve}✓</span>
                <span className="text-[9px] text-amber-400/70">{advisor.votes.caution}⚠</span>
                <span className="text-[9px] text-red-400/70">{advisor.votes.reject}✗</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom: Verdicts + Sources + Recent cases */}
      <div className="grid grid-cols-3 divide-x divide-border/20 border-t border-border/20">
        {/* Verdict distribution */}
        <div className="px-4 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Verdicts</span>
          <div className="mt-2 space-y-1">
            {Object.entries(data.verdicts).filter(([, v]) => v > 0).map(([verdict, count]) => {
              const colors = VOTE_COLORS[verdict as keyof typeof VOTE_COLORS] || VOTE_COLORS.neutral
              const pct = totalVerdicts > 0 ? Math.round((count / totalVerdicts) * 100) : 0
              return (
                <div key={verdict} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                  <span className="text-2xs text-muted-foreground capitalize flex-1">{verdict}</span>
                  <span className="text-2xs font-mono text-foreground/70">{count} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Source breakdown */}
        <div className="px-4 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Sources</span>
          <div className="mt-2 space-y-1">
            {Object.entries(data.sources).sort(([, a], [, b]) => b - a).map(([source, count]) => (
              <div key={source} className="flex items-center gap-2">
                <span className="text-xs">{SOURCE_ICONS[source] || '📋'}</span>
                <span className="text-2xs text-muted-foreground flex-1 capitalize">{source.replace('_', ' ')}</span>
                <span className="text-2xs font-mono text-foreground/70">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent cases */}
        <div className="px-4 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Recent Cases</span>
          <div className="mt-2 space-y-1.5">
            {data.recent_cases.slice(-4).map((c) => {
              const verdictColor = VOTE_COLORS[c.verdict as keyof typeof VOTE_COLORS] || VOTE_COLORS.neutral
              return (
                <div key={c.id} className="flex items-start gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${verdictColor.dot}`} />
                  <div className="min-w-0">
                    <div className="text-[9px] text-foreground/80 truncate">{c.title}</div>
                    <div className="text-[8px] text-muted-foreground/50 font-mono">{c.id}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Contradiction Box */}
      {data.contradictions.length > 0 && (
        <div className="border-t border-border/20 px-5 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs">⚡</span>
            <span className="text-2xs font-semibold text-red-300 uppercase tracking-wider">Contradiction Box</span>
            <span className="text-2xs text-muted-foreground/50">— advisors disagreed</span>
          </div>
          <div className="space-y-2">
            {data.contradictions.map((c) => (
              <div key={c.case_id} className={`rounded-lg px-3 py-2 text-[10px] font-mono ${
                c.severity === 'high'
                  ? 'bg-red-400/10 border border-red-400/20'
                  : 'bg-amber-400/8 border border-amber-400/15'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={c.severity === 'high' ? 'text-red-400' : 'text-amber-400'}>
                    {c.severity === 'high' ? '🔴' : '🟡'}
                  </span>
                  <span className="text-foreground/70 truncate flex-1">{c.case_id}: {c.title}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 ml-5">
                  {Object.entries(c.groups).map(([vote, names]) => {
                    const colors = VOTE_COLORS[vote as keyof typeof VOTE_COLORS] || VOTE_COLORS.neutral
                    return (
                      <span key={vote} className={`${colors.text}`}>
                        {vote}: {(names as string[]).join(' + ')}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          🏛️ 4 advisors · 4 AI providers · {data.total_cases} deliberations
          {data.contradiction_count > 0 && ` · ⚡ ${data.contradiction_count} contradictions`}
        </span>
        <button onClick={fetchData} className="text-2xs text-muted-foreground hover:text-foreground transition-colors">↻</button>
      </div>
    </div>
  )
}
