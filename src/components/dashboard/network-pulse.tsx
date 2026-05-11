'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * NetworkPulse — Real-time port scan + latencies
 */

type PortResult = {
  name: string; host: string; port: number; tech: string
  online: boolean; latencyMs: number | null
}

export function NetworkPulse() {
  const [services, setServices] = useState<PortResult[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [avgLatency, setAvgLatency] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/network')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setServices(data.services || [])
      setOnlineCount(data.onlineCount || 0)
      setAvgLatency(data.avgLatency || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  return (
    <div className="space-y-3">
      {/* Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full animate-pulse ${
            onlineCount === services.length ? 'bg-emerald-400' :
            onlineCount > 0 ? 'bg-amber-400' : 'bg-red-400'
          }`} />
          <span className="text-lg font-bold text-foreground">{onlineCount}/{services.length}</span>
          <span className="text-[9px] text-muted-foreground/30">ports open</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-emerald-400">{avgLatency}ms</span>
          <span className="text-[9px] text-muted-foreground/30">avg latency</span>
        </div>
      </div>

      {/* Port grid */}
      <div className="grid grid-cols-2 gap-1.5">
        {services.map(svc => (
          <div
            key={svc.port}
            className={`relative rounded-lg border p-2.5 transition-all ${
              svc.online
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-zinc-700/20 bg-zinc-900/10'
            }`}
          >
            {/* Status dot + pulse */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${svc.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              <span className="text-[9px] font-medium text-foreground/50 truncate">{svc.name}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[8px] font-mono text-primary/40">:{svc.port}</span>
              <span className="text-[7px] text-muted-foreground/20">{svc.tech}</span>
            </div>

            {svc.online && svc.latencyMs !== null && (
              <div className="mt-1">
                <div className="relative h-1 rounded-full bg-surface-1/10 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/40 transition-all"
                    style={{ width: `${Math.min(svc.latencyMs * 100, 100)}%` }}
                  />
                </div>
                <div className="text-[6px] text-emerald-400/40 text-right mt-0.5">{svc.latencyMs}ms</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
