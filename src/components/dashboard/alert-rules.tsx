'use client'

import { useState, useEffect } from 'react'

/**
 * AlertRules — Real-time threshold monitoring
 *
 * Phase 132: Evaluates 6 alert rules against live log data
 * and shows firing/ok status with severity indicators.
 */

interface Alert {
  id: string
  name: string
  icon: string
  threshold: string
  current: string
  status: 'alert' | 'ok'
  severity: 'critical' | 'warning' | 'ok'
  detail: string
}

interface AlertData {
  alerts: Alert[]
  total: number
  firing: number
  ok: number
  checked_at: string
  overall: string
}

export function AlertRules() {
  const [data, setData] = useState<AlertData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/alert-rules')
        const json = await res.json()
        setData(json)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 60_000) // Refresh every 60s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/50 text-xs p-4">
        <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Evaluating alert rules...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-xs text-muted-foreground/40 p-4">
        ⚠️ Alert engine offline
      </div>
    )
  }

  const severityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-400 bg-red-500/15 border-red-500/30'
      case 'warning': return 'text-amber-400 bg-amber-500/15 border-amber-500/30'
      default: return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    }
  }

  const statusDot = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500 shadow-red-500/50'
      case 'warning': return 'bg-amber-500 shadow-amber-500/50'
      default: return 'bg-emerald-500 shadow-emerald-500/50'
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <h3 className="text-sm font-semibold text-foreground">Alert Rules</h3>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
            data.firing > 0 
              ? 'bg-red-500/15 text-red-300' 
              : 'bg-emerald-500/15 text-emerald-300'
          }`}>
            {data.firing > 0 ? `${data.firing} firing` : 'all clear'}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/40 font-mono">
          {data.total} rules · checked {new Date(data.checked_at).toLocaleTimeString()}
        </div>
      </div>

      {/* Alert Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {data.alerts.map((alert) => (
          <div
            key={alert.id}
            className={`p-2.5 rounded-lg border transition-all hover:scale-[1.02] ${severityColor(alert.severity)}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full shadow-sm ${statusDot(alert.severity)}`} />
              <span className="text-xs font-medium truncate">{alert.icon} {alert.name}</span>
            </div>
            <div className="text-lg font-bold leading-tight">{alert.current}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] opacity-60">threshold: {alert.threshold}</span>
              <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                alert.status === 'alert' ? 'bg-white/10' : 'bg-white/5'
              }`}>
                {alert.severity.toUpperCase()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Alert rules evaluate every 60 seconds against live log data. Red = critical, Amber = warning, Green = healthy.
        </p>
      </div>
    </div>
  )
}
