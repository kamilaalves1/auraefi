import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, dbRun } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { tickPipelineEngine } from '@/lib/pipeline-engine'

type Params = { params: Promise<{ id: string; runId: string }> }

// Cancel a run (marks as cancelled so it can be re-triggered if card re-enters trigger column)
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id, runId } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = await dbGetOne<{ id: number; provider: string }>(
      'SELECT id, provider FROM work_pipelines WHERE id = ? AND workspace_id = ?',
      [Number(id), workspaceId]
    )
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const result = await dbRun(
      `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
       WHERE id = ? AND workspace_id = ? AND status IN ('failed', 'running', 'waiting_input')`,
      [Number(runId), workspaceId]
    )

    if (result.affectedRows === 0) return NextResponse.json({ error: 'Run not found or already terminal' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to cancel run' }, { status: 500 })
  }
}

// Force-retry a specific run: reset to cancelled then tick the engine
export async function POST(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id, runId } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = await dbGetOne<{ id: number; provider: string }>(
      'SELECT id, provider FROM work_pipelines WHERE id = ? AND workspace_id = ?',
      [Number(id), workspaceId]
    )
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    // Reset the run so the engine can pick it back up
    await dbRun(
      `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP()
       WHERE id = ? AND workspace_id = ?`,
      [Number(runId), workspaceId]
    )

    // Tick the engine immediately
    const result = await tickPipelineEngine()
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to retry run' }, { status: 500 })
  }
}
