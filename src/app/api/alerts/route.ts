import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { mutationLimiter } from '@/lib/rate-limit'
import { createAlertSchema, validateBody } from '@/lib/validation'

interface AlertRule {
  id: number
  name: string
  description: string | null
  enabled: number
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  action_type: string
  action_config: string
  cooldown_minutes: number
  last_triggered_at: number | null
  trigger_count: number
  created_by: string
  created_at: number
  updated_at: number
}

/**
 * GET /api/alerts - List all alert rules
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const workspaceId = auth.user.workspace_id ?? 1
  try {
    const rules = await dbGetAll<AlertRule>('SELECT * FROM alert_rules WHERE workspace_id = ? ORDER BY created_at DESC', [workspaceId])
    return NextResponse.json({ rules })
  } catch {
    return NextResponse.json({ rules: [] })
  }
}

/**
 * POST /api/alerts - Create a new alert rule or evaluate rules
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  const workspaceId = auth.user.workspace_id ?? 1

  // Check for evaluate action first (peek at body without consuming)
  let rawBody: any
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (rawBody.action === 'evaluate') {
    return evaluateRules(workspaceId)
  }

  // Validate for create using schema
  const parseResult = createAlertSchema.safeParse(rawBody)
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 })
  }

  // Create new rule
  const { name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes } = parseResult.data

  try {
    const result = await dbRun(`
      INSERT INTO alert_rules (name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name,
      description || null,
      entity_type,
      condition_field,
      condition_operator,
      condition_value,
      action_type || 'notification',
      JSON.stringify(action_config || {}),
      cooldown_minutes || 60,
      auth.user?.username || 'system',
      workspaceId])

    // Audit log
    try {
      await dbRun('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)', ['alert_rule_created',
        auth.user?.username || 'system',
        `Created alert rule: ${name}`])
    } catch { /* audit table might not exist */ }

    const rule = await dbGet<AlertRule>('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?', [result.insertId, workspaceId])
    return NextResponse.json({ rule }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create rule' }, { status: 500 })
  }
}

/**
 * PUT /api/alerts - Update an alert rule
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  const workspaceId = auth.user.workspace_id ?? 1
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existing = await dbGet<AlertRule>('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?', [id, workspaceId])
  if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  const allowed = ['name', 'description', 'enabled', 'entity_type', 'condition_field', 'condition_operator', 'condition_value', 'action_type', 'action_config', 'cooldown_minutes']
  const sets: string[] = []
  const values: any[] = []

  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`)
      values.push(key === 'action_config' ? JSON.stringify(updates[key]) : updates[key])
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  sets.push('updated_at = (UNIX_TIMESTAMP())')
  values.push(id, workspaceId)

  await dbRun(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`, values)

  const updated = await dbGet<AlertRule>('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?', [id, workspaceId])
  return NextResponse.json({ rule: updated })
}

/**
 * DELETE /api/alerts - Delete an alert rule
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck
  const workspaceId = auth.user.workspace_id ?? 1
  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const result = await dbRun('DELETE FROM alert_rules WHERE id = ? AND workspace_id = ?', [id, workspaceId])

  try {
    await dbRun('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)', ['alert_rule_deleted',
      auth.user?.username || 'system',
      `Deleted alert rule #${id}`])
  } catch { /* audit table might not exist */ }

  return NextResponse.json({ deleted: result.affectedRows > 0 })
}

/**
 * Evaluate all enabled alert rules against current data
 */
