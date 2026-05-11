'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * OpsScoreboard — Performance Metrics Dashboard
 *
 * Phase 124: Enterprise-grade performance scoreboard with ring gauges,
 * trend indicators, target vs actual comparisons, and log volume bars.
 *
 * �� PANEL TUNING GUIDE:
 * - Ring gauge size: line ~85 (SVG viewBox)
 * - Trend arrow colors: line ~100
 * - Target threshold colors: line ~110
 * - Refresh interval: line ~70 (default 30s)
 */

type Metric = {
  id: string
  label: string
  value: number
  unit: string
  target: number | null
  icon: string
  trend: string
}

type ScoreboardData = {
  metrics: Metric[]
  routines: Array<{ id: string; status: string; last_run: string }>
  log_volumes: Record<string, number>
  approvals: { total: number; approved: number; rejected: number }
  summary: Record<string, number>
  timestamp: string
}

const TREND_STYLES: Record<string, { arrow: string; color: string }> = {
  up: { arrow: '↑', color: 'text-emerald-400' },
  down: { arrow: '↓', color: 'text-red-400' },
  stable: { arrow: '→', color: 'text-zinc-400' },
}

function RingGauge({ value, target, size = 52 }: { value: number; target: number | null; size?: number }) {
  const radius = 20
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(value, 100)
  const offset = circumference - (pct / 100) * circumference

  const meetsTarget = target === null || value >= target
  const strokeColor = meetsTarget ? '#34d399' : value >= (target || 0) * 0.9 ? '#fbbf24' : '#f87171'
  const bgColor = meetsTarget ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="transform -rotate-90" style={{ width: size, height: size }}>
        {/* Background ring */}
        <circle cx="24" cy="24" r={radius} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
        {/* Progress ring */}
        <circle
          cx="24" cy="24" r={radius}
          fill="none" stroke={strokeColor} strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
        />
      </svg>
      {/* Center value */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold font-mono" style={{ color: strokeColor }}>
          {pct.toFixed(pct % 1 === 0 ? 0 : 1)}
        </span>
      </div>
    </div>
  )
}

export function OpsScoreboard() {
  const [data, setData] = useState<ScoreboardData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/scoreboard')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000) // 30s refresh
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-surface-2 rounded w-1/3" />
          <div className="h-20 bg-surface-2 rounded" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
        <p className="text-muted-foreground text-sm">Scoreboard unavailable — Bridge offline</p>
      </div>
    )
  }

  // Split metrics into gauge metrics (with %) and counter metrics
  const gaugeMetrics = data.metrics.filter(m => m.unit === '%')
  const counterMetrics = data.metrics.filter(m => m.unit !== '%')

  // Log volume bar chart data
  const logKeys = Object.keys(data.log_volumes)
  const maxLogVol = Math.max(...Object.values(data.log_volumes), 1)

  const LOG_COLORS: Record<string, string> = {
    'amy-proxy': 'bg-blue-400',
    'email-lane': 'bg-emerald-400',
    'api-bridge': 'bg-violet-400',
    'council': 'bg-amber-400',
    'scheduler': 'bg-pink-400',
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🏆</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Amy Scoreboard</h3>
            <p className="text-xs text-muted-foreground">Operational performance metrics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Approval stats badge */}
          <span className="text-2xs px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 font-mono">
            {data.approvals.approved} approved
          </span>
          {data.approvals.rejected > 0 && (
            <span className="text-2xs px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 border border-red-400/20 font-mono">
              {data.approvals.rejected} rejected
            </span>
          )}
        </div>
      </div>

      {/* Ring Gauge Row — percentage metrics with targets */}
      <div className="grid grid-cols-3 divide-x divide-border/20 border-b border-border/20">
        {gaugeMetrics.map((metric) => {
          const trend = TREND_STYLES[metric.trend] || TREND_STYLES.stable
          const meetsTarget = metric.target === null || metric.value >= metric.target
          return (
            <div key={metric.id} className="px-4 py-4 flex items-center gap-3">
              <RingGauge value={metric.value} target={metric.target} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{metric.label}</span>
                  <span className={`text-2xs font-bold ${trend.color}`}>{trend.arrow}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-lg font-bold font-mono text-foreground">
                    {metric.value}{metric.unit}
                  </span>
                </div>
                {metric.target && (
                  <span className={`text-2xs ${meetsTarget ? 'text-emerald-400' : 'text-red-400'}`}>
                    {meetsTarget ? '✓' : '✗'} Target: {metric.target}{metric.unit}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Counter Metrics Row */}
      <div className="grid grid-cols-5 divide-x divide-border/20 border-b border-border/20">
        {counterMetrics.map((metric) => {
          const trend = TREND_STYLES[metric.trend] || TREND_STYLES.stable
          return (
            <div key={metric.id} className="px-3 py-3 text-center">
              <div className="text-base mb-0.5">{metric.icon}</div>
              <div className="text-sm font-bold font-mono text-foreground">
                {typeof metric.value === 'number' && metric.value > 9999
                  ? `${(metric.value / 1000).toFixed(0)}K`
                  : metric.value.toLocaleString()
                }
              </div>
              <div className="text-2xs text-muted-foreground truncate">{metric.label}</div>
              <span className={`text-2xs font-bold ${trend.color}`}>{trend.arrow}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom section — Log Volume Breakdown + Routine Status */}
      <div className="grid grid-cols-2 divide-x divide-border/20">
        {/* Log volume breakdown */}
        <div className="px-5 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Log Volume Distribution</span>
          <div className="mt-2 space-y-1.5">
            {logKeys.map(key => {
              const vol = data.log_volumes[key]
              const pct = (vol / maxLogVol) * 100
              const color = LOG_COLORS[key] || 'bg-zinc-400'
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground w-20 truncate font-mono">{key}</span>
                  <div className="flex-1 h-1.5 bg-surface-2/60 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color} transition-all duration-700`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <span className="text-2xs font-mono text-muted-foreground w-12 text-right">
                    {vol > 999 ? `${(vol / 1000).toFixed(0)}K` : vol}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Routine status grid */}
        <div className="px-5 py-3">
          <span className="text-2xs text-muted-foreground uppercase tracking-wider">Routine Health</span>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {data.routines.map(r => (
              <div key={r.id} className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  r.status === 'ok' ? 'bg-emerald-400' : r.status === 'error' ? 'bg-red-400' : 'bg-zinc-500'
                }`} />
                <span className="text-2xs text-muted-foreground truncate font-mono">{r.id}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border/20 flex items-center justify-between">
        <span className="text-2xs text-muted-foreground">
          🏆 Updated every 30s · {data.summary.routines_ok}/{data.summary.routines_total} routines healthy
        </span>
        <button
          onClick={fetchData}
          className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  )
}
