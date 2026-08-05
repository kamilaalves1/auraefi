import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbRun } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, upsertDeliveryFlowSchema } from '@/lib/validation'
import { parseDeliveryFlowJson } from '@/lib/delivery-flow-types'
import { logger } from '@/lib/logger'

/**
 * GET /api/workspace/delivery-flow — BPM-style delivery definition for the workspace (JIRA handoffs).
 * PUT — replace definition (operator).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const row = await dbGetOne<{ definition_json: string; updated_at: number; updated_by: string | null }>(
      'SELECT definition_json, updated_at, updated_by FROM workspace_delivery_flows WHERE workspace_id = ?',
      [workspaceId]
    )

    const definition = parseDeliveryFlowJson(row?.definition_json)
    return NextResponse.json({
      definition,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspace/delivery-flow error')
    return NextResponse.json({ error: 'Failed to load delivery flow' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const validated = await validateBody(request, upsertDeliveryFlowSchema)
    if ('error' in validated) return validated.error

    const workspaceId = auth.user.workspace_id ?? 1
    const { definition } = validated.data
    const json = JSON.stringify(definition)
    const now = Math.floor(Date.now() / 1000)
    const user = auth.user.username

    await dbRun(
      `INSERT INTO workspace_delivery_flows (workspace_id, definition_json, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         definition_json = VALUES(definition_json),
         updated_at = VALUES(updated_at),
         updated_by = VALUES(updated_by)`,
      [workspaceId, json, now, user]
    )

    return NextResponse.json({ ok: true, definition })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspace/delivery-flow error')
    return NextResponse.json({ error: 'Failed to save delivery flow' }, { status: 500 })
  }
}
