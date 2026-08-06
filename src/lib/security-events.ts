/**
 * Security Events — structured security event logging and agent trust scoring.
 *
 * Persists events to the security_events table and broadcasts via the event bus.
 * Trust scores are recalculated on each security event using weighted factors.
 */

import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { eventBus, type EventType } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

export type SecuritySeverity = 'info' | 'warning' | 'critical'

export interface SecurityEvent {
  event_type: string
  severity?: SecuritySeverity
  source?: string
  agent_name?: string
  detail?: string
  ip_address?: string
  workspace_id?: number
  tenant_id?: number
}

export interface SecurityPosture {
  score: number
  totalEvents: number
  criticalEvents: number
  warningEvents: number
  avgTrustScore: number
  recentIncidents: number
}

const TRUST_WEIGHTS: Record<string, { field: string; delta: number }> = {
  'auth.failure': { field: 'auth_failures', delta: -0.05 },
  'injection.attempt': { field: 'injection_attempts', delta: -0.15 },
  'rate_limit.hit': { field: 'rate_limit_hits', delta: -0.03 },
  'secret.exposure': { field: 'secret_exposures', delta: -0.20 },
  'task.success': { field: 'successful_tasks', delta: 0.02 },
  'task.failure': { field: 'failed_tasks', delta: -0.01 },
}

export function logSecurityEvent(event: SecurityEvent): void {
  const severity = event.severity ?? 'info'
  const workspaceId = event.workspace_id ?? 1
  const tenantId = event.tenant_id ?? 1

  dbRun(`
    INSERT INTO security_events (event_type, severity, source, agent_name, detail, ip_address, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    event.event_type,
    severity,
    event.source ?? null,
    event.agent_name ?? null,
    event.detail ?? null,
    event.ip_address ?? null,
    workspaceId,
    tenantId,
  ]).then((result) => {
    eventBus.broadcast('security.event' as EventType, {
      id: result.insertId,
      ...event,
      severity,
      workspace_id: workspaceId,
      timestamp: Math.floor(Date.now() / 1000),
    })
  }).catch((err) => {
    logger.debug({ err }, 'Failed to log security event')
  })
}

export async function updateAgentTrustScore(
  agentName: string,
  eventType: string,
  workspaceId: number = 1,
): Promise<void> {
  const weight = TRUST_WEIGHTS[eventType]

  // Ensure row exists
  await dbRun(`
    INSERT IGNORE INTO agent_trust_scores (agent_name, workspace_id)
    VALUES (?, ?)
  `, [agentName, workspaceId])

  if (weight) {
    // Increment the counter field
    await dbRun(`
      UPDATE agent_trust_scores
      SET ${weight.field} = ${weight.field} + 1,
          updated_at = UNIX_TIMESTAMP()
      WHERE agent_name = ? AND workspace_id = ?
    `, [agentName, workspaceId])

    // Recalculate trust score (clamped 0..1)
    const row = await dbGet<any>(`
      SELECT * FROM agent_trust_scores WHERE agent_name = ? AND workspace_id = ?
    `, [agentName, workspaceId])

    if (row) {
      let score = 1.0
      score += (row.auth_failures || 0) * -0.05
      score += (row.injection_attempts || 0) * -0.15
      score += (row.rate_limit_hits || 0) * -0.03
      score += (row.secret_exposures || 0) * -0.20
      score += (row.successful_tasks || 0) * 0.02
      score += (row.failed_tasks || 0) * -0.01
      score = Math.max(0, Math.min(1, score))

      const isAnomaly = weight.delta < 0
      await dbRun(`
        UPDATE agent_trust_scores
        SET trust_score = ?,
            last_anomaly_at = CASE WHEN ? THEN UNIX_TIMESTAMP() ELSE last_anomaly_at END,
            updated_at = UNIX_TIMESTAMP()
        WHERE agent_name = ? AND workspace_id = ?
      `, [score, isAnomaly ? 1 : 0, agentName, workspaceId])
    }
  }
}

export async function getSecurityPosture(workspaceId: number = 1): Promise<SecurityPosture> {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400

  const totals = await dbGet<any>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning
    FROM security_events
    WHERE workspace_id = ?
  `, [workspaceId])

  const recent = await dbGet<any>(`
    SELECT COUNT(*) as count
    FROM security_events
    WHERE workspace_id = ? AND severity IN ('warning', 'critical') AND created_at > ?
  `, [workspaceId, oneDayAgo])

  const trustAvg = await dbGet<any>(`
    SELECT AVG(trust_score) as avg_trust
    FROM agent_trust_scores
    WHERE workspace_id = ?
  `, [workspaceId])

  const avgTrust = trustAvg?.avg_trust ?? 1.0
  const criticalCount = totals?.critical ?? 0
  const warningCount = totals?.warning ?? 0
  const recentCount = recent?.count ?? 0

  // Score: start at 100, deduct for incidents
  let score = 100
  score -= criticalCount * 10
  score -= warningCount * 3
  score -= recentCount * 2
  score = Math.round(Math.max(0, Math.min(100, score * avgTrust)))

  return {
    score,
    totalEvents: totals?.total ?? 0,
    criticalEvents: criticalCount,
    warningEvents: warningCount,
    avgTrustScore: Math.round(avgTrust * 100) / 100,
    recentIncidents: recentCount,
  }
}
