import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbRun } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { encryptWorkPipelineBlob, decryptWorkPipelineBlob } from '@/lib/work-pipeline-crypto'

const VALID_PROVIDERS = ['none', 'jira', 'azure_devops'] as const

function safeParseJson(raw: string | null): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

function rowToPipeline(row: any) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    client_id: row.client_id ?? null,
    name: row.name,
    provider: row.provider,
    enabled: Boolean(row.enabled),
    config: safeParseJson(row.config_json),
    has_credentials: Boolean(row.secret_blob),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const row = await dbGetOne<any>('SELECT * FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (!row) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    return NextResponse.json({ pipeline: rowToPipeline(row) })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/work-pipelines/[id] error')
    return NextResponse.json({ error: 'Failed to load pipeline' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))

    const existing = await dbGetOne<any>('SELECT * FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (!existing) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : existing.name
    const provider = VALID_PROVIDERS.includes(body.provider) ? body.provider : existing.provider
    const enabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : existing.enabled
    const clientId = body.client_id === null ? null : typeof body.client_id === 'number' ? body.client_id : existing.client_id
    // Merge new config with existing — prevents losing JIRA/Azure connection details when only updating LLM settings
    const existingConfig = safeParseJson(existing.config_json)
    const config = typeof body.config === 'object' && body.config
      ? { ...existingConfig, ...body.config }
      : existingConfig

    // Merge credentials: new credentials replace old; null clears
    let secretBlob: string | null = existing.secret_blob
    if (body.credentials === null) {
      secretBlob = null
    } else if (body.credentials && typeof body.credentials === 'object') {
      // Merge with existing decrypted secrets
      let prev: Record<string, unknown> = {}
      try {
        if (existing.secret_blob) prev = JSON.parse(decryptWorkPipelineBlob(existing.secret_blob))
      } catch { /* ignore */ }
      const merged = { ...prev, ...body.credentials }
      secretBlob = encryptWorkPipelineBlob(JSON.stringify(merged))
    }

    await dbRun(
      `UPDATE work_pipelines SET name=?, provider=?, enabled=?, client_id=?, config_json=?, secret_blob=?, updated_at=UNIX_TIMESTAMP()
       WHERE id=? AND workspace_id=?`,
      [name, provider, enabled, clientId, JSON.stringify(config), secretBlob, Number(id), workspaceId]
    )

    const updated = await dbGetOne<any>('SELECT * FROM work_pipelines WHERE id = ?', [Number(id)])
    return NextResponse.json({ pipeline: rowToPipeline(updated) })
  } catch (err) {
    logger.error({ err }, 'PUT /api/workspace/work-pipelines/[id] error')
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    await dbRun('DELETE FROM pipeline_columns WHERE pipeline_id = ? AND workspace_id = ?', [Number(id), workspaceId])
    const result = await dbRun('DELETE FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (result.affectedRows === 0) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/workspace/work-pipelines/[id] error')
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
  }
}
