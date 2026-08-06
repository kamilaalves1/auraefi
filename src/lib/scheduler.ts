import { logAuditEvent } from './db'
import { dbGet, dbGetAll, dbRun } from './db-pool'
import { syncAgentsFromConfig } from './agent-sync'
import { config } from './config'
import { logger } from './logger'
import { processWebhookRetries } from './webhooks'
import { syncClaudeSessions } from './claude-sessions'
import { pruneGatewaySessionsOlderThan, getAgentLiveStatuses } from './sessions'
import { eventBus } from './event-bus'
import { syncSkillsFromDisk } from './skill-sync'
import { syncLocalAgents } from './local-agent-sync'
import { dispatchAssignedTasks, runAegisReviews, requeueStaleTasks, autoRouteInboxTasks } from './task-dispatch'
import { spawnRecurringTasks } from './recurring-tasks'
import { tickPipelineEngine } from './pipeline-engine'

interface ScheduledTask {
  name: string
  intervalMs: number
  lastRun: number | null
  nextRun: number
  enabled: boolean
  running: boolean
  lastResult?: { ok: boolean; message: string; timestamp: number }
}

const tasks: Map<string, ScheduledTask> = new Map()
let tickInterval: ReturnType<typeof setInterval> | null = null

/** Check if a setting is enabled (reads from settings table, falls back to default) */
async function isSettingEnabled(key: string, defaultValue: boolean): Promise<boolean> {
  try {
    const row = await dbGet<{ value: string }>('SELECT value FROM settings WHERE `key` = ?', [key])
    if (row) return row.value === 'true'
    return defaultValue
  } catch {
    return defaultValue
  }
}

async function getSettingNumber(key: string, defaultValue: number): Promise<number> {
  try {
    const row = await dbGet<{ value: string }>('SELECT value FROM settings WHERE `key` = ?', [key])
    if (row) return parseInt(row.value) || defaultValue
    return defaultValue
  } catch {
    return defaultValue
  }
}

/** Run a database backup — MySQL backup is not managed by the app; log a notice */
async function runBackup(): Promise<{ ok: boolean; message: string }> {
  // MySQL backups are handled externally (mysqldump, AWS RDS snapshots, etc.)
  // This stub logs the attempt for audit trail purposes.
  try {
    await logAuditEvent({
      action: 'auto_backup',
      actor: 'scheduler',
      detail: { note: 'MySQL backup handled externally (RDS snapshots / mysqldump)' },
    })
    return { ok: true, message: 'MySQL backup is managed externally — logged notice' }
  } catch (err: any) {
    return { ok: false, message: `Backup notice failed: ${err.message}` }
  }
}

/** Run data cleanup based on retention settings */
async function runCleanup(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const ret = config.retention
    let totalDeleted = 0

    const targets = [
      { table: 'activities', column: 'created_at', days: ret.activities },
      { table: 'audit_log', column: 'created_at', days: ret.auditLog },
      { table: 'notifications', column: 'created_at', days: ret.notifications },
      { table: 'pipeline_runs', column: 'created_at', days: ret.pipelineRuns },
    ]

    for (const { table, column, days } of targets) {
      if (days <= 0) continue
      const cutoff = now - days * 86400
      try {
        const res = await dbRun(`DELETE FROM ${table} WHERE ${column} < ?`, [cutoff])
        totalDeleted += res.affectedRows
      } catch {
        // Table might not exist
      }
    }

    // Clean token usage file
    if (ret.tokenUsage > 0) {
      try {
        const { readFile, writeFile } = require('fs/promises')
        const raw = await readFile(config.tokensPath, 'utf-8')
        const data = JSON.parse(raw)
        const cutoffMs = Date.now() - ret.tokenUsage * 86400000
        const kept = data.filter((r: any) => r.timestamp >= cutoffMs)
        const removed = data.length - kept.length

        if (removed > 0) {
          await writeFile(config.tokensPath, JSON.stringify(kept, null, 2))
          totalDeleted += removed
        }
      } catch {
        // No token file
      }
    }

    if (ret.gatewaySessions > 0) {
      const sessionCleanup = pruneGatewaySessionsOlderThan(ret.gatewaySessions)
      totalDeleted += sessionCleanup.deleted
    }

    if (totalDeleted > 0) {
      logAuditEvent({
        action: 'auto_cleanup',
        actor: 'scheduler',
        detail: { total_deleted: totalDeleted },
      }).catch(() => {})
    }

    return { ok: true, message: `Cleaned ${totalDeleted} stale record${totalDeleted === 1 ? '' : 's'}` }
  } catch (err: any) {
    return { ok: false, message: `Cleanup failed: ${err.message}` }
  }
}

