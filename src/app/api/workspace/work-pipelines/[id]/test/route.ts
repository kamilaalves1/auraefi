import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { decryptWorkPipelineBlob } from '@/lib/work-pipeline-crypto'
import { testJiraConnection } from '@/lib/work-pipeline-jira'
import { testAzureConnection } from '@/lib/work-pipeline-azure'
import type { WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1

    const row = await dbGet('SELECT * FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as any
    if (!row) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    let config: WorkPipelineConfigJson = {}
    try { config = row.config_json ? JSON.parse(row.config_json) : {} } catch { /* ignore */ }

    let secrets: WorkPipelineSecrets = {}
    if (row.secret_blob) {
      try { secrets = JSON.parse(decryptWorkPipelineBlob(row.secret_blob)) } catch { /* ignore */ }
    }

    // Allow override from request body (credentials not yet saved)
    const body = await request.json().catch(() => ({}))
    if (body.config) config = { ...config, ...body.config }
    if (body.credentials) secrets = { ...secrets, ...body.credentials } as WorkPipelineSecrets

    if (row.provider === 'jira') {
      const result = await testJiraConnection(config, secrets)
      return NextResponse.json({ ok: true, issueCount: result.issueCount })
    } else if (row.provider === 'azure_devops') {
      const result = await testAzureConnection(config, secrets)
      return NextResponse.json({ ok: true, issueCount: result.issueCount })
    } else {
      return NextResponse.json({ error: 'Provider não configurado' }, { status: 400 })
    }
  } catch (err: any) {
    logger.error({ err }, 'POST /api/workspace/work-pipelines/[id]/test error')
    return NextResponse.json({ ok: false, error: err.message || 'Falha ao testar conexão' })
  }
}
