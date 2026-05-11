'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * EnvironmentInspector — System environment overview
 *
 * Shows engines, services, log stats, vault size,
 * and test coverage in a compact card layout.
 */

type EnvData = {
  engines: { name: string; size: number }[]
  engineCount: number
  testCount: number
  logs: { name: string; size: number; lines: number }[]
  totalLogLines: number
  vaultFiles: number
  vaultSize: number
  services: { name: string; port: number; online: boolean }[]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

export function EnvironmentInspector() {
  const [data, setData] = useState<EnvData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/environment')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading || !data) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  return (
    <div className="space-y-3">
      {/* Services status strip */}
      <div className="flex items-center gap-2">
        {data.services.map(svc => (
          <div key={svc.port} className="flex items-center gap-1.5 rounded-md bg-surface-1/20 border border-border/15 px-2 py-1">
            <span className={`w-1.5 h-1.5 rounded-full ${svc.online ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-[9px] text-foreground/50">{svc.name}</span>
            <span className="text-[7px] text-muted-foreground/20">:{svc.port}</span>
          </div>
        ))}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-primary">{data.engineCount}</div>
          <div className="text-[8px] text-muted-foreground/30">Engines</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-emerald-400">{data.testCount}</div>
          <div className="text-[8px] text-muted-foreground/30">Test Suites</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-foreground">{(data.totalLogLines / 1000).toFixed(0)}K</div>
          <div className="text-[8px] text-muted-foreground/30">Log Lines</div>
        </div>
        <div className="rounded-md bg-surface-1/20 border border-border/15 p-2 text-center">
          <div className="text-lg font-bold text-amber-400">{data.vaultFiles}</div>
          <div className="text-[8px] text-muted-foreground/30">Vault Files</div>
        </div>
      </div>

      {/* Engine list */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1">Engine modules</div>
        <div className="grid grid-cols-2 gap-1">
          {data.engines.slice(0, 12).map(eng => (
            <div key={eng.name} className="flex items-center justify-between rounded px-1.5 py-0.5 hover:bg-surface-1/15 transition-colors">
              <span className="text-[8px] text-foreground/50 font-mono truncate">{eng.name.replace('.py', '')}</span>
              <span className="text-[7px] text-muted-foreground/20">{formatBytes(eng.size)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Log breakdown */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1">Log volumes</div>
        <div className="space-y-0.5">
          {data.logs.sort((a, b) => b.lines - a.lines).slice(0, 6).map(log => {
            const pct = (log.lines / data.totalLogLines) * 100
            return (
              <div key={log.name} className="flex items-center gap-2 text-[8px]">
                <div className="flex-1 relative h-3.5 rounded bg-surface-1/15 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/15 rounded"
                    style={{ width: `${Math.max(pct, 1)}%` }}
                  />
                  <span className="relative z-10 px-1.5 text-foreground/40 font-mono leading-[14px] truncate block">
                    {log.name}
                  </span>
                </div>
                <span className="text-muted-foreground/25 font-mono w-10 text-right shrink-0">
                  {log.lines > 999 ? `${(log.lines / 1000).toFixed(0)}K` : log.lines}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
