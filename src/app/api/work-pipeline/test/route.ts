import { NextRequest, NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { decryptPipelineSecrets, getWorkPipelineRow } from '@/lib/work-pipeline-config'
import { testAzureConnection } from '@/lib/work-pipeline-azure'
import { testJiraConnection } from '@/lib/work-pipeline-jira'
import type { WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'

/**
 * POST /api/work-pipeline/test â€” verify credentials against JIRA or Azure (admin).
 * Optional body overrides saved config for a one-off test:
 * { provider, config, secrets }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = (await request.json().catch(() => ({}))) as {
      provider?: string
      config?: WorkPipelineConfigJson
      secrets?: WorkPipelineSecrets
    }    const workspaceId = auth.user.workspace_id ?? 1
    const row = await getWorkPipelineRow(workspaceId)

    const provider = (body.provider || row?.provider || 'none') as string
    const config = { ...(row?.config || {}), ...(body.config || {}) }
    const savedSecrets = row?.secret_blob ? decryptPipelineSecrets(row.secret_blob) : {}
    const secrets: WorkPipelineSecrets = { ...savedSecrets, ...(body.secrets || {}) }

    if (provider === 'jira') {
      const r = await testJiraConnection(config, secrets)
      return NextResponse.json(r)
    }
    if (provider === 'azure_devops') {
      const r = await testAzureConnection(config, secrets)
      return NextResponse.json(r)
    }

    return NextResponse.json({ error: 'Select JIRA or Azure DevOps to test' }, { status: 400 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Test failed'
    logger.warn({ err: error }, 'POST /api/work-pipeline/test')
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
