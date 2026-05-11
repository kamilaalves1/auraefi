'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * TaskBoard — Create and manage Amy's task queue
 * 
 * Fetches from Amy API Bridge (:3100/api/tasks) and provides CRUD:
 * - View active + recent tasks
 * - Submit new tasks from the dashboard
 * - Visual status indicators
 */

type Task = {
  id?: string
  task_id?: string
  description: string
  status?: string
  source?: string
  created_at?: string
  priority?: string
  result?: string
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Pending' },
  running: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Running' },
  completed: { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Done' },
  failed: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Failed' },
  queued: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Queued' },
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-foreground',
  low: 'text-muted-foreground',
}

export function TaskBoard() {
  const [active, setActive] = useState<Task[]>([])
  const [recent, setRecent] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTask, setNewTask] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/tasks')
      if (!res.ok) throw new Error(`Bridge error: ${res.status}`)
      const data = await res.json()
      setActive(data.active || [])
      setRecent(data.recent || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()
    const interval = setInterval(loadTasks, 10000)
    return () => clearInterval(interval)
  }, [loadTasks])

  const handleSubmit = async () => {
    const description = newTask.trim()
    if (!description || submitting) return

    setSubmitting(true)
    setSubmitResult(null)
    try {
      const res = await fetch('http://127.0.0.1:3100/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!res.ok) throw new Error('Failed to submit task')
      const data = await res.json()
      setSubmitResult(`✅ Task submitted: ${data.result}`)
      setNewTask('')
      // Refresh immediately
      setTimeout(loadTasks, 500)
    } catch (err) {
      setSubmitResult(`❌ ${err instanceof Error ? err.message : 'Submit failed'}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-8 w-full rounded bg-surface-1/60" />
        <div className="h-20 w-full rounded bg-surface-1/40" />
        <div className="h-20 w-full rounded bg-surface-1/40" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-red-400">
            <span>⚠️</span>
            <span className="font-medium">Task Engine Offline</span>
          </div>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Create task */}
      <div className="px-4 py-3 border-b border-border/50 flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="New task for Amy..."
            className="flex-1 rounded-md border border-border/40 bg-surface-1 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !newTask.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {submitting ? '...' : 'Submit'}
          </button>
        </div>
        {submitResult && (
          <div className={`mt-1.5 text-[10px] ${submitResult.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {submitResult}
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {/* Active tasks */}
        {active.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-green-400/70">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              Active ({active.length})
            </div>
            {active.map((task, idx) => (
              <TaskCard key={task.task_id || task.id || idx} task={task} />
            ))}
          </div>
        )}

        {/* Recent tasks */}
        <div>
          <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/40">
            {active.length === 0 && recent.length === 0 ? '' : `Recent (${recent.length})`}
          </div>
          {active.length === 0 && recent.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-2xl mb-2">📋</div>
              <p className="text-xs text-muted-foreground/50">No tasks yet</p>
              <p className="text-[10px] text-muted-foreground/30 mt-1">
                Submit a task above and Amy will process it
              </p>
            </div>
          ) : (
            recent.map((task, idx) => (
              <TaskCard key={task.task_id || task.id || idx} task={task} />
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/30 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground/40">
          {active.length} active • {recent.length} recent
        </span>
        <button
          onClick={loadTasks}
          className="text-[10px] text-primary/60 hover:text-primary transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const status = task.status || 'queued'
  const style = STATUS_STYLES[status] || STATUS_STYLES.queued
  const priorityClass = PRIORITY_STYLES[task.priority || 'medium'] || ''

  return (
    <div className="px-4 py-2 hover:bg-accent/20 transition-colors border-b border-border/20">
      <div className="flex items-start gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}>
          {style.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-xs ${priorityClass} truncate`}>
            {task.description}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {task.task_id && (
              <span className="text-[9px] font-mono text-muted-foreground/30">
                #{task.task_id.slice(0, 8)}
              </span>
            )}
            {task.source && (
              <span className="text-[9px] text-muted-foreground/30">
                via {task.source}
              </span>
            )}
            {task.created_at && (
              <span className="text-[9px] text-muted-foreground/20">
                {task.created_at}
              </span>
            )}
          </div>
          {task.result && (
            <p className="text-[10px] text-muted-foreground/50 mt-1 truncate">
              → {task.result}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
