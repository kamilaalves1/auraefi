/**
 * Spawn History — durable persistence for agent spawn events.
 *
 * Replaces log-scraping fallback with DB-backed spawn tracking.
 * Every agent session spawn (claude-code) is recorded
 * with status, duration, and error details for diagnostics and attribution.
 */

import { dbGetOne, dbGetAll, dbRun } from '@/lib/db'
import { createRun, updateRun, type RunStatus } from '@/lib/runs'
import { logger } from '@/lib/logger'

export interface SpawnRecord {
  id: number
  agent_id: number | null
  agent_name: string
  spawn_type: string
  session_id: string | null
  trigger: string | null
  status: string
  exit_code: number | null
  error: string | null
  duration_ms: number | null
  workspace_id: number
  created_at: number
  finished_at: number | null
}

export async function recordSpawnStart(input: {
  agentName: string
  agentId?: number
  spawnType?: string
  sessionId?: string
  trigger?: string
  workspaceId?: number
}): Promise<number> {
  const result = await dbRun(`
    INSERT INTO spawn_history (agent_name, agent_id, spawn_type, session_id, trigger, status, workspace_id)
    VALUES (?, ?, ?, ?, ?, 'started', ?)
  `, [
    input.agentName,
    input.agentId ?? null,
    input.spawnType ?? 'claude-code',
    input.sessionId ?? null,
    input.trigger ?? null,
    input.workspaceId ?? 1,
  ])
  const spawnId = result.insertId as number

  // Auto-create AgentRun from spawn
  const triggerType = (input.trigger === 'cron' || input.trigger === 'webhook' || input.trigger === 'agent')
    ? input.trigger as 'cron' | 'webhook' | 'agent'
    : 'manual' as const
  createRun({
    id: `spawn-${spawnId}`,
    agent_id: String(input.agentId ?? input.agentName),
    agent_name: input.agentName,
    runtime: input.spawnType ?? 'claude-code',
    trigger: triggerType,
    status: 'running',
    started_at: new Date().toISOString(),
    steps: [],
    cost: { input_tokens: 0, output_tokens: 0 },
    provenance: { run_hash: '' },
  }, input.workspaceId).catch(e => logger.debug({ err: e }, 'Failed to auto-create AgentRun from spawn'))

  return spawnId
}

export async function recordSpawnFinish(id: number, input: {
  status: 'completed' | 'failed' | 'terminated'
  exitCode?: number
  error?: string
  durationMs?: number
}): Promise<void> {
  await dbRun(`
    UPDATE spawn_history
    SET status = ?, exit_code = ?, error = ?, duration_ms = ?, finished_at = UNIX_TIMESTAMP()
    WHERE id = ?
  `, [
    input.status,
    input.exitCode ?? null,
    input.error ?? null,
    input.durationMs ?? null,
    id,
  ])

  // Auto-update the corresponding AgentRun with status + aggregated token cost
  try {
    const runStatus: RunStatus = input.status === 'terminated' ? 'cancelled' : input.status
    const outcome = input.status === 'completed' ? 'success' as const
      : input.status === 'failed' ? 'failed' as const
      : 'abandoned' as const

    // Aggregate token usage for this agent's session
    const spawn = await dbGetOne<{ session_id: string | null; agent_name: string; workspace_id: number }>(
      'SELECT session_id, agent_name, workspace_id FROM spawn_history WHERE id = ?',
      [id]
    )
    let cost = undefined
    if (spawn?.session_id) {
      const tokens = await dbGetOne<{ input_tokens: number; output_tokens: number; cost_usd: number }>(
        `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
               COALESCE(SUM(output_tokens), 0) as output_tokens,
               COALESCE(SUM(cost_usd), 0) as cost_usd
        FROM token_usage WHERE session_id = ? AND workspace_id = ?`,
        [spawn.session_id, spawn.workspace_id ?? 1]
      )
      if (tokens) {
        cost = {
          input_tokens: tokens.input_tokens,
          output_tokens: tokens.output_tokens,
          cost_usd: tokens.cost_usd || null,
        }
      }
    }

    await updateRun(`spawn-${id}`, {
      status: runStatus,
      outcome,
      ended_at: new Date().toISOString(),
      duration_ms: input.durationMs,
      error: input.error,
      ...(cost ? { cost } : {}),
    })
  } catch (e) {
    logger.debug({ err: e }, 'Failed to auto-update AgentRun from spawn finish')
  }
}

export async function getSpawnHistory(agentName: string, opts?: {
  hours?: number
  limit?: number
  workspaceId?: number
}): Promise<SpawnRecord[]> {
  const hours = opts?.hours ?? 24
  const limit = opts?.limit ?? 50
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  return dbGetAll<SpawnRecord>(`
    SELECT * FROM spawn_history
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [agentName, opts?.workspaceId ?? 1, since, limit])
}

export async function getSpawnStats(opts?: {
  hours?: number
  workspaceId?: number
}): Promise<{
  total: number
  completed: number
  failed: number
  avgDurationMs: number
  byAgent: Array<{ agent_name: string; count: number; failures: number }>
}> {
  const hours = opts?.hours ?? 24
  const since = Math.floor(Date.now() / 1000) - hours * 3600
  const wsId = opts?.workspaceId ?? 1

  const totals = await dbGetOne<{
    total: number
    completed: number
    failed: number
    avg_duration: number
  }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(duration_ms) as avg_duration
    FROM spawn_history
    WHERE workspace_id = ? AND created_at > ?
  `, [wsId, since])

  const byAgent = await dbGetAll<{ agent_name: string; count: number; failures: number }>(`
    SELECT
      agent_name,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures
    FROM spawn_history
    WHERE workspace_id = ? AND created_at > ?
    GROUP BY agent_name
    ORDER BY count DESC
  `, [wsId, since])

  return {
    total: totals?.total ?? 0,
    completed: totals?.completed ?? 0,
    failed: totals?.failed ?? 0,
    avgDurationMs: Math.round(totals?.avg_duration ?? 0),
    byAgent: byAgent.map((row) => ({
      agent_name: row.agent_name,
      count: row.count,
      failures: row.failures,
    })),
  }
}
