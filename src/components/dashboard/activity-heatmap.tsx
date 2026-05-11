'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * ActivityHeatmap — 30-Day GitHub-Style Contribution Grid
 *
 * Phase 127: Shows Amy's daily activity intensity as colored cells.
 * Hover any cell for details. Stats bar with streak, active days.
 */

type DayData = {
  date: string
  day: string
  total: number
  level: number
  logs: Record<string, number>
  is_today: boolean
}

type HeatmapData = {
  days: DayData[]
  total_events: number
  active_days: number
  busiest_day: string | null
  busiest_count: number
  current_streak: number
  timestamp: string
}

const LEVEL_COLORS = [
  'bg-zinc-800/50',          // 0 - empty
  'bg-violet-900/60',        // 1 - low
  'bg-violet-700/70',        // 2 - medium
  'bg-violet-500/80',        // 3 - high
  'bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.4)]', // 4 - peak
]

export function ActivityHeatmap() {
  const [data, setData] = useState<HeatmapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hoveredDay, setHoveredDay] = useState<DayData | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/activity-heatmap')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 120000) // 2min refresh
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-surface-2 rounded w-1/4" />
        <div className="h-12 bg-surface-2 rounded" />
      </div>
    </div>
  )

  if (!data) return (
    <div className="bg-surface-1 rounded-xl border border-border/50 p-6">
      <p className="text-muted-foreground text-sm">Activity heatmap unavailable</p>
    </div>
  )

  // Group days into weeks (rows of 7)
  const weeks: DayData[][] = []
  for (let i = 0; i < data.days.length; i += 7) {
    weeks.push(data.days.slice(i, i + 7))
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr + 'T12:00:00')
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return dateStr }
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">🗓️</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Activity Heatmap</h3>
            <p className="text-xs text-muted-foreground">30-day operational footprint</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data.current_streak > 0 && (
            <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-orange-400/10 text-orange-400 border border-orange-400/20">
              🔥 {data.current_streak}d streak
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full text-2xs font-mono bg-violet-400/10 text-violet-300 border border-violet-400/20">
            {data.active_days}/30 active
          </span>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="px-5 py-4">
        <div className="flex flex-col gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex gap-[3px]">
              {week.map((day) => (
                <div
                  key={day.date}
                  className={`relative flex-1 h-8 rounded-sm transition-all duration-200 cursor-pointer hover:ring-1 hover:ring-violet-400/50 ${LEVEL_COLORS[day.level]} ${day.is_today ? 'ring-1 ring-violet-400/60' : ''}`}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                >
                  {/* Day label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[8px] text-muted-foreground/50 leading-none">{day.day.slice(0, 1)}</span>
                    <span className={`text-[9px] font-mono leading-none mt-0.5 ${day.total > 0 ? 'text-foreground/60' : 'text-muted-foreground/20'}`}>
                      {day.total > 999 ? `${(day.total / 1000).toFixed(0)}K` : day.total || '·'}
                    </span>
                  </div>
                </div>
              ))}
              {/* Pad incomplete weeks */}
              {week.length < 7 && Array.from({ length: 7 - week.length }).map((_, i) => (
                <div key={`pad-${i}`} className="flex-1 h-8" />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-2xs text-muted-foreground">{formatDate(data.days[0]?.date || '')} — {formatDate(data.days[data.days.length - 1]?.date || '')}</span>
          <div className="flex items-center gap-1">
            <span className="text-2xs text-muted-foreground mr-1">Less</span>
            {LEVEL_COLORS.map((color, i) => (
              <div key={i} className={`w-3 h-3 rounded-sm ${color}`} />
            ))}
            <span className="text-2xs text-muted-foreground ml-1">More</span>
          </div>
        </div>
      </div>

      {/* Hover detail strip */}
      <div className="px-5 py-2.5 border-t border-border/20 min-h-[36px]">
        {hoveredDay ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">
              <span className="font-medium">{formatDate(hoveredDay.date)}</span>
              <span className="text-muted-foreground ml-1">({hoveredDay.day})</span>
              {hoveredDay.is_today && <span className="text-violet-400 ml-1">· Today</span>}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-foreground">{hoveredDay.total.toLocaleString()} events</span>
              <div className="flex gap-2">
                {Object.entries(hoveredDay.logs).filter(([, v]) => v > 0).map(([key, val]) => (
                  <span key={key} className="text-2xs text-muted-foreground font-mono">
                    {key.split('-')[0]}: {val > 999 ? `${(val / 1000).toFixed(1)}K` : val}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">
              {data.total_events.toLocaleString()} total events · Hover for details
            </span>
            {data.busiest_day && (
              <span className="text-2xs text-muted-foreground">
                🏆 Peak: {formatDate(data.busiest_day)} ({data.busiest_count.toLocaleString()})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
