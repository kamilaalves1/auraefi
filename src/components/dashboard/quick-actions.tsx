'use client'

import { useState } from 'react'

/**
 * QuickActions — One-click operational commands
 *
 * Phase 134: Interactive buttons that trigger operations
 * via POST /api/quick-action
 */

interface ActionResult {
  action: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

const actions = [
  { id: 'health-check',   icon: '🩺', label: 'Health Check',    desc: 'Probe all services' },
  { id: 'bridge-ping',    icon: '🏓', label: 'Ping Bridge',     desc: 'Bridge connectivity' },
  { id: 'log-summary',    icon: '📊', label: 'Log Summary',     desc: 'Log file sizes' },
  { id: 'system-snapshot', icon: '💾', label: 'System Snapshot', desc: 'Disk + log volume' },
  { id: 'clear-old-logs', icon: '🧹', label: 'Check Large Logs', desc: 'Find logs > 10MB' },
]

export function QuickActions() {
  const [loading, setLoading] = useState<string | null>(null)
  const [result, setResult] = useState<ActionResult | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)

  const runAction = async (actionId: string) => {
    setLoading(actionId)
    setResult(null)
    try {
      const res = await fetch('http://127.0.0.1:3100/api/quick-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionId }),
      })
      const data = await res.json()
      setResult(data)
      setLastAction(actionId)
    } catch {
      setResult({ action: actionId, error: 'Bridge unreachable' })
    } finally {
      setLoading(null)
    }
  }

  const renderResult = () => {
    if (!result) return null

    if (result.error) {
      return <div className="text-red-400 text-xs">⚠️ {result.error}</div>
    }

    switch (result.action) {
      case 'health-check':
        return (
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(result.result || {}).map(([name, status]) => (
              <div key={name} className="flex items-center gap-1.5 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status === 'up' || status === 'active' ? 'bg-emerald-500' :
                  status === 'idle' ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                <span className="text-muted-foreground/70">{name}</span>
                <span className={`font-mono text-[10px] ${
                  status === 'up' || status === 'active' ? 'text-emerald-400' :
                  status === 'idle' ? 'text-amber-400' : 'text-red-400'
                }`}>{String(status)}</span>
              </div>
            ))}
          </div>
        )
      case 'bridge-ping':
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-emerald-400">🏓 PONG!</span>
            <span className="text-muted-foreground/50">{result.uptime_info}</span>
          </div>
        )
      case 'log-summary':
        return (
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(result.logs || {}).map(([name, info]) => (
              <div key={name} className="flex justify-between text-[10px] font-mono">
                <span className="text-muted-foreground/60 truncate">{name}</span>
                <span className="text-foreground/70">{(info as {human: string}).human}</span>
              </div>
            ))}
          </div>
        )
      case 'system-snapshot':
        return (
          <div className="flex items-center gap-4 text-xs">
            <span>💾 Disk: <strong className="text-foreground">{result.disk_usage_pct}%</strong></span>
            <span>📝 Logs: <strong className="text-foreground">{(result.total_log_lines || 0).toLocaleString()}</strong> lines</span>
          </div>
        )
      case 'clear-old-logs':
        return (
          <div className="text-xs">
            {result.count === 0 ? (
              <span className="text-emerald-400">✅ No large logs found (all &lt; 10MB)</span>
            ) : (
              <div>
                <span className="text-amber-400">⚠️ {result.count} large files:</span>
                {(result.large_files || []).map((f: {file: string; size_mb: number}) => (
                  <div key={f.file} className="text-[10px] font-mono text-muted-foreground/60 ml-4">
                    {f.file}: {f.size_mb}MB
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      default:
        return <pre className="text-[10px] text-muted-foreground/50 font-mono">{JSON.stringify(result, null, 2)}</pre>
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">⚡</span>
        <h3 className="text-sm font-semibold text-foreground">Quick Actions</h3>
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-500/15 text-cyan-300">
          interactive
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => runAction(action.id)}
            disabled={loading !== null}
            className={`group px-3 py-2 rounded-lg border transition-all text-left ${
              loading === action.id
                ? 'bg-cyan-500/10 border-cyan-500/30 cursor-wait'
                : lastAction === action.id && result
                ? 'bg-cyan-500/8 border-cyan-500/20'
                : 'bg-surface-1/30 border-border/20 hover:bg-cyan-500/10 hover:border-cyan-500/30 cursor-pointer hover:scale-[1.02]'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {loading === action.id ? (
                <span className="w-3 h-3 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
              ) : (
                <span className="text-sm">{action.icon}</span>
              )}
              <span className="text-xs font-medium text-foreground/90">{action.label}</span>
            </div>
            <div className="text-[9px] text-muted-foreground/40 mt-0.5">{action.desc}</div>
          </button>
        ))}
      </div>

      {/* Result Panel */}
      {result && (
        <div className="p-3 rounded-lg bg-surface-1/30 border border-cyan-500/15">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-cyan-400/70">
              {result.action} · {result.timestamp ? new Date(result.timestamp).toLocaleTimeString() : ''}
            </span>
          </div>
          {renderResult()}
        </div>
      )}

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Click any action to execute it instantly. Results appear below. Safe operations only — no destructive actions.
        </p>
      </div>
    </div>
  )
}
