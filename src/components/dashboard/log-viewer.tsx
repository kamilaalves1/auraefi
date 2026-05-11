'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * LogViewer — Real-time system log tail
 *
 * Tab-based log viewer with auto-scroll, line count,
 * file size indicators, and live refresh.
 */

type LogMeta = {
  name: string
  filename: string
  size: number
  sizeHuman: string
  modified: number
}

const LOG_ICONS: Record<string, string> = {
  'amy-proxy': '🔀',
  'api-bridge': '🌉',
  'approval-gate': '🔐',
  'council': '🏛️',
  'email-lane': '📧',
  'gateway': '🚪',
  'intelligence': '🧠',
  'route': '🛣️',
  'scheduler': '⏰',
  'task-queue': '📋',
}

export function LogViewer() {
  const [logs, setLogs] = useState<LogMeta[]>([])
  const [selectedLog, setSelectedLog] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchLogList = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/logs')
      if (!res.ok) return
      const data = await res.json()
      setLogs(data.logs || [])
      // Auto-select first log
      if (!selectedLog && data.logs?.length > 0) {
        setSelectedLog(data.logs[0].name)
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [selectedLog])

  const fetchLogTail = useCallback(async (name: string) => {
    if (!name) return
    try {
      const res = await fetch(`http://127.0.0.1:3100/api/logs?name=${name}&lines=50`)
      if (!res.ok) return
      const data = await res.json()
      setLines(data.lines || [])
      setTotal(data.total || 0)
      // Auto-scroll to bottom
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
      })
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchLogList() }, [fetchLogList])
  useEffect(() => {
    if (selectedLog) fetchLogTail(selectedLog)
  }, [selectedLog, fetchLogTail])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !selectedLog) return
    const interval = setInterval(() => fetchLogTail(selectedLog), 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, selectedLog, fetchLogTail])

  if (loading) {
    return <div className="h-48 rounded-lg bg-surface-1/30 animate-pulse" />
  }

  const selectedMeta = logs.find(l => l.name === selectedLog)

  return (
    <div className="space-y-2">
      {/* Log tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
        {logs.map(log => (
          <button
            key={log.name}
            onClick={() => setSelectedLog(log.name)}
            className={`shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-all ${
              selectedLog === log.name
                ? 'bg-primary/15 text-primary font-medium border border-primary/30'
                : 'bg-surface-1/20 text-muted-foreground/50 border border-border/15 hover:bg-surface-1/40'
            }`}
          >
            <span className="text-xs">{LOG_ICONS[log.name] || '📄'}</span>
            <span>{log.name}</span>
            <span className="text-[8px] opacity-50">{log.sizeHuman}</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[9px] text-muted-foreground/30 font-mono">
          {selectedMeta?.filename} · {total} lines · {selectedMeta?.sizeHuman}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
              autoRefresh ? 'bg-emerald-500/15 text-emerald-400' : 'text-muted-foreground/30 hover:text-foreground'
            }`}
          >
            {autoRefresh ? '● LIVE' : '○ Live'}
          </button>
          <button
            onClick={() => fetchLogTail(selectedLog)}
            className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="rounded-lg border border-border/20 bg-black/30 p-2 h-64 overflow-y-auto font-mono text-[9px] leading-relaxed scrollbar-thin"
      >
        {lines.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground/20">No log entries</div>
        ) : (
          lines.map((line, i) => {
            // Color code log levels
            const isError = /error|fail|exception|traceback/i.test(line)
            const isWarn = /warn|caution/i.test(line)
            const isOk = /ok|success|complete|approve/i.test(line)

            return (
              <div
                key={i}
                className={`py-0.5 border-b border-border/5 whitespace-pre-wrap break-all ${
                  isError ? 'text-red-400/80' :
                  isWarn ? 'text-amber-400/70' :
                  isOk ? 'text-emerald-400/50' :
                  'text-muted-foreground/50'
                }`}
              >
                <span className="text-muted-foreground/15 select-none mr-2">{(total - lines.length + i + 1).toString().padStart(4)}</span>
                {line}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