async function evaluateRules(workspaceId: number) {
  let rules: AlertRule[]
  try {
    rules = await dbGetAll('SELECT * FROM alert_rules WHERE enabled = 1 AND workspace_id = ?', [workspaceId]) as AlertRule[]
  } catch {
    return NextResponse.json({ evaluated: 0, triggered: 0, results: [] })
  }

  const now = Math.floor(Date.now() / 1000)
  const results: { rule_id: number; rule_name: string; triggered: boolean; reason?: string }[] = []

  for (const rule of rules) {
    // Check cooldown
    if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_minutes * 60) {
      results.push({ rule_id: rule.id, rule_name: rule.name, triggered: false, reason: 'In cooldown' })
      continue
    }

    const triggered = await evaluateRule(rule, now, workspaceId)
    results.push({ rule_id: rule.id, rule_name: rule.name, triggered, reason: triggered ? 'Condition met' : 'Condition not met' })

    if (triggered) {
      // Update trigger tracking
      await dbRun('UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?', [now, rule.id])

      try {
        const config = JSON.parse(rule.action_config || '{}')

        if (rule.action_type === 'webhook' && config.url) {
          // Fire webhook asynchronously â€” don't block evaluation
          fetch(config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              alert: rule.name,
              description: rule.description,
              entity_type: rule.entity_type,
              condition: `${rule.condition_field} ${rule.condition_operator} ${rule.condition_value}`,
              triggered_at: new Date(now * 1000).toISOString(),
            }),
          }).catch(() => {})
        } else if (rule.action_type === 'email' && config.email_to) {
          // Email dispatch â€” requires SMTP config; log as notification for now
          await dbRun(`
            INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
            VALUES (?, 'alert', ?, ?, 'alert_rule', ?, ?)
          `, ['coordinator', `ðŸ“§ E-mail: ${rule.name}`, `Limite excedido. Envio para ${config.email_to} requer SMTP configurado.`, rule.id, workspaceId])
        } else if (rule.action_type === 'block') {
          // Block rules are evaluated on demand via /api/alerts/block-status
          // Just update the notification so admins see it
          const recipient = config.recipient || 'coordinator'
          await dbRun(`
            INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
            VALUES (?, 'alert', ?, ?, 'alert_rule', ?, ?)
          `, [recipient, `ðŸš« Bloqueio ativo: ${rule.name}`, `Limite excedido â€” novos envios LLM bloqueados. Regra: "${rule.name}"`, rule.id, workspaceId])
        } else {
          // Default: internal notification
          const recipient = config.recipient || 'system'
          await dbRun(`
            INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
            VALUES (?, 'alert', ?, ?, 'alert_rule', ?, ?)
          `, [recipient, `Alert: ${rule.name}`, rule.description || `Rule "${rule.name}" triggered`, rule.id, workspaceId])
        }
      } catch { /* notification creation failed */ }
    }
  }

  const triggered = results.filter(r => r.triggered).length
  return NextResponse.json({ evaluated: rules.length, triggered, results })
}

async function evaluateRule(rule: AlertRule, now: number, workspaceId: number): Promise<boolean> {
  try {
    switch (rule.entity_type) {
      case 'agent': return evaluateAgentRule(rule, now, workspaceId)
      case 'task': return evaluateTaskRule(rule, now, workspaceId)
      case 'session': return evaluateSessionRule(rule, now, workspaceId)
      case 'activity': return evaluateActivityRule(rule, now, workspaceId)
      case 'token_cost': return evaluateTokenCostRule(rule, now, workspaceId)
      default: return false
    }
  } catch {
    return false
  }
}

async function evaluateAgentRule(rule: AlertRule, now: number, workspaceId: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above' || condition_operator === 'count_below') {
    const count = (await dbGet(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND ${safeColumn('agents', condition_field)} = ?`, [workspaceId, condition_value]) as any)?.c || 0
    return condition_operator === 'count_above' ? count > parseInt(condition_value) : count < parseInt(condition_value)
  }

  if (condition_operator === 'age_minutes_above') {
    // Check agents where field value is older than N minutes (e.g., last_seen)
    const threshold = now - parseInt(condition_value) * 60
    const count = (await dbGet(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND status != 'offline' AND ${safeColumn('agents', condition_field)} < ?`, [workspaceId, threshold]) as any)?.c || 0
    return count > 0
  }

  const agents = await dbGetAll(`SELECT ${safeColumn('agents', condition_field)} as val FROM agents WHERE workspace_id = ? AND status != 'offline'`, [workspaceId]) as any[]
  return agents.some(a => compareValue(a.val, condition_operator, condition_value))
}

