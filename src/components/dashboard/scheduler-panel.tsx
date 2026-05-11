'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * SchedulerPanel — Amy's automation routines dashboard
 *
 * Shows 6 recurring routines with schedules, last run times,
 * status indicators, and expandable result previews.
 */

type Routine = {
  id: string
  name: string
  description: string
  enabled: boolean
  schedule: string
  days: string[]
  lastRun: string
  lastStatus: string
  lastResult: string
}

const ROUTINE_ICONS: Record<string, string> = {
  morning_brief: '☀️',
  knowledge_freshness: '📚',
  draft_cleanup: '🧹',
  route_analysis: '📊',
  intelligence_report: '🧠',
  anomaly_check: '🔍',
  council_review: '🏛️',
}

const DAY_LABELS: Record<string, string> = {
  mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S',
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return 'never'
  // Parse "2026-03-25 08:00 Europe/Madrid" format
  const parts = dateStr.split(' ')
  const dt = new Date(`${parts[0]}T${parts[1]}:00`)
  const diff = Date.now() - dt.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function cleanResult(text: string): string {
  // Strip markdown-style formatting
  return text
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/\n/g, ' · ')
    .trim()
}

export function SchedulerPanel() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [timezone, setTimezone] = useState('UTC')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/scheduler')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRoutines(data.routines || [])
      setTimezone(data.timezone || 'UTC')
    } catch {
      setRoutines([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  const enabledCount = routines.filter(r => r.enabled).length

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-surface-1/30" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-muted-foreground/40">
          {enabledCount}/{routines.length} active · {timezone}
        </span>
        <button
          onClick={fetchData}
          className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {routines.map(routine => {
        const icon = ROUTINE_ICONS[routine.id] || '⚙️'
        const isExpanded = expanded === routine.id
        const statusColor = routine.lastStatus === 'ok'
          ? 'text-emerald-400'
          : routine.lastStatus === 'never'
          ? 'text-zinc-500'
          : 'text-red-400'
        const statusBg = routine.lastStatus === 'ok'
          ? 'bg-emerald-500'
          : routine.lastStatus === 'never'
          ? 'bg-zinc-500'
          : 'bg-red-500'

        return (
          <div key={routine.id}>
            <button
              onClick={() => setExpanded(isExpanded ? null : routine.id)}
              className={`w-full rounded-lg border ${routine.enabled ? 'border-border/30' : 'border-border/10 opacity-50'} bg-surface-1/20 px-3 py-2 text-left transition-all hover:bg-surface-1/40`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm shrink-0">{icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-foreground">{routine.name}</span>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusBg} shrink-0`} />
                    </div>
                    <div className="text-[9px] text-muted-foreground/40 truncate">{routine.description}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-2">
                  {/* Schedule */}
                  <div className="text-right">
                    <div className="text-[10px] font-mono text-muted-foreground/60">{routine.schedule}</div>
                    <div className="flex gap-0.5 justify-end">
                      {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => (
                        <span
                          key={day}
                          className={`text-[7px] w-2.5 text-center ${
                            routine.days.includes(day) ? 'text-primary font-bold' : 'text-muted-foreground/20'
                          }`}
                        >
                          {DAY_LABELS[day]}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Last run */}
                  <div className="text-right min-w-[50px]">
                    <div className={`text-[10px] font-mono ${statusColor}`}>
                      {routine.lastStatus === 'ok' ? '✓' : routine.lastStatus === 'never' ? '—' : '✗'}
                    </div>
                    <div className="text-[8px] text-muted-foreground/30">{timeAgo(routine.lastRun)}</div>
                  </div>

                  <span className={`text-[10px] text-muted-foreground/20 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                </div>
              </div>
            </button>

            {/* Expanded — last result */}
            {isExpanded && routine.lastResult && (
              <div className="mt-1 ml-7 rounded-md border border-border/15 bg-surface-1/15 px-3 py-2 animate-in fade-in duration-200">
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Last result:</div>
                <div className="text-[10px] text-muted-foreground/70 font-mono leading-relaxed whitespace-pre-wrap">
                  {cleanResult(routine.lastResult)}
                </div>
                {routine.lastRun && (
                  <div className="text-[8px] text-muted-foreground/25 mt-1">{routine.lastRun}</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
