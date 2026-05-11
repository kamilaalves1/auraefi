'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * SessionAnalytics — Live metrics from bridge + proxy logs
 *
 * Shows request volume, top endpoints, hourly sparkline,
 * proxy error rate, and uptime.
 */

type Analytics = {
  bridge: {
    totalRequests: number
    topEndpoints: { path: string; count: number }[]
    hourly: { hour: string; count: number }[]
  }
  proxy: {
    totalRequests: number
    errors: number
    error502: number
    errorRate: number
  }
  uptime: {
    hours: number
    since: string
  }
}

export function SessionAnalytics() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/analytics')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading || !data) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const maxHourly = Math.max(...data.bridge.hourly.map(h => h.count), 1)

  return (
    <div className="space-y-3">
      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-primary">{(data.bridge.totalRequests / 1000).toFixed(1)}K</div>
          <div className="text-[8px] text-muted-foreground/30">Bridge Requests</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-foreground">{(data.proxy.totalRequests / 1000).toFixed(1)}K</div>
          <div className="text-[8px] text-muted-foreground/30">Proxy Traffic</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className={`text-lg font-bold ${data.proxy.errorRate > 10 ? 'text-red-400' : data.proxy.errorRate > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {data.proxy.errorRate}%
          </div>
          <div className="text-[8px] text-muted-foreground/30">Error Rate</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-emerald-400">{data.uptime.hours}h</div>
          <div className="text-[8px] text-muted-foreground/30">Uptime</div>
        </div>
      </div>

      {/* Hourly sparkline */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1">Request volume by hour</div>
        <div className="flex items-end gap-[2px] h-12">
          {data.bridge.hourly.map((h, i) => {
            const height = (h.count / maxHourly) * 100
            const isNow = parseInt(h.hour) === new Date().getHours()
            return (
              <div
                key={i}
                className="flex-1 group relative"
                title={`${h.hour}:00 — ${h.count} req`}
              >
                <div
                  className={`w-full rounded-t-sm transition-all ${
                    isNow ? 'bg-primary' : h.count > 0 ? 'bg-primary/30' : 'bg-surface-1/20'
                  }`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
              </div>
            )
          })}
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[7px] text-muted-foreground/15">00:00</span>
          <span className="text-[7px] text-muted-foreground/15">12:00</span>
          <span className="text-[7px] text-muted-foreground/15">23:00</span>
        </div>
      </div>

      {/* Top endpoints */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1">Top endpoints</div>
        <div className="space-y-1">
          {data.bridge.topEndpoints.slice(0, 8).map((ep, i) => {
            const pct = (ep.count / data.bridge.totalRequests) * 100
            return (
              <div key={i} className="flex items-center gap-2 text-[9px]">
                <span className="w-4 text-right text-muted-foreground/20 font-mono">{i + 1}</span>
                <div className="flex-1 relative h-4 rounded bg-surface-1/15 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/15 rounded"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative z-10 px-1.5 text-foreground/60 font-mono truncate block leading-4">
                    {ep.path}
                  </span>
                </div>
                <span className="text-muted-foreground/30 font-mono w-12 text-right">
                  {ep.count > 999 ? `${(ep.count / 1000).toFixed(1)}K` : ep.count}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Proxy health */}
      <div className="flex items-center gap-3 text-[9px] text-muted-foreground/30 pt-1 border-t border-border/10">
        <span>Proxy: {data.proxy.totalRequests.toLocaleString()} total</span>
        <span>·</span>
        <span className={data.proxy.error502 > 0 ? 'text-amber-400/60' : 'text-emerald-400/60'}>
          {data.proxy.error502} × 502
        </span>
        <span>·</span>
        <span>Up since {data.uptime.since}</span>
      </div>
    </div>
  )
}
