import { NextRequest, NextResponse } from 'next/server'
import { dbGetAll, dbGetOne, dbRun } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export interface PhaseDefinition {
  column_name: string
  column_order: number
  is_trigger: boolean
  agent_role: string | null
  instructions: string | null
  timeout_seconds: number | null
  human_checkpoint: boolean
  on_failure: 'stop' | 'continue'
}

export interface PipelineColumnTemplate {
  id: number
  workspace_id: number
  name: string
  description: string | null
  category: string | null
  is_builtin: boolean
  phases: PhaseDefinition[]
  created_by: string
  use_count: number
  created_at: number
  updated_at: number
}

function parseTemplate(row: any): PipelineColumnTemplate {
  return {
    ...row,
    is_builtin: Boolean(row.is_builtin),
    phases: JSON.parse(row.phases_json || '[]'),
  }
}

/**
 * GET /api/pipeline-column-templates
 * Returns built-in templates (workspace_id = 0) + workspace-specific templates.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = await dbGetAll<any>(
      `SELECT * FROM pipeline_column_templates
       WHERE workspace_id = 0 OR workspace_id = ?
       ORDER BY is_builtin DESC, use_count DESC, name ASC`,
      [workspaceId]
    )
    return NextResponse.json({ templates: rows.map(parseTemplate) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/pipeline-column-templates error')
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

/**
 * POST /api/pipeline-column-templates — create a custom template
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { name, description, category, phases } = body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!Array.isArray(phases) || phases.length === 0) {
      return NextResponse.json({ error: 'phases must be a non-empty array' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)
    const result = await dbRun(
      `INSERT INTO pipeline_column_templates
         (workspace_id, name, description, category, is_builtin, phases_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [workspaceId, name.trim(), description || null, category || null,
       JSON.stringify(phases), auth.user.username, now, now]
    )

    const row = await dbGetOne<any>('SELECT * FROM pipeline_column_templates WHERE id = ?', [result.insertId])
    return NextResponse.json({ template: parseTemplate(row!) }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipeline-column-templates error')
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

/**
 * PUT /api/pipeline-column-templates — update a custom template
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { id, name, description, category, phases } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const existing = await dbGetOne<any>(
      'SELECT * FROM pipeline_column_templates WHERE id = ? AND workspace_id = ? AND is_builtin = 0',
      [id, workspaceId]
    )
    if (!existing) return NextResponse.json({ error: 'Template not found or is built-in' }, { status: 404 })

    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Math.floor(Date.now() / 1000)]

    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()) }
    if (description !== undefined) { fields.push('description = ?'); values.push(description || null) }
    if (category !== undefined) { fields.push('category = ?'); values.push(category || null) }
    if (phases !== undefined) { fields.push('phases_json = ?'); values.push(JSON.stringify(phases)) }

    values.push(id, workspaceId)
    await dbRun(`UPDATE pipeline_column_templates SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`, values)

    const row = await dbGetOne<any>('SELECT * FROM pipeline_column_templates WHERE id = ?', [id])
    return NextResponse.json({ template: parseTemplate(row!) })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/pipeline-column-templates error')
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

/**
 * DELETE /api/pipeline-column-templates — delete a custom template
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') || (await request.json().catch(() => ({}))).id

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const result = await dbRun(
      'DELETE FROM pipeline_column_templates WHERE id = ? AND workspace_id = ? AND is_builtin = 0',
      [Number(id), workspaceId]
    )
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Template not found or is built-in' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/pipeline-column-templates error')
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