/** Check agent liveness - mark agents offline if not seen recently */
async function runHeartbeatCheck(): Promise<{ ok: boolean; message: string }> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const timeoutMinutes = await getSettingNumber('general.agent_timeout_minutes', 10)
    const threshold = now - timeoutMinutes * 60

    // Find agents that are not offline but haven't been seen recently.
    // Exclude agents assigned to pipeline columns — those are managed by the pipeline engine.
    const staleAgents = await dbGetAll<{ id: number; name: string; status: string; last_seen: number | null }>(`
      SELECT id, name, status, last_seen FROM agents
      WHERE status != 'offline'
        AND (last_seen IS NULL OR last_seen < ?)
        AND id NOT IN (
          SELECT DISTINCT CAST(JSON_UNQUOTE(JSON_EXTRACT(a.value, '$.agent_id')) AS SIGNED)
          FROM pipeline_columns pc
          JOIN JSON_TABLE(pc.assignments_json, '$[*]' COLUMNS (value JSON PATH '$')) jt ON TRUE
          WHERE JSON_EXTRACT(a.value, '$.agent_id') IS NOT NULL
        )
    `, [threshold])

    if (staleAgents.length === 0) {
      return { ok: true, message: 'All agents healthy' }
    }

    const names: string[] = []
    for (const agent of staleAgents) {
      await dbRun('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', ['offline', now, agent.id])
      await dbRun(`
        INSERT INTO activities (type, entity_type, entity_id, actor, description)
        VALUES ('agent_status_change', 'agent', ?, 'heartbeat', ?)
      `, [agent.id, `Agent "${agent.name}" marked offline (no heartbeat for ${timeoutMinutes}m)`])
      names.push(agent.name)

      try {
        await dbRun(`
          INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
          VALUES ('system', 'heartbeat', ?, ?, 'agent', ?)
        `, [
          `Agent offline: ${agent.name}`,
          `Agent "${agent.name}" was marked offline after ${timeoutMinutes} minutes without heartbeat`,
          agent.id
        ])
      } catch { /* notification creation failed */ }
    }

    logAuditEvent({
      action: 'heartbeat_check',
      actor: 'scheduler',
      detail: { marked_offline: names },
    }).catch(() => {})

    return { ok: true, message: `Marked ${staleAgents.length} agent(s) offline: ${names.join(', ')}` }
  } catch (err: any) {
    return { ok: false, message: `Heartbeat check failed: ${err.message}` }
  }
}

/** Sync live agent statuses from gateway session files into the DB */
async function syncAgentLiveStatuses(): Promise<number> {
  const liveStatuses = getAgentLiveStatuses()
  if (liveStatuses.size === 0) return 0

  const agents = await dbGetAll<{ id: number; name: string; config: string | null }>('SELECT id, name, config FROM agents')

  let refreshed = 0
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  for (const agent of agents) {
    let agentId: string | null = null
    if (agent.config) {
      try {
        const cfg = JSON.parse(agent.config)
        if (typeof cfg.agentId === 'string' && cfg.agentId.trim()) {
          agentId = cfg.agentId.trim()
        }
      } catch { /* ignore */ }
    }

    const candidates = [agentId, agent.name].filter(Boolean).map(s => normalize(s!))
    let matched: { status: 'active' | 'idle' | 'offline'; lastActivity: number; channel: string } | undefined

    for (const [sessionAgent, info] of liveStatuses) {
      if (candidates.includes(normalize(sessionAgent))) {
        matched = info
        break
      }
    }

    if (!matched || matched.status === 'offline') continue

    const now = Math.floor(Date.now() / 1000)
    const activity = `Gateway session (${matched.channel || 'unknown'})`
    await dbRun('UPDATE agents SET status = ?, last_seen = ?, last_activity = ?, updated_at = ? WHERE id = ?',
      [matched.status, now, activity, now, agent.id])
    refreshed++

    eventBus.broadcast('agent.status_changed', {
      id: agent.id,
      name: agent.name,
      status: matched.status,
      last_seen: now,
      last_activity: activity,
    })
  }

  return refreshed
}

