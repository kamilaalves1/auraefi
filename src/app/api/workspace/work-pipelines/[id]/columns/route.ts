import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

function safeParseAssignments(raw: string | null | undefined): Array<{ role: string; agent_id: number | null; order: number; llm_model?: string; repo_id?: number | null }> {
  try {
    const arr = JSON.parse(raw ?? '[]')
    if (!Array.isArray(arr)) return []
    return arr.map((a: any, i: number) => {
      const aid = Number(a.agent_id)
      const rid = Number(a.repo_id)
      return {
        role: String(a.role ?? ''),
        agent_id: Number.isFinite(aid) && aid > 0 ? aid : null,
        order: a.order ?? i,
        llm_model: typeof a.llm_model === 'string' ? a.llm_model : undefined,
        repo_id: Number.isFinite(rid) && rid > 0 ? rid : null,
      }
    })
  } catch { return [] }
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = await dbGet('SELECT id FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const rows = await dbGetAll(`SELECT pc.*, a.name as agent_name
       FROM pipeline_columns pc
       LEFT JOIN agents a ON a.id = pc.agent_id
       WHERE pc.pipeline_id = ? AND pc.workspace_id = ?
       ORDER BY pc.column_order ASC`, [Number(id), workspaceId]) as any[]

    const columns = rows.map(row => ({
      id: row.id,
      column_name: row.column_name,
      column_order: row.column_order,
      is_trigger: Boolean(row.is_trigger),
      requires_human_approval: Boolean(row.requires_human_approval),
      assignments: safeParseAssignments(row.assignments_json),
      instructions: row.instructions ?? null,
      // legacy compat
      agent_id: row.agent_id ?? null,
      agent_name: row.agent_name ?? null,
    }))

    return NextResponse.json({ columns })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/work-pipelines/[id]/columns error')
    return NextResponse.json({ error: 'Failed to load columns' }, { status: 500 })
  }
}

/** PUT — replace all columns for a pipeline */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))

    const pipeline = await dbGet('SELECT id FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const columns: Array<{
      column_name: string
      column_order?: number
      is_trigger?: boolean
      requires_human_approval?: boolean
      assignments?: Array<{ role: string; agent_id: number | null; order: number }>
      instructions?: string | null
    }> = Array.isArray(body.columns) ? body.columns : []

    await dbRun('DELETE FROM pipeline_columns WHERE pipeline_id = ? AND workspace_id = ?', [Number(id), workspaceId])

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const assignments = Array.isArray(col.assignments) ? col.assignments : []
      // first agent_id for legacy column
      const firstAgentId = assignments.find(a => a.agent_id != null)?.agent_id ?? null
      await dbRun(`INSERT INTO pipeline_columns (pipeline_id, workspace_id, column_name, column_order, is_trigger, agent_id, skill_id, instructions, assignments_json, requires_human_approval)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`, [Number(id),
        workspaceId,
        String(col.column_name ?? '').slice(0, 200),
        col.column_order ?? i,
        col.is_trigger ? 1 : 0,
        firstAgentId,
        col.instructions ? String(col.instructions).slice(0, 10000) : null,
        JSON.stringify(assignments),
        col.requires_human_approval ? 1 : 0,
      ])
    }

    const saved = await dbGetAll(`SELECT pc.*, a.name as agent_name
       FROM pipeline_columns pc
       LEFT JOIN agents a ON a.id = pc.agent_id
       WHERE pc.pipeline_id = ? AND pc.workspace_id = ?
       ORDER BY pc.column_order ASC`, [Number(id), workspaceId]) as any[]

    return NextResponse.json({
      columns: saved.map(row => ({
        id: row.id,
        column_name: row.column_name,
        column_order: row.column_order,
        is_trigger: Boolean(row.is_trigger),
        requires_human_approval: Boolean(row.requires_human_approval),
        assignments: safeParseAssignments(row.assignments_json),
        instructions: row.instructions ?? null,
        agent_id: row.agent_id ?? null,
        agent_name: row.agent_name ?? null,
      }))
    })
  } catch (err) {
    logger.error({ err }, 'PUT /api/workspace/work-pipelines/[id]/columns error')
    return NextResponse.json({ error: 'Failed to save columns' }, { status: 500 })
  }
}
