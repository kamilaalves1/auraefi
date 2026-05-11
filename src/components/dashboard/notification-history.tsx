'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * NotificationHistory — Amy's notification timeline
 * 
 * Shows delivered/queued notifications from intelligence reports,
 * council decisions, anomaly alerts, and more.
 */

type Notification = {
  timestamp: string
  text: string
  priority: string
  source: string
  category: string
  status: string
}

type NotifStats = {
  total: number
  today: number
  by_priority?: Record<string, number>
  by_category?: Record<string, number>
}

const PRIORITY_STYLES: Record<string, { icon: string; border: string; badge: string }> = {
  critical: { icon: '🚨', border: 'border-l-red-500', badge: 'bg-red-500/15 text-red-400' },
  urgent: { icon: '⚠️', border: 'border-l-amber-500', badge: 'bg-amber-500/15 text-amber-400' },
  high: { icon: '🔔', border: 'border-l-orange-500', badge: 'bg-orange-500/15 text-orange-400' },
  normal: { icon: '📬', border: 'border-l-blue-500/50', badge: 'bg-blue-500/15 text-blue-400' },
  low: { icon: '📋', border: 'border-l-slate-500/50', badge: 'bg-slate-500/15 text-slate-400' },
}

const CATEGORY_LABELS: Record<string, string> = {
  anomaly: '⚠️ Anomaly',
  council: '🏛️ Council',
  health: '💚 Health',
  task: '📋 Task',
  approval: '🔐 Approval',
}

const STATUS_DOTS: Record<string, string> = {
  delivered: 'bg-green-500',
  queued: 'bg-amber-500',
  failed: 'bg-red-500',
}

function formatNotifText(raw: string): string {
  // Strip Telegram markdown (*bold*, _italic_) for clean display
  return raw
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\\n/g, '\n')
}

function relativeTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`
  return `${Math.floor(diffSec / 86400)}d`
}

export function NotificationHistory() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [stats, setStats] = useState<NotifStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<string>('all')

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/notifications?limit=50')
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`)
      const data = await res.json()
      setNotifications(data.history || [])
      setStats(data.stats || null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 20000)
    return () => clearInterval(interval)
  }, [loadNotifications])

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const filtered = filter === 'all'
    ? notifications
    : notifications.filter(n => n.priority === filter || n.category === filter)

  const categories = [...new Set(notifications.map(n => n.category))]

  if (loading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 w-full rounded bg-surface-1/40" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
          <span className="text-red-400">⚠️ Notifications Offline</span>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50">
            {stats.total} total • {stats.today} today
          </span>
          <div className="flex gap-1.5 ml-auto">
            <button
              onClick={() => setFilter('all')}
              className={`rounded-full px-2 py-0.5 text-[9px] transition-colors ${
                filter === 'all' ? 'bg-primary/20 text-primary' : 'bg-surface-1/50 text-muted-foreground/50'
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(filter === cat ? 'all' : cat)}
                className={`rounded-full px-2 py-0.5 text-[9px] transition-colors ${
                  filter === cat ? 'bg-primary/20 text-primary' : 'bg-surface-1/50 text-muted-foreground/50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-3xl mb-2">🔔</div>
            <p className="text-xs text-muted-foreground/50">No notifications</p>
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((notif, idx) => {
              const style = PRIORITY_STYLES[notif.priority] || PRIORITY_STYLES.normal
              const isExpanded = expanded.has(idx)
              const catLabel = CATEGORY_LABELS[notif.category] || notif.category
              const statusDot = STATUS_DOTS[notif.status] || 'bg-muted'
              const lines = formatNotifText(notif.text).split('\n').filter(l => l.trim())

              return (
                <button
                  key={`${notif.timestamp}-${idx}`}
                  onClick={() => toggleExpand(idx)}
                  className={`w-full text-left px-4 py-2.5 border-l-2 ${style.border} hover:bg-accent/20 transition-colors ${
                    notif.priority === 'critical' ? 'bg-red-500/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm flex-shrink-0">{style.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${style.badge}`}>
                          {notif.priority}
                        </span>
                        <span className="text-[9px] text-muted-foreground/40">{catLabel}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                          <span className="text-[9px] text-muted-foreground/30">{notif.status}</span>
                        </div>
                      </div>

                      {/* Preview: first line */}
                      <p className="text-xs text-foreground/80 mt-0.5 truncate">
                        {lines[0] || 'Notification'}
                      </p>

                      {/* Expanded: full text */}
                      {isExpanded && lines.length > 1 && (
                        <div className="mt-1.5 rounded bg-surface-1/50 px-2 py-1.5 text-[10px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed">
                          {lines.slice(1).join('\n')}
                        </div>
                      )}

                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] text-muted-foreground/30">
                          {relativeTime(notif.timestamp)} ago
                        </span>
                        <span className="text-[9px] text-muted-foreground/20">
                          {notif.timestamp}
                        </span>
                        {lines.length > 1 && (
                          <span className="text-[8px] text-muted-foreground/25">
                            {isExpanded ? '▼' : '▶'} {lines.length - 1} more lines
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/30 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/40">
          {notifications.length} notifications • auto-refresh 20s
        </span>
        <button onClick={loadNotifications} className="text-[10px] text-primary/60 hover:text-primary transition-colors">
          Refresh
        </button>
      </div>
    </div>
  )
}
