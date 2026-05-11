'use client'

import { useState, useEffect } from 'react'

/**
 * SystemPulse — Compact status bar at the very top
 *
 * Phase 140: One-line at-a-glance health strip.
 * Aggregates: services, uptime, disk, memory, alerts, events.
 * The "CTO glances at dashboard, knows everything is fine" bar.
 */

interface PulseData {
  services: { online: number; total: number }
  uptime: string
  disk: number
  memory: number
  alerts: number
  events: number
  cpu: number
}

export function SystemPulse() {
  const [data, setData] = useState<PulseData | null>(null)

  useEffect(() => {
    const fetchPulse = async () => {
      try {
        const [uptimeRes, resourcesRes, alertsRes, eventsRes, serviceRes] = await Promise.allSettled([
          fetch('http://127.0.0.1:3100/api/uptime'),
          fetch('http://127.0.0.1:3100/api/resources'),
          fetch('http://127.0.0.1:3100/api/alert-rules'),
          fetch('http://127.0.0.1:3100/api/event-timeline'),
          fetch('http://127.0.0.1:3100/api/service-status'),
        ])

        const uptime = uptimeRes.status === 'fulfilled' ? await uptimeRes.value.json() : null
        const resources = resourcesRes.status === 'fulfilled' ? await resourcesRes.value.json() : null
        const alerts = alertsRes.status === 'fulfilled' ? await alertsRes.value.json() : null
        const events = eventsRes.status === 'fulfilled' ? await eventsRes.value.json() : null
        const service = serviceRes.status === 'fulfilled' ? await serviceRes.value.json() : null

        const alertCount = alerts?.rules?.filter((r: { status: string }) => r.status === 'alert')?.length || 0

        setData({
          services: {
            online: service?.services?.filter((s: { status: string }) => s.status === 'active')?.length ?? uptime?.onlineCount ?? 0,
            total: service?.services?.length ?? uptime?.totalServices ?? 0,
          },
          uptime: uptime?.uptime_human || '—',
          disk: resources?.disk?.usage_pct ?? -1,
          memory: resources?.memory?.usage_pct ?? -1,
          alerts: alertCount,
          events: events?.count ?? 0,
          cpu: resources?.cpu?.load_1m ?? -1,
        })
      } catch {
        // silent
      }
    }
    fetchPulse()
    const interval = setInterval(fetchPulse, 20_000)
    return () => clearInterval(interval)
  }, [])

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 p-1.5 text-muted-foreground/30 text-[10px] font-mono">
        <span className="w-2 h-2 rounded-full border border-primary/30 border-t-primary animate-spin" />
        Initializing pulse...
      </div>
    )
  }

  const allGreen = data.services.online === data.services.total && data.alerts === 0
  const statusDot = allGreen ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-amber-500 shadow-amber-500/50'
  const statusText = allGreen ? 'ALL SYSTEMS OPERATIONAL' : 'ATTENTION REQUIRED'

  const pctColor = (pct: number) =>
    pct > 85 ? 'text-red-400' : pct > 65 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-black/20 border-b border-border/10 font-mono text-[10px]">
      {/* Left: Status + Services */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse shadow-sm ${statusDot}`} />
          <span className="text-muted-foreground/50 tracking-wider">{statusText}</span>
        </div>
        <span className="text-border/30">│</span>
        <span className="text-emerald-400/70">
          🖥️ {data.services.online}/{data.services.total}
        </span>
        <span className="text-border/30">│</span>
        <span className="text-emerald-400/70">
          ⏱️ {data.uptime}
        </span>
      </div>

      {/* Right: Resources + Alerts */}
      <div className="flex items-center gap-3">
        {data.disk >= 0 && (
          <span className={pctColor(data.disk)}>
            💾 {data.disk}%
          </span>
        )}
        {data.memory >= 0 && (
          <span className={pctColor(data.memory)}>
            🧠 {data.memory}%
          </span>
        )}
        {data.cpu >= 0 && (
          <>
            <span className="text-border/30">│</span>
            <span className="text-teal-400/70">
              ⚡ {data.cpu}
            </span>
          </>
        )}
        <span className="text-border/30">│</span>
        {data.alerts > 0 ? (
          <span className="text-red-400 font-bold">
            🔔 {data.alerts} alerts
          </span>
        ) : (
          <span className="text-emerald-400/50">
            🔔 0
          </span>
        )}
        <span className="text-muted-foreground/20">
          📜 {data.events}
        </span>
      </div>
    </div>
  )
}
