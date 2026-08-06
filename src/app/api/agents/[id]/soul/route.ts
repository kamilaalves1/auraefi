import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

async function getAgentByIdOrName(agentId: string, workspaceId: number) {
  if (isNaN(Number(agentId))) {
    return await dbGet('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [agentId, workspaceId])
  }
  return await dbGet('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(agentId), workspaceId])
}

/**
 * GET /api/agents/[id]/soul - Get agent's soul content
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {

    const { id: agentId } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const agent = await getAgentByIdOrName(agentId, workspaceId) as any
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      soul_content: agent.soul_content || '',
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/soul error')
    return NextResponse.json({ error: 'Failed to fetch soul content' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id]/soul - Update agent's soul content
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {

    const { id: agentId } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { soul_content } = body

    const agent = await getAgentByIdOrName(agentId, workspaceId) as any
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const col = isNaN(Number(agentId)) ? 'name' : 'id'
    const val = isNaN(Number(agentId)) ? agentId : Number(agentId)

    await dbRun(`UPDATE agents SET soul_content = ?, updated_at = ? WHERE ${col} = ? AND workspace_id = ?`, [soul_content ?? '', now, val, workspaceId])

    return NextResponse.json({ success: true, soul_content: soul_content ?? '' })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/soul error')
    return NextResponse.json({ error: 'Failed to update soul content' }, { status: 500 })
  }
}
