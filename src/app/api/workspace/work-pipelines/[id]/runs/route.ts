import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { tickPipelineEngine } from '@/lib/pipeline-engine'

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1

    const pipeline = await dbGet('SELECT id, provider, workspace_id FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as { id: number; provider: string; workspace_id: number } | undefined
    if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const runs = await dbGetAll(`SELECT id, card_key, card_title, card_url, current_stage_id, status, cost_usd, created_at, updated_at
       FROM pipeline_card_runs
       WHERE workspace_id = ? AND provider = ?
       ORDER BY updated_at DESC LIMIT 20`, [workspaceId, pipeline.provider]) as Array<{
      id: number
      card_key: string
      card_title: string
      card_url: string
      current_stage_id: string
      status: string
      cost_usd: number | null
      created_at: number
      updated_at: number
    }>

    const columnIds = [...new Set(runs.map(r => parseInt(r.current_stage_id, 10)).filter(n => !isNaN(n)))]
    const stageNames: Record<number, string> = {}
    if (columnIds.length > 0) {
      const placeholders = columnIds.map(() => '?').join(',')
      const cols = await dbGetAll(`SELECT id, column_name FROM pipeline_columns WHERE id IN (${placeholders})`, columnIds) as Array<{ id: number; column_name: string }>
      for (const c of cols) stageNames[c.id] = c.column_name
    }

    return NextResponse.json({
      runs: runs.map(r => ({
        ...r,
        stage_name: stageNames[parseInt(r.current_stage_id, 10)] ?? r.current_stage_id,
      }))
    })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load runs' }, { status: 500 })
  }
}

// Force a single engine tick (manual trigger)
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await params // consume params
  const result = await tickPipelineEngine()
  return NextResponse.json(result)
}
