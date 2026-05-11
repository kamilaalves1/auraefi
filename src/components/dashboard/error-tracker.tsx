'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * ErrorTracker — Live error dashboard across all logs
 */

type LogError = {
  file: string
  errors: number
  lines: number
  errorRate: number
  recentErrors: string[]
}

function getSeverityColor(rate: number): string {
  if (rate > 30) return 'text-red-400'
  if (rate > 10) return 'text-amber-400'
  if (rate > 1) return 'text-yellow-400'
  return 'text-emerald-400'
}

function getSeverityBg(rate: number): string {
  if (rate > 30) return 'bg-red-500/20'
  if (rate > 10) return 'bg-amber-500/20'
  if (rate > 1) return 'bg-yellow-500/20'
  return 'bg-emerald-500/20'
}

export function ErrorTracker() {
  const [logs, setLogs] = useState<LogError[]>([])
  const [totalErrors, setTotalErrors] = useState(0)
  const [totalLines, setTotalLines] = useState(0)
  const [overallRate, setOverallRate] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/errors')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setLogs(data.logs || [])
      setTotalErrors(data.totalErrors || 0)
      setTotalLines(data.totalLines || 0)
      setOverallRate(data.overallRate || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  return (
    <div className="space-y-3">
      {/* Overall stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`text-lg font-bold ${getSeverityColor(overallRate)}`}>
            {(totalErrors / 1000).toFixed(1)}K
          </span>
          <span className="text-[9px] text-muted-foreground/30">errors</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{(totalLines / 1000).toFixed(0)}K</span>
          <span className="text-[9px] text-muted-foreground/30">lines scanned</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <span className={`text-[10px] font-mono font-bold ${getSeverityColor(overallRate)}`}>
          {overallRate}%
        </span>
      </div>

      {/* Error breakdown by file */}
      <div className="space-y-1">
        {logs.filter(l => l.errors > 0).slice(0, 8).map(log => {
          const pct = totalErrors > 0 ? (log.errors / totalErrors) * 100 : 0
          return (
            <div key={log.file} className="rounded-md border border-border/10 bg-surface-1/10 px-2 py-1.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-mono text-foreground/50">{log.file}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold ${getSeverityColor(log.errorRate)}`}>
                    {log.errors > 999 ? `${(log.errors / 1000).toFixed(1)}K` : log.errors}
                  </span>
                  <span className={`text-[7px] font-mono px-1 rounded ${getSeverityBg(log.errorRate)} ${getSeverityColor(log.errorRate)}`}>
                    {log.errorRate}%
                  </span>
                </div>
              </div>
              <div className="relative h-1.5 rounded-full bg-surface-1/15 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                    log.errorRate > 30 ? 'bg-red-500/30' :
                    log.errorRate > 10 ? 'bg-amber-500/30' : 'bg-emerald-500/30'
                  }`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Health indicator */}
      <div className="flex items-center gap-2 text-[8px]">
        <span className="text-muted-foreground/20">Health:</span>
        {overallRate < 5 && <span className="text-emerald-400 font-medium">● Healthy</span>}
        {overallRate >= 5 && overallRate < 20 && <span className="text-amber-400 font-medium">● Degraded</span>}
        {overallRate >= 20 && <span className="text-red-400 font-medium">● Elevated</span>}
      </div>
    </div>
  )
}
