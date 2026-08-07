import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

const MAX_HISTORY = 20

async function getAgentByIdOrName(agentId: string, workspaceId: number) {
  if (isNaN(Number(agentId))) {
    return await dbGet('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [agentId, workspaceId])
  }
  return await dbGet('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(agentId), workspaceId])
}

/**
 * GET /api/agents/[id]/soul - Get soul content + history
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
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const history = await dbGetAll(
      `SELECT id, soul_content, edited_by, edited_at
       FROM agent_soul_history
       WHERE agent_id = ? AND workspace_id = ?
       ORDER BY edited_at DESC
       LIMIT ?`,
      [agent.id, workspaceId, MAX_HISTORY]
    )

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      soul_content: agent.soul_content || '',
      history,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/soul error')
    return NextResponse.json({ error: 'Failed to fetch soul content' }, { status: 500 })
  }
}

/**
 * PUT /api/agents/[id]/soul - Update soul content (saves current version to history first)
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
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const now = Math.floor(Date.now() / 1000)
    const editor = (auth.user as any).username || (auth.user as any).name || 'unknown'

    // Save current soul_content to history before overwriting (skip if identical or empty)
    const current = (agent.soul_content || '').trim()
    const incoming = (soul_content ?? '').trim()
    if (current && current !== incoming) {
      await dbRun(
        `INSERT INTO agent_soul_history (agent_id, workspace_id, soul_content, edited_by, edited_at)
         VALUES (?, ?, ?, ?, ?)`,
        [agent.id, workspaceId, current, editor, now]
      )
      // Prune oldest entries beyond MAX_HISTORY
      await dbRun(
        `DELETE FROM agent_soul_history
         WHERE agent_id = ? AND workspace_id = ?
           AND id NOT IN (
             SELECT id FROM (
               SELECT id FROM agent_soul_history
               WHERE agent_id = ? AND workspace_id = ?
               ORDER BY edited_at DESC
               LIMIT ?
             ) t
           )`,
        [agent.id, workspaceId, agent.id, workspaceId, MAX_HISTORY]
      )
    }

    const col = isNaN(Number(agentId)) ? 'name' : 'id'
    const val = isNaN(Number(agentId)) ? agentId : Number(agentId)
    await dbRun(
      `UPDATE agents SET soul_content = ?, updated_at = ? WHERE ${col} = ? AND workspace_id = ?`,
      [soul_content ?? '', now, val, workspaceId]
    )

    return NextResponse.json({ success: true, soul_content: soul_content ?? '' })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/agents/[id]/soul error')
    return NextResponse.json({ error: 'Failed to update soul content' }, { status: 500 })
  }
}

/**
 * POST /api/agents/[id]/soul/restore - Restore a historical version
 * Body: { history_id: number }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id: agentId } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const historyId = Number(body?.history_id)
    if (!historyId) return NextResponse.json({ error: 'history_id required' }, { status: 400 })

    const agent = await getAgentByIdOrName(agentId, workspaceId) as any
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const entry = await dbGet(
      'SELECT * FROM agent_soul_history WHERE id = ? AND agent_id = ? AND workspace_id = ?',
      [historyId, agent.id, workspaceId]
    ) as any
    if (!entry) return NextResponse.json({ error: 'History entry not found' }, { status: 404 })

    // Treat restore as a regular soul update (saves current to history)
    const restoreReq = new Request(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: JSON.stringify({ soul_content: entry.soul_content }),
    })
    return PUT(restoreReq as NextRequest, { params })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/soul restore error')
    return NextResponse.json({ error: 'Failed to restore soul content' }, { status: 500 })
  }
}
