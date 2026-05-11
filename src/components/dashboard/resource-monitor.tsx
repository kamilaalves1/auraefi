'use client'

import { useState, useEffect } from 'react'

/**
 * ResourceMonitor — Live CPU, Memory, Disk gauges
 *
 * Phase 138: Shows host resource usage with visual progress bars.
 */

interface ResourceData {
  disk: { total_gb: number; used_gb: number; free_gb: number; usage_pct: number }
  memory: { total_gb: number; used_gb: number; usage_pct: number }
  cpu: { load_1m: number; load_5m: number; load_15m: number }
  processes: number
}

function Gauge({ label, icon, pct, detail }: { label: string; icon: string; pct: number; detail: string }) {
  const color = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'
  const textColor = pct > 85 ? 'text-red-400' : pct > 65 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <div className="flex-1 p-2.5 rounded-lg border border-border/20 bg-surface-1/10">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-muted-foreground/60">{icon} {label}</span>
        <span className={`text-sm font-bold font-mono ${textColor}`}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="text-[9px] text-muted-foreground/30 font-mono mt-1">{detail}</div>
    </div>
  )
}

export function ResourceMonitor() {
  const [data, setData] = useState<ResourceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchResources = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/resources')
        const json = await res.json()
        setData(json)
      } catch {
        setData(null)
      } finally {
        setLoading(false)
      }
    }
    fetchResources()
    const interval = setInterval(fetchResources, 15_000) // Every 15s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/50 text-xs p-4">
        <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Scanning resources...
      </div>
    )
  }

  if (!data) {
    return <div className="text-xs text-muted-foreground/40 p-4">⚠️ Resource monitor offline</div>
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="text-sm font-semibold text-foreground">Resource Monitor</h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-teal-500/15 text-teal-300">
            live
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/40 font-mono">
          {data.processes} processes · refreshes 15s
        </div>
      </div>

      {/* Gauges */}
      <div className="flex gap-2">
        <Gauge
          label="Disk" icon="💾"
          pct={data.disk.usage_pct}
          detail={`${data.disk.used_gb}GB / ${data.disk.total_gb}GB (${data.disk.free_gb}GB free)`}
        />
        <Gauge
          label="Memory" icon="🧠"
          pct={data.memory.usage_pct}
          detail={`${data.memory.used_gb}GB / ${data.memory.total_gb}GB`}
        />
        <div className="flex-1 p-2.5 rounded-lg border border-border/20 bg-surface-1/10">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-muted-foreground/60">⚡ CPU Load</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold font-mono text-teal-400">{data.cpu.load_1m}</span>
            <span className="text-[10px] text-muted-foreground/30">{data.cpu.load_5m}</span>
            <span className="text-[10px] text-muted-foreground/20">{data.cpu.load_15m}</span>
          </div>
          <div className="text-[9px] text-muted-foreground/30 font-mono mt-1">1m · 5m · 15m avg</div>
        </div>
      </div>

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Green &lt; 65%, Amber 65-85%, Red &gt; 85%. CPU load shows 1/5/15 min averages.
        </p>
      </div>
    </div>
  )
}
