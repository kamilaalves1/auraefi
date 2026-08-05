import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbGetAll, dbRun, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, createPipelineSchema, pipelineStepSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
  parameters?: Record<string, string>
}

export interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: string // JSON array of PipelineStep
  created_by: string
  created_at: number
  updated_at: number
  use_count: number
  last_used_at: number | null
  client_metadata_json?: string | null
}

function parseClientMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * GET /api/pipelines - List all pipelines with enriched step data
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const pipelines = await dbGetAll<Pipeline>(
      'SELECT * FROM workflow_pipelines WHERE workspace_id = ? ORDER BY use_count DESC, updated_at DESC',
      [workspaceId]
    )

    // Enrich steps with template names
    const templates = await dbGetAll<{ id: number; name: string }>(
      'SELECT id, name FROM workflow_templates',
      []
    )
    const nameMap = new Map(templates.map(t => [t.id, t.name]))

    // Get run counts per pipeline
    const runCounts = await dbGetAll<{ pipeline_id: number; total: number; completed: number; failed: number; running: number }>(
      `SELECT pipeline_id, COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
      FROM pipeline_runs WHERE workspace_id = ? GROUP BY pipeline_id`,
      [workspaceId]
    )
    const runMap = new Map(runCounts.map(r => [r.pipeline_id, r]))

    const parsed = pipelines.map((p) => {
      const steps: PipelineStep[] = JSON.parse(p.steps || '[]')
      const client_metadata = parseClientMetadata(p.client_metadata_json)
      const { client_metadata_json: _j, ...rest } = p
      return {
        ...rest,
        client_metadata,
        steps: steps.map((s) => ({ ...s, template_name: nameMap.get(s.template_id) || 'Unknown' })),
        runs: runMap.get(p.id) || { total: 0, completed: 0, failed: 0, running: 0 },
      }
    })

    return NextResponse.json({ pipelines: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/pipelines error')
    return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines - Create a pipeline
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createPipelineSchema)
    if ('error' in result) return result.error
    const { name, description, steps, client_metadata } = result.data

    const workspaceId = auth.user.workspace_id ?? 1

    // Validate template IDs exist
    const templateIds = steps.map((s: PipelineStep) => s.template_id)
    const existing = await dbGetAll<{ id: number }>(
      `SELECT id FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`,
      templateIds
    )
    if (existing.length !== new Set(templateIds).size) {
      return NextResponse.json({ error: 'One or more template IDs not found' }, { status: 400 })
    }

    const cleanSteps = steps.map((s: PipelineStep) => {
      const step: PipelineStep = {
        template_id: s.template_id,
        on_failure: s.on_failure || 'stop',
      }
      if (s.parameters && typeof s.parameters === 'object' && Object.keys(s.parameters).length > 0) {
        step.parameters = s.parameters
      }
      return step
    })

    const metaJson = JSON.stringify(client_metadata && typeof client_metadata === 'object' ? client_metadata : {})

    const insertResult = await dbRun(`
      INSERT INTO workflow_pipelines (name, description, steps, created_by, workspace_id, client_metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, description || null, JSON.stringify(cleanSteps), auth.user?.username || 'system', workspaceId, metaJson])

    await db_helpers.logActivity(
      'pipeline_created',
      'pipeline',
      insertResult.insertId,
      auth.user?.username || 'system',
      `Created pipeline: ${name}`,
      undefined,
      workspaceId
    ).catch(() => {})

    const pipeline = await dbGetOne<Pipeline>(
      'SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?',
      [insertResult.insertId, workspaceId]
    )
    const client_metadata_out = parseClientMetadata(pipeline?.client_metadata_json)
    const { client_metadata_json: _cj, ...pout } = pipeline!
    return NextResponse.json({ pipeline: { ...pout, client_metadata: client_metadata_out, steps: JSON.parse(pipeline!.steps) } }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipelines error')
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
  }
}

/**
 * PUT /api/pipelines - Update a pipeline
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })

    const existing = await dbGetOne<Pipeline>(
      'SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?',
      [id, workspaceId]
    )
    if (!existing) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const fields: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description) }
    if (updates.steps !== undefined) {
      const stepsCheck = pipelineStepSchema.array().min(2).max(50).safeParse(updates.steps)
      if (!stepsCheck.success) {
        return NextResponse.json(
          { error: 'Invalid steps', details: stepsCheck.error.issues.map((i) => i.message) },
          { status: 400 }
        )
      }
      fields.push('steps = ?')
      params.push(JSON.stringify(stepsCheck.data))
    }
    if (updates.client_metadata !== undefined) {
      fields.push('client_metadata_json = ?')
      params.push(JSON.stringify(updates.client_metadata ?? {}))
    }

    if (fields.length === 0) {
      // Usage tracking
      fields.push('use_count = use_count + 1', 'last_used_at = ?')
      params.push(Math.floor(Date.now() / 1000))
    }

    fields.push('updated_at = ?')
    params.push(Math.floor(Date.now() / 1000))
    params.push(id, workspaceId)

    await dbRun(`UPDATE workflow_pipelines SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`, params)

    const updated = await dbGetOne<Pipeline>(
      'SELECT * FROM workflow_pipelines WHERE id = ? AND workspace_id = ?',
      [id, workspaceId]
    )
    const client_metadata = parseClientMetadata(updated?.client_metadata_json)
    const { client_metadata_json: _u, ...rest } = updated!
    return NextResponse.json({ pipeline: { ...rest, client_metadata, steps: JSON.parse(updated!.steps) } })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/pipelines error')
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 })
  }
}

/**
 * DELETE /api/pipelines - Delete a pipeline
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const q = new URL(request.url).searchParams.get('id')
    let id: string | number | undefined = q ? parseInt(q, 10) : undefined
    if (id === undefined || Number.isNaN(id)) {
      try {
        const body = await request.json()
        id = body.id
      } catch {
        /* ignore */
      }
    }
    if (id === undefined || id === null || Number.isNaN(Number(id))) {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })
    }

    await dbRun('DELETE FROM workflow_pipelines WHERE id = ? AND workspace_id = ?', [parseInt(String(id), 10), workspaceId])
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/pipelines error')
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
  }
}
