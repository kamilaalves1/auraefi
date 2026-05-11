'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * PerformanceMetrics — API request distribution + throughput
 */

type EndpointStat = { endpoint: string; count: number; pct: number }

export function PerformanceMetrics() {
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([])
  const [totalRequests, setTotalRequests] = useState(0)
  const [uniqueEndpoints, setUniqueEndpoints] = useState(0)
  const [peakHour, setPeakHour] = useState('')
  const [peakCount, setPeakCount] = useState(0)
  const [hourly, setHourly] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/performance')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEndpoints(data.endpoints || [])
      setTotalRequests(data.totalRequests || 0)
      setUniqueEndpoints(data.uniqueEndpoints || 0)
      setPeakHour(data.peakHour || '')
      setPeakCount(data.peakCount || 0)
      setHourly(data.hourlyDistribution || {})
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  const maxCount = endpoints[0]?.count || 1
  const hours = Object.entries(hourly).sort((a, b) => a[0].localeCompare(b[0]))
  const maxHourly = Math.max(...hours.map(h => h[1]), 1)

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-primary">{(totalRequests / 1000).toFixed(1)}K</span>
          <span className="text-[9px] text-muted-foreground/30">requests</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{uniqueEndpoints}</span>
          <span className="text-[9px] text-muted-foreground/30">endpoints</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-amber-400 font-medium">⚡ {peakHour}</span>
          <span className="text-[8px] text-muted-foreground/20">({(peakCount / 1000).toFixed(1)}K)</span>
        </div>
      </div>

      {/* Hourly distribution mini-chart */}
      <div>
        <div className="text-[8px] text-muted-foreground/25 mb-1">Hourly throughput</div>
        <div className="flex items-end gap-px h-8">
          {hours.map(([hour, count]) => (
            <div
              key={hour}
              className="flex-1 rounded-t-sm bg-primary/30 hover:bg-primary/50 transition-colors relative group"
              style={{ height: `${Math.max((count / maxHourly) * 100, 3)}%` }}
            >
              <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 hidden group-hover:block text-[7px] text-foreground/60 bg-card px-1 rounded whitespace-nowrap border border-border/20">
                {hour}: {count}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[6px] text-muted-foreground/15 mt-0.5">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
      </div>

      {/* Top endpoints */}
      <div className="space-y-0.5 max-h-[120px] overflow-y-auto scrollbar-thin pr-1">
        {endpoints.slice(0, 10).map(ep => (
          <div key={ep.endpoint} className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-surface-1/15">
            <div className="relative flex-1 h-1.5 rounded-full bg-surface-1/10 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
                style={{ width: `${(ep.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-[8px] font-mono text-foreground/40 shrink-0 w-16 text-right">{ep.endpoint.replace('/api/', '')}</span>
            <span className="text-[8px] text-muted-foreground/25 w-8 text-right">{ep.count > 999 ? `${(ep.count / 1000).toFixed(1)}K` : ep.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
