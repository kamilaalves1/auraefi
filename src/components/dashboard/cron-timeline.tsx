'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * CronTimeline — Scheduler routines + recent executions
 */

type Routine = {
  id: string; name: string; description: string
  enabled: boolean; schedule: string; days: string[]
}
type Execution = {
  timestamp: string; action: string; routine: string; duration: number
}

const DAY_SHORT: Record<string, string> = {
  mon: 'M', tue: 'T', wed: 'W', thu: 'Th', fri: 'F', sat: 'Sa', sun: 'Su'
}

export function CronTimeline() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [totalExec, setTotalExec] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/cron')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRoutines(data.routines || [])
      setExecutions(data.recentExecutions || [])
      setTotalExec(data.totalExecutions || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="h-32 rounded-lg bg-surface-1/30 animate-pulse" />

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold text-primary">{routines.length}</span>
          <span className="text-[9px] text-muted-foreground/30">routines</span>
        </div>
        <div className="h-3 w-px bg-border/20" />
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-foreground">{totalExec}</span>
          <span className="text-[9px] text-muted-foreground/30">executions</span>
        </div>
        <span className="text-[8px] text-muted-foreground/15 ml-auto">Europe/Madrid</span>
      </div>

      {/* Routine schedule */}
      <div className="space-y-1">
        {routines.map(r => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border border-border/10 bg-surface-1/10 px-2 py-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${r.enabled ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[9px] font-medium text-foreground/50 truncate">{r.name}</div>
            </div>
            <span className="text-[9px] font-mono text-primary/60">{r.schedule}</span>
            <div className="flex gap-px">
              {['mon','tue','wed','thu','fri','sat','sun'].map(d => (
                <span key={d} className={`text-[6px] w-3 text-center ${r.days.includes(d) ? 'text-primary/60 font-bold' : 'text-muted-foreground/15'}`}>
                  {DAY_SHORT[d]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Recent executions */}
      <div>
        <div className="text-[9px] text-muted-foreground/30 mb-1">Recent runs</div>
        <div className="space-y-0.5 max-h-[100px] overflow-y-auto scrollbar-thin pr-1">
          {executions.filter(e => e.action === 'completed').slice(0, 8).map((e, i) => (
            <div key={i} className="flex items-center justify-between text-[8px] rounded px-1.5 py-0.5 hover:bg-surface-1/15">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span className="text-foreground/40">{e.routine}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/20">{e.duration}s</span>
                <span className="text-muted-foreground/15 font-mono">{e.timestamp.split(' ')[1]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
