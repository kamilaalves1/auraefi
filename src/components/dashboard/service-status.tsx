'use client'

import { useState, useEffect } from 'react'

/**
 * ServiceStatus — Real-time service health board
 *
 * Phase 133: Shows the status of all Amy services
 * (bridge, proxy, email, scheduler, gateway, VCC, council, ollama)
 */

interface Service {
  id: string
  name: string
  icon: string
  status: 'active' | 'idle' | 'stale' | 'down' | 'no-log' | 'unknown' | 'port-down' | 'error'
  port: number | null
  port_alive: boolean | null
  last_activity: string | null
}

interface StatusData {
  services: Service[]
  active: number
  total: number
  checked_at: string
  overall: string
}

const statusConfig: Record<string, { color: string; dot: string; label: string; bg: string }> = {
  active:   { color: 'text-emerald-400', dot: 'bg-emerald-500 shadow-emerald-500/50', label: 'Active',  bg: 'bg-emerald-500/8 border-emerald-500/20' },
  idle:     { color: 'text-amber-400',   dot: 'bg-amber-500 shadow-amber-500/50',     label: 'Idle',    bg: 'bg-amber-500/8 border-amber-500/20' },
  stale:    { color: 'text-zinc-500',    dot: 'bg-zinc-500 shadow-zinc-500/50',       label: 'Stale',   bg: 'bg-zinc-500/8 border-zinc-500/20' },
  down:     { color: 'text-red-400',     dot: 'bg-red-500 shadow-red-500/50',         label: 'Down',    bg: 'bg-red-500/8 border-red-500/20' },
  'port-down': { color: 'text-red-400',  dot: 'bg-red-500 shadow-red-500/50',         label: 'Port Down', bg: 'bg-red-500/8 border-red-500/20' },
  'no-log': { color: 'text-zinc-600',    dot: 'bg-zinc-600',                          label: 'No Log',  bg: 'bg-zinc-500/5 border-zinc-500/10' },
  unknown:  { color: 'text-zinc-600',    dot: 'bg-zinc-600',                          label: 'Unknown', bg: 'bg-zinc-500/5 border-zinc-500/10' },
  error:    { color: 'text-red-400',     dot: 'bg-red-500 shadow-red-500/50',         label: 'Error',   bg: 'bg-red-500/8 border-red-500/20' },
}

export function ServiceStatus() {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/service-status')
        const json = await res.json()
        setData(json)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/50 text-xs p-4">
        <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Scanning services...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-xs text-muted-foreground/40 p-4">
        ⚠️ Service monitor offline
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🖥️</span>
          <h3 className="text-sm font-semibold text-foreground">Service Status</h3>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
            data.overall === 'healthy'
              ? 'bg-emerald-500/15 text-emerald-300'
              : data.overall === 'degraded'
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-red-500/15 text-red-300'
          }`}>
            {data.active}/{data.total} active
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/40 font-mono">
          refreshes every 30s
        </div>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {data.services.map((svc) => {
          const cfg = statusConfig[svc.status] || statusConfig.unknown
          return (
            <div
              key={svc.id}
              className={`p-2.5 rounded-lg border transition-all hover:scale-[1.02] ${cfg.bg}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-2 h-2 rounded-full shadow-sm ${cfg.dot} ${
                  svc.status === 'active' ? 'animate-pulse' : ''
                }`} />
                <span className={`text-[11px] font-medium ${cfg.color}`}>{svc.icon} {svc.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-mono ${cfg.color}`}>
                  {cfg.label}
                </span>
                {svc.port && (
                  <span className="text-[9px] text-muted-foreground/30 font-mono">
                    :{svc.port}
                  </span>
                )}
              </div>
              {svc.last_activity && (
                <div className="text-[9px] text-muted-foreground/30 font-mono mt-0.5">
                  last: {svc.last_activity}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Green = active (log &lt; 5min or port responding). Amber = idle (5-60min). Gray = stale (&gt;1h). Red = down.
        </p>
      </div>
    </div>
  )
}
