'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * TelegramMonitor — Bot session status
 *
 * Shows active sessions, message counts,
 * last activity timestamps, and intent tracking.
 */

type TelegramSession = {
  id: string
  isMain: boolean
  lastUpdated: string
  lastIntent: string
  lastSeenMessageId: string | null
  messageCount: number
}

const INTENT_CONFIG: Record<string, { color: string; icon: string }> = {
  chat_lane: { color: 'text-blue-400', icon: '💬' },
  email_lane: { color: 'text-amber-400', icon: '📧' },
  approval_lane: { color: 'text-emerald-400', icon: '✅' },
  command_lane: { color: 'text-purple-400', icon: '⚡' },
  unknown: { color: 'text-zinc-400', icon: '❓' },
}

export function TelegramMonitor() {
  const [sessions, setSessions] = useState<TelegramSession[]>([])
  const [totalMessages, setTotalMessages] = useState(0)
  const [totalSessions, setTotalSessions] = useState(0)
  const [botActive, setBotActive] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/telegram')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSessions(data.sessions || [])
      setTotalMessages(data.totalMessages || 0)
      setTotalSessions(data.totalSessions || 0)
      setBotActive(data.botActive || false)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${botActive ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-[10px] font-medium text-foreground">{botActive ? 'Bot Active' : 'Bot Offline'}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <span className="text-sm font-bold text-primary">{totalSessions}</span>
            <span className="text-[8px] text-muted-foreground/30 ml-1">sessions</span>
          </div>
          <div className="text-center">
            <span className="text-sm font-bold text-foreground">{totalMessages}</span>
            <span className="text-[8px] text-muted-foreground/30 ml-1">messages</span>
          </div>
        </div>
      </div>

      {/* Session list */}
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1">
        {sessions.map(session => {
          const intentCfg = INTENT_CONFIG[session.lastIntent] || INTENT_CONFIG.unknown
          const isRecent = session.lastUpdated && new Date(session.lastUpdated) > new Date(Date.now() - 86400000)

          return (
            <div
              key={session.id}
              className={`rounded-md border px-2.5 py-2 ${
                session.isMain
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/15 bg-surface-1/10'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  {session.isMain && <span className="text-[8px] bg-primary/20 text-primary px-1 rounded font-medium">MAIN</span>}
                  <span className="text-[9px] font-mono text-foreground/50 truncate max-w-[160px]">
                    {session.id}
                  </span>
                </div>
                <span className={`text-[9px] ${isRecent ? 'text-emerald-400' : 'text-muted-foreground/25'}`}>
                  {session.messageCount} msgs
                </span>
              </div>

              <div className="flex items-center gap-3 text-[8px]">
                <div className="flex items-center gap-1">
                  <span>{intentCfg.icon}</span>
                  <span className={intentCfg.color}>{session.lastIntent}</span>
                </div>
                {session.lastSeenMessageId && (
                  <span className="text-muted-foreground/20">msg #{session.lastSeenMessageId}</span>
                )}
                <span className="text-muted-foreground/15 ml-auto">
                  {session.lastUpdated ? new Date(session.lastUpdated).toLocaleDateString('en-GB') : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
