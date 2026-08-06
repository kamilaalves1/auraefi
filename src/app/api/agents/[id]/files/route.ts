import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getAgentWorkspaceCandidates, readAgentWorkspaceFile } from '@/lib/agent-workspace'

async function getAgentByIdOrName(agentId: string, workspaceId: number) {
  if (isNaN(Number(agentId))) {
    return await dbGet('SELECT * FROM agents WHERE name = ? AND workspace_id = ?', [agentId, workspaceId])
  }
  return await dbGet('SELECT * FROM agents WHERE id = ? AND workspace_id = ?', [Number(agentId), workspaceId])
}

/**
 * GET /api/agents/[id]/files - Get agent workspace files (identity.md, agent.md, etc.)
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

    const agentConfig = agent.config ? JSON.parse(agent.config) : {}
    const candidates = getAgentWorkspaceCandidates(agentConfig, agent.name)

    const filesToRead: Record<string, string[]> = {
      'identity.md': ['identity.md', 'IDENTITY.md'],
      'agent.md': ['agent.md', 'AGENT.md'],
      'soul.md': ['soul.md', 'SOUL.md'],
    }

    const files: Record<string, { content: string; path: string | null; exists: boolean }> = {}
    for (const [key, names] of Object.entries(filesToRead)) {
      const result = readAgentWorkspaceFile(candidates, names)
      files[key] = { content: result.content, path: result.path, exists: result.exists }
    }

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name },
      workspace: candidates[0] ?? null,
      files,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/agents/[id]/files error')
    return NextResponse.json({ error: 'Failed to fetch agent files' }, { status: 500 })
  }
}
