'use client'

import { useState, useEffect } from 'react'

/**
 * ConfigViewer — Amy's configuration files displayed in dashboard
 *
 * Phase 137: Read-only viewer for openclaw.json, schedules.json, etc.
 * Shows expandable config cards with JSON content.
 */

interface ConfigFile {
  filename: string
  icon: string
  label: string
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
  size_human: string
  last_modified: string
  keys: number
}

export function ConfigViewer() {
  const [configs, setConfigs] = useState<ConfigFile[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const fetchConfigs = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3100/api/config-viewer')
        const data = await res.json()
        setConfigs(data.configs || [])
      } catch {
        setConfigs([])
      } finally {
        setLoading(false)
      }
    }
    fetchConfigs()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/50 text-xs p-4">
        <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        Loading configs...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📂</span>
          <h3 className="text-sm font-semibold text-foreground">Config Viewer</h3>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-orange-500/15 text-orange-300">
            {configs.length} files
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/40 font-mono">
          read-only
        </div>
      </div>

      {/* Config Cards */}
      <div className="space-y-2">
        {configs.map((cfg) => (
          <div key={cfg.filename} className="rounded-lg border border-border/30 overflow-hidden">
            {/* Card Header — clickable */}
            <button
              onClick={() => setExpanded(expanded === cfg.filename ? null : cfg.filename)}
              className="w-full flex items-center justify-between p-2.5 hover:bg-surface-1/30 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{cfg.icon}</span>
                <div>
                  <div className="text-xs font-medium text-foreground/90">{cfg.label}</div>
                  <div className="text-[10px] text-muted-foreground/40">{cfg.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-muted-foreground/30">{cfg.size_human} · {cfg.keys} keys</span>
                <span className={`text-[10px] text-muted-foreground/40 transition-transform ${
                  expanded === cfg.filename ? 'rotate-180' : ''
                }`}>▼</span>
              </div>
            </button>

            {/* Expanded JSON content */}
            {expanded === cfg.filename && (
              <div className="border-t border-border/20 bg-black/20 p-3 max-h-[250px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono text-muted-foreground/30">
                    {cfg.filename} · modified {new Date(cfg.last_modified).toLocaleString()}
                  </span>
                </div>
                <pre className="text-[10px] font-mono text-orange-300/70 whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(cfg.content, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tip */}
      <div className="px-3 py-1.5 rounded bg-surface-1/20 border border-border/10">
        <p className="text-[10px] text-muted-foreground/50 italic">
          💡 Click any config to expand its JSON content. Read-only view — edits require direct file access.
        </p>
      </div>
    </div>
  )
}