const DAILY_MS = 24 * 60 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000
const TICK_MS = 10 * 1000 // Check every 10s so pipeline_engine fires at its 10s interval

/** Initialize the scheduler */
export function initScheduler() {
  if (tickInterval) return // Already running

  // Auto-sync agents from config on startup
  syncAgentsFromConfig('startup').catch(err => {
    logger.warn({ err }, 'Agent auto-sync failed')
  })

  // Register tasks
  const now = Date.now()
  const msUntilNextBackup = getNextDailyMs(3)
  const msUntilNextCleanup = getNextDailyMs(4)

  tasks.set('auto_backup', {
    name: 'Auto Backup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextBackup,
    enabled: true,
    running: false,
  })

  tasks.set('auto_cleanup', {
    name: 'Auto Cleanup',
    intervalMs: DAILY_MS,
    lastRun: null,
    nextRun: now + msUntilNextCleanup,
    enabled: true,
    running: false,
  })

  tasks.set('agent_heartbeat', {
    name: 'Agent Heartbeat Check',
    intervalMs: FIVE_MINUTES_MS,
    lastRun: null,
    nextRun: now + FIVE_MINUTES_MS,
    enabled: true,
    running: false,
  })

  tasks.set('webhook_retry', {
    name: 'Webhook Retry',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + TICK_MS,
    enabled: true,
    running: false,
  })

  tasks.set('claude_session_scan', {
    name: 'Claude Session Scan',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 5_000,
    enabled: true,
    running: false,
  })

  tasks.set('skill_sync', {
    name: 'Skill Sync',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 10_000,
    enabled: true,
    running: false,
  })

  tasks.set('local_agent_sync', {
    name: 'Local Agent Sync',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 15_000,
    enabled: true,
    running: false,
  })

  tasks.set('gateway_agent_sync', {
    name: 'Gateway Agent Sync',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 20_000,
    enabled: true,
    running: false,
  })

  tasks.set('task_dispatch', {
    name: 'Task Dispatch',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 10_000,
    enabled: true,
    running: false,
  })

  tasks.set('aegis_review', {
    name: 'Aegis Quality Review',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 30_000,
    enabled: true,
    running: false,
  })

  tasks.set('recurring_task_spawn', {
    name: 'Recurring Task Spawn',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 20_000,
    enabled: true,
    running: false,
  })

  tasks.set('stale_task_requeue', {
    name: 'Stale Task Requeue',
    intervalMs: TICK_MS,
    lastRun: null,
    nextRun: now + 25_000,
    enabled: true,
    running: false,
  })

  tasks.set('pipeline_engine', {
    name: 'Pipeline Engine',
    intervalMs: 10_000,
    lastRun: null,
    nextRun: now + 15_000,
    enabled: true,
    running: false,
  })

  // Start the tick loop
  tickInterval = setInterval(tick, TICK_MS)
  logger.info('Scheduler initialized')
}

/** Calculate ms until next occurrence of a given hour (UTC) */
function getNextDailyMs(hour: number): number {
  const now = new Date()
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.getTime() - now.getTime()
}

