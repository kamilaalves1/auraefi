import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll, logAuditEvent } from '@/lib/db'
import { heavyLimiter, extractClientIp } from '@/lib/rate-limit'

/**
 * GET /api/export?type=audit|tasks|activities|pipelines&format=csv|json&since=UNIX&until=UNIX
 * Admin-only data export endpoint.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const format = searchParams.get('format') || 'csv'
  const since = searchParams.get('since')
  const until = searchParams.get('until')

  if (!type || !['audit', 'tasks', 'activities', 'pipelines'].includes(type)) {
    return NextResponse.json(
      { error: 'type required: audit, tasks, activities, pipelines' },
      { status: 400 }
    )
  }

  const workspaceId = auth.user.workspace_id ?? 1
  const conditions: string[] = []
  const params: any[] = []

  if (since) {
    conditions.push('created_at >= ?')
    params.push(parseInt(since))
  }
  if (until) {
    conditions.push('created_at <= ?')
    params.push(parseInt(until))
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const requestedLimit = parseInt(searchParams.get('limit') || '10000')
  const maxLimit = 50000
  const limit = Math.min(requestedLimit, maxLimit)

  let rows: any[] = []
  let headers: string[] = []
  let filename = ''

  switch (type) {
    case 'audit': {
      // audit_log has no workspace_id column (instance-global table).
      // Scope to actors who belong to this workspace by joining against the users table.
      const auditConditions = [...conditions]
      const auditParams = [...params]
      auditConditions.unshift('(actor_id IS NULL OR actor_id IN (SELECT id FROM users WHERE workspace_id = ?))')
      auditParams.unshift(workspaceId)
      const auditWhere = `WHERE ${auditConditions.join(' AND ')}`
      rows = await dbGetAll(`SELECT * FROM audit_log ${auditWhere} ORDER BY created_at DESC LIMIT ?`, [...auditParams, limit])
      headers = ['id', 'action', 'actor', 'actor_id', 'target_type', 'target_id', 'detail', 'ip_address', 'user_agent', 'created_at']
      filename = 'audit-log'
      break
    }
    case 'tasks': {
      conditions.unshift('workspace_id = ?')
      params.unshift(workspaceId)
      const scopedWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      rows = await dbGetAll(`SELECT * FROM tasks ${scopedWhere} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
      headers = ['id', 'title', 'description', 'status', 'priority', 'assigned_to', 'created_by', 'created_at', 'updated_at', 'due_date', 'estimated_hours', 'actual_hours', 'tags']
      filename = 'tasks'
      break
    }
    case 'activities': {
      conditions.unshift('workspace_id = ?')
      params.unshift(workspaceId)
      const scopedWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      rows = await dbGetAll(`SELECT * FROM activities ${scopedWhere} ORDER BY created_at DESC LIMIT ?`, [...params, limit])
      headers = ['id', 'type', 'entity_type', 'entity_id', 'actor', 'description', 'data', 'created_at']
      filename = 'activities'
      break
    }
    case 'pipelines': {
      conditions.unshift('pr.workspace_id = ?')
      params.unshift(workspaceId)
      const scopedWhere = conditions.length > 0 ? `WHERE ${conditions.map(c => c.replace(/^created_at/, 'pr.created_at')).join(' AND ')}` : ''
      rows = await dbGetAll(`SELECT pr.*, wp.name as pipeline_name FROM pipeline_runs pr LEFT JOIN workflow_pipelines wp ON pr.pipeline_id = wp.id ${scopedWhere} ORDER BY pr.created_at DESC LIMIT ?`, [...params, limit])
      headers = ['id', 'pipeline_id', 'pipeline_name', 'status', 'current_step', 'steps_snapshot', 'started_at', 'completed_at', 'triggered_by', 'created_at']
      filename = 'pipeline-runs'
      break
    }
  }

  // Log the export — use the validated IP extractor to prevent header forgery in audit logs
  const ipAddress = extractClientIp(request)
  await logAuditEvent({
    action: 'data_export',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { type, format, row_count: rows.length },
    ip_address: ipAddress,
  }).catch(() => {})

  const dateStr = new Date().toISOString().split('T')[0]

  if (format === 'csv') {
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      const values = headers.map(h => {
        const val = row[h]
        if (val == null) return ''
        const str = String(val)
        // Escape CSV: wrap in quotes if contains comma, newline, or quote
        if (str.includes(',') || str.includes('\n') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      csvRows.push(values.join(','))
    }

    return new NextResponse(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=${filename}-${dateStr}.csv`,
      },
    })
  }

  // JSON format
  return NextResponse.json(
    { type, exported_at: new Date().toISOString(), count: rows.length, data: rows },
    {
      headers: {
        'Content-Disposition': `attachment; filename=${filename}-${dateStr}.json`,
      },
    }
  )
}
