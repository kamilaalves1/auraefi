import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listCardRuns, cancelCardRun, getCardMessages, reprocessCardRun } from '@/lib/pipeline-engine'
import { logger } from '@/lib/logger'

/**
 * GET /api/pipeline/engine/runs  — list active/recent card runs for the caller's workspace.
 * GET /api/pipeline/engine/runs?id=<runId>&messages=1 — get messages for a specific run.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)
    const runId = searchParams.get('id')
    const showMessages = searchParams.get('messages') === '1'

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
 * POST /api/pipeline/engine/runs  — control actions on a run.
 * Body: { action: 'cancel', run_id: number }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const { action, run_id } = body as { action: string; run_id: number }
    if (!action || !run_id) return NextResponse.json({ error: 'action and run_id are required' }, { status: 400 })

    if (action === 'cancel') {
      const ok = await cancelCardRun(Number(run_id))
      return NextResponse.json({ ok })
    }

    if (action === 'reprocess') {
      const result = await reprocessCardRun(Number(run_id))
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/pipeline/engine/runs error')
    return NextResponse.json({ error: 'Failed to process action' }, { status: 500 })
  }
}
