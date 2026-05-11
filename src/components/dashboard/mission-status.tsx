'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * MissionStatus — Operational Readiness Pre-Flight Dashboard
 *
 * Phase 125: Shows whether the platform is mission-ready with
 * category scores, individual check items, and an overall
 * readiness gauge. The "is everything working?" panel.
 */

type Check = {
  category: string
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

type Category = {
  icon: string
  label: string
  score: number
  ok: number
  total: number
  status: 'ok' | 'warn' | 'fail'
  checks: Check[]
}

type MissionData = {
  overall_score: number
  overall_status: string
  categories: Record<string, Category>
  total_checks: number
  checks_ok: number
  checks_warn: number
  checks_fail: number
  timestamp: string
}

const STATUS_COLORS = {
  ok: { bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', text: 'text-emerald-400', dot: 'bg-emerald-400', ring: '#34d399' },
  warn: { bg: 'bg-amber-400/10', border: 'border-amber-400/20', text: 'text-amber-400', dot: 'bg-amber-400', ring: '#fbbf24' },
  fail: { bg: 'bg-red-400/10', border: 'border-red-400/20', text: 'text-red-400', dot: 'bg-red-400', ring: '#f87171' },
}

function ReadinessRing({ score, status, size = 80 }: { score: number; status: string; size?: number }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const colors = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.ok

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" style={{ width: size, height: size }} className="transform -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={colors.ring} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s ease-in-out, stroke 0.5s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold font-mono" style={{ color: colors.ring }}>{score}</span>
        <span className="text-[8px] text-muted-foreground uppercase tracking-wider">ready</span>
      </div>
    </div>
  )
}

export function MissionStatus() {
  const [data, setData] = useState<MissionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/mission-status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-surface-2 rounded w-1/3" />
        <div className="h-20 bg-surface-2 rounded" />
      </div>
    </div>
  )

  if (!data) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <p className="text-muted-foreground text-sm">Mission status unavailable</p>
    </div>
  )

  const overallColors = STATUS_COLORS[data.overall_status as keyof typeof STATUS_COLORS] || STATUS_COLORS.ok
  const catEntries = Object.entries(data.categories)

  return (
    <div className={`bg-surface-1 rounded-xl border overflow-hidden transition-all duration-500 ${overallColors.border}`}>
      {/* Header with readiness ring */}
      <div className="px-5 py-4 border-b border-border/30">
        <div className="flex items-center gap-5">
          <ReadinessRing score={data.overall_score} status={data.overall_status} />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">Mission Readiness</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.checks_ok}/{data.total_checks} systems operational
              {data.checks_warn > 0 && <span className="text-amber-400"> · {data.checks_warn} warnings</span>}
              {data.checks_fail > 0 && <span className="text-red-400"> · {data.checks_fail} failures</span>}
            </p>
            {/* Status badge */}
            <span className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full text-2xs font-semibold uppercase tracking-wider ${overallColors.bg} ${overallColors.text} ${overallColors.border} border`}>
              <span className={`w-1.5 h-1.5 rounded-full ${overallColors.dot} ${data.overall_status === 'ok' ? '' : 'animate-pulse'}`} />
              {data.overall_status === 'ok' ? 'All Systems Go' : data.overall_status === 'warn' ? 'Degraded' : 'Critical'}
            </span>
          </div>
          {/* Summary badges */}
          <div className="flex gap-1.5">
            <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
              {data.checks_ok} ✓
            </span>
            {data.checks_warn > 0 && (
              <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-amber-400/10 text-amber-400 border border-amber-400/20">
                {data.checks_warn} ⚠
              </span>
            )}
            {data.checks_fail > 0 && (
              <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-red-400/10 text-red-400 border border-red-400/20">
                {data.checks_fail} ✗
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Category cards */}
      <div className="divide-y divide-border/15">
        {catEntries.map(([catId, cat]) => {
          const colors = STATUS_COLORS[cat.status]
          const isExpanded = expandedCat === catId
          return (
            <div key={catId}>
              {/* Category header — clickable */}
              <button
                onClick={() => setExpandedCat(isExpanded ? null : catId)}
                className="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
              >
                {/* Icon */}
                <span className="text-base w-6 text-center">{cat.icon}</span>
                {/* Label + score */}
                <div className="flex-1 text-left">
                  <span className="text-xs font-medium text-foreground">{cat.label}</span>
                  <span className="text-2xs text-muted-foreground ml-2">
                    {cat.ok}/{cat.total} passing
                  </span>
                </div>
                {/* Mini progress bar */}
                <div className="w-20 h-1.5 bg-surface-2/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${colors.dot}`}
                    style={{ width: `${cat.score}%` }}
                  />
                </div>
                {/* Score */}
                <span className={`text-xs font-bold font-mono w-10 text-right ${colors.text}`}>
                  {cat.score}%
                </span>
                {/* Expand arrow */}
                <span className={`text-2xs text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </button>

              {/* Expanded checks */}
              {isExpanded && (
                <div className="px-5 pb-3 pl-14 space-y-1">
                  {cat.checks.map((check, i) => {
                    const checkColors = STATUS_COLORS[check.status]
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${checkColors.dot}`} />
                        <span className="text-2xs text-muted-foreground flex-1 truncate">{check.name}</span>
                        <span className={`text-2xs font-mono ${checkColors.text}`}>{check.detail}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          🎯 {data.total_checks} checks · Updated every 30s
        </span>
        <button onClick={fetchData} className="text-2xs text-muted-foreground hover:text-foreground transition-colors">
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