async function evaluateTaskRule(rule: AlertRule, _now: number, workspaceId: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    const count = (await dbGet(`SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ? AND ${safeColumn('tasks', condition_field)} = ?`, [workspaceId, condition_value]) as any)?.c || 0
    return count > parseInt(condition_value)
  }

  if (condition_operator === 'count_below') {
    const count = (await dbGet(`SELECT COUNT(*) as c FROM tasks WHERE workspace_id = ?`, [workspaceId]) as any)?.c || 0
    return count < parseInt(condition_value)
  }

  const tasks = await dbGetAll(`SELECT ${safeColumn('tasks', condition_field)} as val FROM tasks WHERE workspace_id = ?`, [workspaceId]) as any[]
  return tasks.some(t => compareValue(t.val, condition_operator, condition_value))
}

async function evaluateSessionRule(rule: AlertRule, _now: number, workspaceId: number): Promise<boolean> {
  // Session data comes from the gateway, not the DB, so we check the agents table for session info
  const { condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    const count = (await dbGet(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND status = 'busy'`, [workspaceId]) as any)?.c || 0
    return count > parseInt(condition_value)
  }

  return false
}

async function evaluateActivityRule(rule: AlertRule, now: number, workspaceId: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    // Count activities in the last hour
    const hourAgo = now - 3600
    const count = (await dbGet(`SELECT COUNT(*) as c FROM activities WHERE workspace_id = ? AND created_at > ? AND ${safeColumn('activities', condition_field)} = ?`, [workspaceId, hourAgo, condition_value]) as any)?.c || 0
    return count > parseInt(condition_value)
  }

  return false
}

async function evaluateTokenCostRule(rule: AlertRule, now: number, workspaceId: number): Promise<boolean> {
  const { condition_field, condition_operator, condition_value } = rule
  const threshold = Number(condition_value)

  // Daily window: last 24h
  const dayAgo = now - 86400

  if (condition_field === 'daily_cost_usd') {
    const row = await dbGet(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE workspace_id = ? AND created_at > ?`, [workspaceId, dayAgo]) as { total: number }
    return compareValue(row.total, condition_operator, condition_value)
  }

  if (condition_field === 'daily_tokens') {
    const row = await dbGet(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM token_usage WHERE workspace_id = ? AND created_at > ?`, [workspaceId, dayAgo]) as { total: number }
    return compareValue(row.total, condition_operator, condition_value)
  }

  if (condition_field === 'total_cost_usd') {
    const row = await dbGet(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE workspace_id = ?`, [workspaceId]) as { total: number }
    return compareValue(row.total, condition_operator, condition_value)
  }

  if (condition_field === 'monthly_cost_usd') {
    const monthAgo = now - 30 * 86400
    const row = await dbGet(`SELECT COALESCE(SUM(cost_usd), 0) as total FROM token_usage WHERE workspace_id = ? AND created_at > ?`, [workspaceId, monthAgo]) as { total: number }
    return compareValue(row.total, condition_operator, condition_value)
  }

  return false
}

function compareValue(actual: any, operator: string, expected: string): boolean {
  if (actual == null) return false
  const strActual = String(actual)
  switch (operator) {
    case 'equals': return strActual === expected
    case 'not_equals': return strActual !== expected
    case 'greater_than': return Number(actual) > Number(expected)
    case 'less_than': return Number(actual) < Number(expected)
    case 'contains': return strActual.toLowerCase().includes(expected.toLowerCase())
    default: return false
  }
}

// Whitelist of columns per table to prevent SQL injection
const SAFE_COLUMNS: Record<string, Set<string>> = {
  agents: new Set(['status', 'role', 'name', 'last_seen', 'last_activity']),
  tasks: new Set(['status', 'priority', 'assigned_to', 'title']),
  activities: new Set(['type', 'actor', 'entity_type']),
}

function safeColumn(table: string, column: string): string {
  if (SAFE_COLUMNS[table]?.has(column)) return column
  return 'id' // fallback to safe column
}
