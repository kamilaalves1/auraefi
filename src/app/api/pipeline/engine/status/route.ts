import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/pipeline/engine/status — pipeline engine poller health + run counts.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const counts = db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM pipeline_card_runs
         WHERE workspace_id = ?
         GROUP BY status`
      )
      .all(workspaceId) as Array<{ status: string; count: number }>

    const statusMap: Record<string, number> = {}
    for (const row of counts) statusMap[row.status] = row.count

    const recent = db
      .prepare(
        `SELECT id, card_key, card_title, current_stage_id, status, created_at, updated_at
         FROM pipeline_card_runs
         WHERE workspace_id = ?
         ORDER BY updated_at DESC
         LIMIT 10`
      )
      .all(workspaceId)

    return NextResponse.json({
      ok: true,
      counts: statusMap,
      recent,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/pipeline/engine/status error')
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 })
  }
}
