'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * DependencyMap — Module import relationships
 */

type ModuleInfo = {
  name: string; imports: string[]; importCount: number
  dependants: number; lines: number
}
type Edge = { from: string; to: string }

function getNodeColor(dependants: number): string {
  if (dependants >= 5) return 'bg-amber-400'      // core
  if (dependants >= 2) return 'bg-primary'          // hub
  if (dependants >= 1) return 'bg-emerald-400'      // feeder
  return 'bg-zinc-500'                              // leaf
}

function getNodeSize(dependants: number): string {
  if (dependants >= 5) return 'w-3 h-3'
  if (dependants >= 2) return 'w-2.5 h-2.5'
  return 'w-2 h-2'
}

export function DependencyMap() {
  const [modules, setModules] = useState<Record<string, ModuleInfo>>({})
  const [edges, setEdges] = useState<Edge[]>([])
  const [totalModules, setTotalModules] = useState(0)
  const [totalEdges, setTotalEdges] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/dependencies')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setModules(data.modules || {})
      setEdges(data.edges || [])
      setTotalModules(data.totalModules || 0)
      setTotalEdges(data.totalEdges || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  const sorted = Object.entries(modules).sort((a, b) => b[1].dependants - a[1].dependants)
  const maxLines = Math.max(...Object.values(modules).map(m => m.lines), 1)

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-primary">{totalModules}</span>
          <span className="text-[9px] text-muted-foreground/30">modules</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{totalEdges}</span>
          <span className="text-[9px] text-muted-foreground/30">edges</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex gap-1.5 text-[7px]">
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> core</span>
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-primary" /> hub</span>
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> feeder</span>
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-zinc-500" /> leaf</span>
        </div>
      </div>

      {/* Module list with dependency indicators */}
      <div className="space-y-0.5 max-h-[220px] overflow-y-auto scrollbar-thin pr-1">
        {sorted.map(([key, mod]) => (
          <div key={key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-1/15 transition-colors">
            <span className={`${getNodeSize(mod.dependants)} ${getNodeColor(mod.dependants)} rounded-full shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-mono font-medium text-foreground/50">{mod.name}</div>
              {mod.imports.length > 0 && (
                <div className="text-[7px] text-muted-foreground/20">
                  → {mod.imports.map(i => i.replace('amy_', '')).join(', ')}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {mod.dependants > 0 && (
                <span className="text-[7px] text-amber-400/50 font-mono">↑{mod.dependants}</span>
              )}
              <div className="relative w-12 h-1.5 rounded-full bg-surface-1/10 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/20"
                  style={{ width: `${(mod.lines / maxLines) * 100}%` }}
                />
              </div>
              <span className="text-[7px] text-muted-foreground/20 w-6 text-right font-mono">{mod.lines}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
