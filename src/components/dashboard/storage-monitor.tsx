'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * StorageMonitor — Disk usage breakdown
 *
 * Shows storage by directory with proportional bars.
 */

type StorageEntry = {
  name: string
  path: string
  sizeKB: number
  sizeMB: number
  sizeGB: number
}

export function StorageMonitor() {
  const [breakdown, setBreakdown] = useState<StorageEntry[]>([])
  const [totalMB, setTotalMB] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/storage')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBreakdown(data.breakdown || [])
      setTotalMB(data.totalMB || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const maxSize = Math.max(...breakdown.map(b => b.sizeMB), 1)

  const COLORS = [
    'bg-primary/40',
    'bg-amber-500/40',
    'bg-emerald-500/40',
    'bg-cyan-500/40',
    'bg-pink-500/40',
  ]

  return (
    <div className="space-y-3">
      {/* Total */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-foreground">{totalMB > 1024 ? `${(totalMB / 1024).toFixed(1)}GB` : `${totalMB}MB`}</span>
        <span className="text-[9px] text-muted-foreground/30">engine core</span>
      </div>

      {/* Breakdown */}
      <div className="space-y-1.5">
        {breakdown.map((entry, i) => {
          const pct = (entry.sizeMB / maxSize) * 100
          return (
            <div key={entry.name}>
              <div className="flex items-center justify-between text-[9px] mb-0.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} />
                  <span className="text-foreground/50 font-medium">{entry.name}</span>
                </div>
                <span className="text-muted-foreground/25 font-mono">
                  {entry.sizeMB > 1024 ? `${entry.sizeGB}GB` : `${entry.sizeMB}MB`}
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-surface-1/15 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${COLORS[i % COLORS.length]} transition-all duration-500`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Path hints */}
      <div className="space-y-0.5">
        {breakdown.map(b => (
          <div key={b.path} className="text-[7px] text-muted-foreground/15 font-mono truncate">
            {b.path}
          </div>
        ))}
      </div>
    </div>
  )
}
