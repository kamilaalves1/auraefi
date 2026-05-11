'use client'

import { useState, useEffect } from 'react'

/**
 * KeyboardShortcuts — Power user shortcut reference
 *
 * Shows all keyboard shortcuts available in the dashboard.
 * When open, listens for keys to demonstrate live.
 */

const SHORTCUT_GROUPS = [
  {
    label: 'Navigation',
    icon: '🧭',
    shortcuts: [
      { keys: ['⌘', 'K'], desc: 'Open command bar' },
      { keys: ['/'], desc: 'Quick search focus' },
      { keys: ['Esc'], desc: 'Close modals / dismiss' },
      { keys: ['↑', '↓'], desc: 'Navigate sidebar items' },
    ],
  },
  {
    label: 'Dashboard',
    icon: '📊',
    shortcuts: [
      { keys: ['D'], desc: 'Go to Dashboard' },
      { keys: ['S'], desc: 'Go to Status page' },
      { keys: ['A'], desc: 'Focus Amy Chat' },
      { keys: ['R'], desc: 'Refresh all panels' },
    ],
  },
  {
    label: 'Operations',
    icon: '⚡',
    shortcuts: [
      { keys: ['⌘', 'Shift', 'T'], desc: 'Create new task' },
      { keys: ['⌘', 'Shift', 'A'], desc: 'Approve pending action' },
      { keys: ['⌘', 'Shift', 'L'], desc: 'Toggle system logs' },
      { keys: ['⌘', 'Shift', 'N'], desc: 'View notifications' },
    ],
  },
  {
    label: 'System',
    icon: '🛠️',
    shortcuts: [
      { keys: ['⌘', '.'], desc: 'Open settings' },
      { keys: ['?'], desc: 'Show this panel' },
      { keys: ['⌘', 'Shift', 'P'], desc: 'Command palette' },
    ],
  },
]

export function KeyboardShortcuts() {
  const [lastPressed, setLastPressed] = useState<string>('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const parts: string[] = []
      if (e.metaKey) parts.push('⌘')
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      if (e.key.length === 1) parts.push(e.key.toUpperCase())
      else parts.push(e.key)
      setLastPressed(parts.join(' + '))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="space-y-3">
      {/* Live key indicator */}
      {lastPressed && (
        <div className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5">
          <span className="text-[9px] text-muted-foreground/30">Last pressed:</span>
          <code className="text-[10px] text-primary font-mono font-bold">{lastPressed}</code>
        </div>
      )}

      {/* Shortcut groups */}
      <div className="space-y-3 max-h-[300px] overflow-y-auto scrollbar-thin pr-1">
        {SHORTCUT_GROUPS.map(group => (
          <div key={group.label}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-xs">{group.icon}</span>
              <span className="text-[10px] font-semibold text-foreground/60">{group.label}</span>
            </div>
            <div className="space-y-0.5">
              {group.shortcuts.map((sc, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-surface-1/15 transition-colors"
                >
                  <span className="text-[9px] text-foreground/50">{sc.desc}</span>
                  <div className="flex items-center gap-0.5">
                    {sc.keys.map((k, j) => (
                      <span key={j}>
                        <kbd className="inline-block min-w-[18px] text-center text-[8px] font-mono bg-surface-1/30 border border-border/20 rounded px-1 py-0.5 text-foreground/40">
                          {k}
                        </kbd>
                        {j < sc.keys.length - 1 && <span className="text-[7px] text-muted-foreground/15 mx-0.5">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
