import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import {
  listCardRuns,
  cancelCardRun,
  getCardMessages,
  reprocessCardRun,
  getRunSnapshots,
  rollbackToSnapshot,
} from '@/lib/pipeline-engine'
import { dbRun } from '@/lib/db-pool'
import { logger } from '@/lib/logger'

/**
 * GET /api/pipeline/engine/runs                        — lista runs ativos/recentes
 * GET /api/pipeline/engine/runs?id=<id>&messages=1    — mensagens de um run
 * GET /api/pipeline/engine/runs?id=<id>&snapshots=1   — snapshots de etapas para replay
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('id')
    const showMessages = searchParams.get('messages') === '1'
    const showSnapshots = searchParams.get('snapshots') === '1'

    if (runId && showSnapshots) {
      const snapshots = await getRunSnapshots(Number(runId))
      return NextResponse.json({ snapshots })
    }

    if (runId && showMessages) {
      const messages = await getCardMessages(Number(runId))
      return NextResponse.json({ messages })
    }

    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
    const runs = await listCardRuns(workspaceId, limit)
    return NextResponse.json({ runs })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/pipeline/engine/runs error')
    return NextResponse.json({ error: 'Failed to list runs' }, { status: 500 })
  }
}

/**
 * POST /api/pipeline/engine/runs — ações sobre um run
 * Body: { action: 'cancel' | 'reprocess' | 'rollback', run_id: number, stage_id?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { action, run_id, stage_id } = body as { action: string; run_id: number; stage_id?: string }
    if (!action || !run_id) return NextResponse.json({ error: 'action and run_id are required' }, { status: 400 })

    if (action === 'cancel') {
      const ok = await cancelCardRun(Number(run_id))
      return NextResponse.json({ ok })
    }

    if (action === 'reprocess') {
      const result = await reprocessCardRun(Number(run_id))
      return NextResponse.json(result)
    }

    if (action === 'rollback') {
      if (!stage_id) return NextResponse.json({ error: 'stage_id is required for rollback' }, { status: 400 })
      const result = await rollbackToSnapshot(Number(run_id), stage_id)
      return NextResponse.json(result)
    }

    if (action === 'clear_all') {
      // Apaga todo o histórico de runs do workspace
      const workspaceId = auth.user.workspace_id ?? 1

      // Cancela runs ativos primeiro
      await dbRun(
        `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
         WHERE workspace_id = ? AND status NOT IN ('done', 'cancelled', 'failed')`,
        [workspaceId]
      )

      // Apaga mensagens de todos os runs do workspace
      await dbRun(
        `DELETE pcm FROM pipeline_card_messages pcm
         INNER JOIN pipeline_card_runs pcr ON pcr.id = pcm.run_id
         WHERE pcr.workspace_id = ?`,
        [workspaceId]
      )

      // Apaga os runs
      const result = await dbRun(
        `DELETE FROM pipeline_card_runs WHERE workspace_id = ?`,
        [workspaceId]
      )

      logger.info({ workspaceId, deleted: result.affectedRows }, 'pipeline-engine: all runs cleared by user')
      return NextResponse.json({ ok: true, deleted: result.affectedRows })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipeline/engine/runs error')
    return NextResponse.json({ error: 'Failed to process action' }, { status: 500 })
  }
}
