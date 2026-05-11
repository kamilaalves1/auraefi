'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * UptimeMonitor — Service uptime + process ages
 */

type ServiceStatus = {
  name: string
  port: number | null
  online: boolean
  uptime: string
  pid: string | null
}

export function UptimeMonitor() {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [systemUptime, setSystemUptime] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/uptime')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setServices(data.services || [])
      setOnlineCount(data.onlineCount || 0)
      setSystemUptime(data.systemUptime || '')
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  const allOnline = onlineCount === services.length

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${allOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
          <span className={`text-sm font-bold ${allOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
            {onlineCount}/{services.length}
          </span>
          <span className="text-[9px] text-muted-foreground/30">online</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <span className={`text-[10px] font-medium ${allOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
          {allOnline ? 'All Systems Operational' : 'Partial Service'}
        </span>
      </div>

      {/* Service grid */}
      <div className="space-y-1">
        {services.map(svc => (
          <div
            key={svc.name}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
              svc.online
                ? 'border-emerald-500/15 bg-emerald-500/5'
                : 'border-red-500/15 bg-red-500/5'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${svc.online ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-foreground/60">{svc.name}</div>
            </div>
            {svc.port && (
              <span className="text-[7px] text-muted-foreground/20 font-mono">:{svc.port}</span>
            )}
            <span className={`text-[9px] font-mono ${svc.online ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
              {svc.uptime}
            </span>
          </div>
        ))}
      </div>

      {/* System uptime */}
      {systemUptime && (
        <div className="text-[7px] text-muted-foreground/20 font-mono truncate">
          sys: {systemUptime}
        </div>
      )}
    </div>
  )
}