/** Check and run due tasks */
async function tick() {
  const now = Date.now()

  for (const [id, task] of tasks) {
    if (task.running || now < task.nextRun) continue

    const settingKey = id === 'auto_backup' ? 'general.auto_backup'
      : id === 'auto_cleanup' ? 'general.auto_cleanup'
      : id === 'webhook_retry' ? 'webhooks.retry_enabled'
      : id === 'claude_session_scan' ? 'general.claude_session_scan'
      : id === 'skill_sync' ? 'general.skill_sync'
      : id === 'local_agent_sync' ? 'general.local_agent_sync'
      : id === 'gateway_agent_sync' ? 'general.gateway_agent_sync'
      : id === 'task_dispatch' ? 'general.task_dispatch'
      : id === 'aegis_review' ? 'general.aegis_review'
      : id === 'recurring_task_spawn' ? 'general.recurring_task_spawn'
      : id === 'stale_task_requeue' ? 'general.stale_task_requeue'
      : id === 'pipeline_engine' ? 'general.pipeline_engine'
      : 'general.agent_heartbeat'
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'stale_task_requeue' || id === 'pipeline_engine'
    if (!(await isSettingEnabled(settingKey, defaultEnabled))) continue

    task.running = true
    try {
      const result = id === 'auto_backup' ? await runBackup()
        : id === 'agent_heartbeat' ? await runHeartbeatCheck()
        : id === 'webhook_retry' ? await processWebhookRetries()
        : id === 'claude_session_scan' ? await syncClaudeSessions()
        : id === 'skill_sync' ? await syncSkillsFromDisk()
        : id === 'local_agent_sync' ? await syncLocalAgents()
        : id === 'gateway_agent_sync' ? await syncAgentsFromConfig('scheduled').then(async r => {
            const refreshed = await syncAgentLiveStatuses()
            return { ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total | Live status: ${refreshed} refreshed` }
          })
        : id === 'task_dispatch' ? await autoRouteInboxTasks().then(async (routeResult) => {
            const dispatchResult = await dispatchAssignedTasks()
            const parts = [routeResult.message, dispatchResult.message].filter(m => m && !m.includes('No '))
            return { ok: routeResult.ok && dispatchResult.ok, message: parts.join(' | ') || 'No tasks to route or dispatch' }
          })
        : id === 'aegis_review' ? await runAegisReviews()
        : id === 'recurring_task_spawn' ? await spawnRecurringTasks()
        : id === 'stale_task_requeue' ? await requeueStaleTasks()
        : id === 'pipeline_engine' ? await tickPipelineEngine()
        : await runCleanup()
      task.lastResult = { ...result, timestamp: now }
    } catch (err: any) {
      task.lastResult = { ok: false, message: err.message, timestamp: now }
    } finally {
      task.running = false
      task.lastRun = now
      task.nextRun = now + task.intervalMs
    }
  }
}

/** Get scheduler status (for API) */
export function getSchedulerStatus() {
  const result: Array<{
    id: string
    name: string
    enabled: boolean
    lastRun: number | null
    nextRun: number
    running: boolean
    lastResult?: { ok: boolean; message: string; timestamp: number }
  }> = []

  for (const [id, task] of tasks) {
    const defaultEnabled = id === 'agent_heartbeat' || id === 'webhook_retry' || id === 'claude_session_scan' || id === 'skill_sync' || id === 'local_agent_sync' || id === 'gateway_agent_sync' || id === 'task_dispatch' || id === 'aegis_review' || id === 'recurring_task_spawn' || id === 'stale_task_requeue' || id === 'pipeline_engine'
    result.push({
      id,
      name: task.name,
      enabled: defaultEnabled, // Synchronous fallback; actual enabled state is async
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      running: task.running,
      lastResult: task.lastResult,
    })
  }

  return result
}

/** Manually trigger a scheduled task */
export async function triggerTask(taskId: string): Promise<{ ok: boolean; message: string }> {
  if (taskId === 'auto_backup') return runBackup()
  if (taskId === 'auto_cleanup') return runCleanup()
  if (taskId === 'agent_heartbeat') return runHeartbeatCheck()
  if (taskId === 'webhook_retry') return processWebhookRetries()
  if (taskId === 'claude_session_scan') return syncClaudeSessions()
  if (taskId === 'skill_sync') return syncSkillsFromDisk()
  if (taskId === 'local_agent_sync') return syncLocalAgents()
  if (taskId === 'gateway_agent_sync') return syncAgentsFromConfig('manual').then(r => ({ ok: true, message: `Gateway sync: ${r.created} created, ${r.updated} updated, ${r.synced} total` }))
  if (taskId === 'task_dispatch') return autoRouteInboxTasks().then(async (r) => { const d = await dispatchAssignedTasks(); return { ok: r.ok && d.ok, message: [r.message, d.message].filter(m => m && !m.includes('No ')).join(' | ') || 'No tasks' } })
  if (taskId === 'aegis_review') return runAegisReviews()
  if (taskId === 'recurring_task_spawn') return spawnRecurringTasks()
  if (taskId === 'stale_task_requeue') return requeueStaleTasks()
  if (taskId === 'pipeline_engine') return tickPipelineEngine()
  return { ok: false, message: `Unknown task: ${taskId}` }
}

/** Stop the scheduler */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}
