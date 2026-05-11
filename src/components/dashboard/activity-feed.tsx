'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * ActivityFeed — Real-time event stream from Amy's engines
 * 
 * Fetches from the Amy API Bridge (:3100/api/activity) and renders
 * as a beautiful timeline with icons, colors, and relative timestamps.
 */

type ActivityEvent = {
  timestamp: string
  event_type: string
  source: string
  summary: string
  details?: Record<string, unknown>
}

const EVENT_ICONS: Record<string, string> = {
  action_taken: '⚡',
  email_sent: '📧',
  approval_requested: '🔐',
  approval_decided: '✅',
  task_created: '📋',
  task_completed: '✔️',
  anomaly_detected: '⚠️',
  council_created: '🏛️',
  notification_sent: '🔔',
  routine_ran: '⏰',
}

const EVENT_COLORS: Record<string, string> = {
  action_taken: 'border-l-blue-500/60',
  email_sent: 'border-l-cyan-500/60',
  approval_requested: 'border-l-amber-500/60',
  approval_decided: 'border-l-green-500/60',
  task_created: 'border-l-purple-500/60',
  task_completed: 'border-l-emerald-500/60',
  anomaly_detected: 'border-l-red-500/60',
  council_created: 'border-l-indigo-500/60',
  notification_sent: 'border-l-yellow-500/60',
  routine_ran: 'border-l-slate-500/60',
}

const SOURCE_BADGES: Record<string, string> = {
  intelligence: 'bg-purple-500/15 text-purple-400',
  council: 'bg-indigo-500/15 text-indigo-400',
  approval: 'bg-amber-500/15 text-amber-400',
  tasks: 'bg-blue-500/15 text-blue-400',
  notifications: 'bg-yellow-500/15 text-yellow-400',
  scheduler: 'bg-slate-500/15 text-slate-400',
  email: 'bg-cyan-500/15 text-cyan-400',
}

function relativeTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) return 'now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`
  return then.toLocaleDateString()
}

function groupByDay(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>()
  for (const event of events) {
    const day = event.timestamp.split(' ')[0] // YYYY-MM-DD
    const label = formatDayLabel(day)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(event)
  }
  return groups
}

function formatDayLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/activity?limit=100')
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`)
      const data = await res.json()
      setEvents(data.events || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadActivity()
    const interval = setInterval(loadActivity, 15000) // Poll every 15s
    return () => clearInterval(interval)
  }, [loadActivity])

  const toggleExpand = (index: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.source === filter || e.event_type === filter)

  const grouped = groupByDay(filteredEvents)

  // Unique sources for filter
  const sources = [...new Set(events.map(e => e.source))]

  if (loading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex gap-3 items-start">
            <div className="w-5 h-5 rounded bg-surface-1/60" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-3/4 rounded bg-surface-1/60" />
              <div className="h-2 w-1/3 rounded bg-surface-1/40" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-red-400">
            <span>⚠️</span>
            <span className="font-medium">Activity Feed Offline</span>
          </div>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
          <button
            onClick={loadActivity}
            className="mt-2 rounded bg-red-500/20 px-3 py-1 text-xs text-red-300 hover:bg-red-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Filter:</span>
        <button
          onClick={() => setFilter('all')}
          className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
            filter === 'all'
              ? 'bg-primary/20 text-primary'
              : 'bg-surface-1/50 text-muted-foreground/60 hover:text-muted-foreground'
          }`}
        >
          All ({events.length})
        </button>
        {sources.map(source => {
          const count = events.filter(e => e.source === source).length
          const badgeClass = SOURCE_BADGES[source] || 'bg-muted text-muted-foreground'
          return (
            <button
              key={source}
              onClick={() => setFilter(filter === source ? 'all' : source)}
              className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                filter === source ? badgeClass : 'bg-surface-1/50 text-muted-foreground/60 hover:text-muted-foreground'
              }`}
            >
              {source} ({count})
            </button>
          )
        })}
      </div>

      {/* Event timeline */}
      <div className="flex-1 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground/50">
            No activity events recorded
          </div>
        ) : (
          <div className="py-2">
            {[...grouped.entries()].map(([dayLabel, dayEvents]) => (
              <div key={dayLabel}>
                {/* Day header */}
                <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm px-4 py-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                    {dayLabel}
                  </span>
                </div>

                {/* Day events */}
                {dayEvents.map((event, idx) => {
                  const globalIdx = filteredEvents.indexOf(event)
                  const isExpanded = expanded.has(globalIdx)
                  const icon = EVENT_ICONS[event.event_type] || '•'
                  const borderColor = EVENT_COLORS[event.event_type] || 'border-l-muted'
                  const sourceBadge = SOURCE_BADGES[event.source] || 'bg-muted text-muted-foreground'
                  const isCritical = event.details?.severity === 'critical'

                  return (
                    <button
                      key={`${event.timestamp}-${idx}`}
                      onClick={() => event.details && toggleExpand(globalIdx)}
                      className={`w-full text-left px-4 py-2 border-l-2 ${borderColor} hover:bg-accent/30 transition-colors ${
                        isCritical ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${sourceBadge}`}>
                              {event.source}
                            </span>
                            <span className="text-xs text-foreground/90 truncate">
                              {event.summary}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground/40">
                              {relativeTime(event.timestamp)}
                            </span>
                            <span className="text-[10px] text-muted-foreground/30">
                              {event.timestamp.split(' ')[1]}
                            </span>
                            {event.details && (
                              <span className="text-[9px] text-muted-foreground/30">
                                {isExpanded ? '▼' : '▶'} details
                              </span>
                            )}
                          </div>

                          {/* Expanded details */}
                          {isExpanded && event.details && (
                            <div className="mt-2 rounded bg-surface-1/50 px-2 py-1.5 text-[10px] font-mono text-muted-foreground/70">
                              {Object.entries(event.details).map(([key, val]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="text-muted-foreground/40">{key}:</span>
                                  <span className={key === 'severity' && val === 'critical' ? 'text-red-400' : ''}>
                                    {String(val)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: stats */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/30 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/40">
          {events.length} events • auto-refresh 15s
        </span>
        <button
          onClick={loadActivity}
          className="text-[10px] text-primary/60 hover:text-primary transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
