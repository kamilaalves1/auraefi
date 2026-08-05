import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { extractClientIp } from '@/lib/rate-limit'
import {
  getWorkPipelineRow,
  toPublicPipelineDto,
  upsertWorkPipeline,
} from '@/lib/work-pipeline-config'
import type { WorkPipelineConfigJson, WorkPipelineProvider } from '@/lib/work-pipeline-types'
import type { WorkPipelineSecrets } from '@/lib/work-pipeline-types'

function isProvider(v: unknown): v is WorkPipelineProvider {
  return v === 'none' || v === 'jira' || v === 'azure_devops'
}

/**
 * GET /api/work-pipeline — current backlog source configuration (admin).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const row = await getWorkPipelineRow(workspaceId)
    return NextResponse.json(toPublicPipelineDto(row))
  } catch (error) {
    logger.error({ err: error }, 'GET /api/work-pipeline error')
    return NextResponse.json({ error: 'Failed to load work pipeline config' }, { status: 500 })
  }
}

/**
 * PUT /api/work-pipeline — save provider + parameters + optional new secrets (admin).
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const provider = body.provider
    if (!isProvider(provider)) {
      return NextResponse.json({ error: 'provider must be none, jira, or azure_devops' }, { status: 400 })
    }

    const enabled = Boolean(body.enabled)
    const config = (body.config && typeof body.config === 'object'
      ? body.config
      : {}) as WorkPipelineConfigJson

    const secretsBody = body.secrets && typeof body.secrets === 'object' ? body.secrets : {}
    const secretsPatch: Partial<WorkPipelineSecrets> = {}

    if (typeof (secretsBody as Record<string, unknown>).jiraApiToken === 'string') {
      secretsPatch.jiraApiToken = (secretsBody as { jiraApiToken: string }).jiraApiToken
    }
    if (typeof (secretsBody as Record<string, unknown>).azurePat === 'string') {
      secretsPatch.azurePat = (secretsBody as { azurePat: string }).azurePat
    }

    const workspaceId = auth.user.workspace_id ?? 1

    await upsertWorkPipeline(workspaceId, {
      provider,
      enabled,
      config,
      secretsPatch:
        Object.keys(secretsPatch).length > 0 ? secretsPatch : undefined,
    })

    const ipAddress = extractClientIp(request)
    await logAuditEvent({
      action: 'work_pipeline_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { provider, enabled },
      ip_address: ipAddress,
    })

    const row = await getWorkPipelineRow(workspaceId)
    return NextResponse.json(toPublicPipelineDto(row))
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to save'
    if (msg.includes('AUTH_SECRET')) {
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    logger.error({ err: error }, 'PUT /api/work-pipeline error')
    return NextResponse.json({ error: 'Failed to save work pipeline config' }, { status: 500 })
  }
}
