import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { tickPipelineEngine } from '@/lib/pipeline-engine'

type Params = { params: Promise<{ id: string; runId: string }> }

// Cancel a run (marks as cancelled so it can be re-triggered if card re-enters trigger column)
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id, runId } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = db.prepare('SELECT id, provider FROM work_pipelines WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as { id: number; provider: string } | undefined
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const result = db.prepare(
      `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = unixepoch()
       WHERE id = ? AND workspace_id = ? AND status IN ('failed', 'running', 'waiting_input')`
    ).run(Number(runId), workspaceId)

    if (result.changes === 0) return NextResponse.json({ error: 'Run not found or already terminal' }, { status: 404 })
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
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = db.prepare('SELECT id, provider FROM work_pipelines WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as { id: number; provider: string } | undefined
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    // Reset the run so the engine can pick it back up
    db.prepare(
      `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = unixepoch()
       WHERE id = ? AND workspace_id = ?`
    ).run(Number(runId), workspaceId)

    // Tick the engine immediately
    const result = await tickPipelineEngine()
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to retry run' }, { status: 500 })
  }
}
