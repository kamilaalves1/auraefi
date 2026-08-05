import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbRun } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * POST /api/pipeline-column-templates/[id]/apply
 * Creates a new work_pipeline and its columns from a template.
 *
 * Body: { pipeline_name?: string }
 * Returns: { pipeline, columns }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))
    const pipelineName: string = body.pipeline_name || ''

    const templateRow = await dbGetOne<any>(
      'SELECT * FROM pipeline_column_templates WHERE id = ? AND (workspace_id = 0 OR workspace_id = ?)',
      [Number(id), workspaceId]
    )
    if (!templateRow) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const phases: Array<{
      column_name: string
      column_order: number
      is_trigger: boolean
      agent_role: string | null
      instructions: string | null
      timeout_seconds: number | null
      human_checkpoint: boolean
      on_failure: string
    }> = JSON.parse(templateRow.phases_json || '[]')

    const name = pipelineName.trim() || templateRow.name
    const now = Math.floor(Date.now() / 1000)

    // Create the work pipeline
    const pipelineResult = await dbRun(
      `INSERT INTO work_pipelines (workspace_id, name, provider, enabled, config_json, created_at, updated_at)
       VALUES (?, ?, 'none', 1, ?, ?, ?)`,
      [workspaceId, name, JSON.stringify({}), now, now]
    )
    const pipelineId = pipelineResult.insertId

    // Create columns from phases
    const columns: any[] = []
    for (const phase of phases) {
      // Resolve agent_id from role name if possible (best-effort)
      let agentId: number | null = null
      if (phase.agent_role) {
        const agentRow = await dbGetOne<{ id: number }>(
          'SELECT id FROM agents WHERE workspace_id = ? AND (role LIKE ? OR role LIKE ?) LIMIT 1',
          [workspaceId, `%${phase.agent_role}%`, `%${phase.agent_role}%`]
        )
        agentId = agentRow?.id ?? null
      }

      const colResult = await dbRun(
        `INSERT INTO pipeline_columns
           (workspace_id, pipeline_id, column_name, column_order, is_trigger, agent_id,
            instructions, assignments_json, timeout_seconds, human_checkpoint, on_failure, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?)`,
        [
          workspaceId, pipelineId, phase.column_name, phase.column_order,
          phase.is_trigger ? 1 : 0, agentId, phase.instructions || null,
          phase.timeout_seconds ?? null,
          phase.human_checkpoint ? 1 : 0,
          phase.on_failure || 'stop',
          now, now,
        ]
      )

      columns.push({
        id: colResult.insertId,
        column_name: phase.column_name,
        column_order: phase.column_order,
        is_trigger: phase.is_trigger,
        agent_id: agentId,
        agent_role: phase.agent_role,
        instructions: phase.instructions,
        timeout_seconds: phase.timeout_seconds,
        human_checkpoint: phase.human_checkpoint,
        on_failure: phase.on_failure,
      })
    }

    // Increment template use_count
    await dbRun(
      'UPDATE pipeline_column_templates SET use_count = use_count + 1, updated_at = ? WHERE id = ?',
      [now, templateRow.id]
    )

    const pipeline = {
      id: pipelineId,
      name,
      provider: 'none',
      enabled: true,
      config: { name },
      has_credentials: false,
    }

    return NextResponse.json({ pipeline, columns }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipeline-column-templates/[id]/apply error')
    return NextResponse.json({ error: 'Failed to apply template' }, { status: 500 })
  }
}
