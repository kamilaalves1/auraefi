import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { encryptWorkPipelineBlob, decryptWorkPipelineBlob } from '@/lib/work-pipeline-crypto'

const VALID_PROVIDERS = ['none', 'jira', 'azure_devops'] as const

function maskSecretBlob(blob: string | null): boolean {
  return Boolean(blob)
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
    has_credentials: maskSecretBlob(row.secret_blob),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function safeParseJson(raw: string | null): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const url = new URL(request.url)
    const clientId = url.searchParams.get('client_id')

    const rows = clientId
      ? await dbGetAll('SELECT * FROM work_pipelines WHERE workspace_id = ? AND client_id = ? ORDER BY created_at ASC', [workspaceId, Number(clientId)])
      : await dbGetAll('SELECT * FROM work_pipelines WHERE workspace_id = ? ORDER BY created_at ASC', [workspaceId])

    return NextResponse.json({ pipelines: (rows as any[]).map(rowToPipeline) })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/work-pipelines error')
    return NextResponse.json({ error: 'Failed to load pipelines' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120) : 'Nova esteira'
    const provider = VALID_PROVIDERS.includes(body.provider) ? body.provider : 'none'
    const clientId = typeof body.client_id === 'number' ? body.client_id : null
    const config = typeof body.config === 'object' && body.config ? body.config : {}
    const enabled = Boolean(body.enabled)

    // Encrypt credentials if provided
    let secretBlob: string | null = null
    if (body.credentials && typeof body.credentials === 'object') {
      secretBlob = encryptWorkPipelineBlob(JSON.stringify(body.credentials))
    }

    const result = await dbRun(`INSERT INTO work_pipelines (workspace_id, client_id, name, provider, enabled, config_json, secret_blob)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [workspaceId, clientId, name, provider, enabled ? 1 : 0, JSON.stringify(config), secretBlob])

    const row = await dbGet('SELECT * FROM work_pipelines WHERE id = ?', [result.insertId])
    return NextResponse.json({ pipeline: rowToPipeline(row as any) }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/workspace/work-pipelines error')
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
  }
}
