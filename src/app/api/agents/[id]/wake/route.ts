import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}))
    const customMessage =
      typeof body?.message === 'string' ? body.message.trim() : ''

    const agent: any = isNaN(Number(agentId))
      ? await dbGetOne<any>('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [agentId, workspaceId])
      : await dbGetOne<any>('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(agentId), workspaceId])

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Agent has no session key configured' },
        { status: 400 }
      )
    }

    const message =
      customMessage ||
      `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`

    // Gateway CLI wake removed — log the request and update status only
    logger.info({ agent: agent.name, session_key: agent.session_key, message }, 'Wake requested (gateway CLI unavailable)')

    await db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId).catch(() => {})

    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      note: 'Status updated; live gateway delivery requires a running gateway',
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')
    return NextResponse.json({ error: 'Failed to wake agent' }, { status: 500 })
  }
}
