import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetOne, dbRun, dbTransaction, logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/workspaces/[id] - Get a single workspace
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1

    const workspace = await dbGetOne<Record<string, unknown>>(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?',
      [Number(id), tenantId]
    )

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const stats = await dbGetOne<{ agent_count: number }>(
      'SELECT COUNT(*) as agent_count FROM agents WHERE workspace_id = ?',
      [Number(id)]
    )

    return NextResponse.json({
      workspace: { ...workspace, agent_count: stats?.agent_count ?? 0 },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to fetch workspace' }, { status: 500 })
  }
}

/**
 * PUT /api/workspaces/[id] - Update workspace name
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const existing = await dbGetOne<{ name: string }>(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?',
      [Number(id), tenantId]
    )

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    await dbRun(
      'UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
      [name.trim(), now, Number(id), tenantId]
    )

    await logAuditEvent({
      action: 'workspace_updated',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'workspace',
      target_id: Number(id),
      detail: { old_name: existing.name, new_name: name.trim() },
    })

    const updated = await dbGetOne<Record<string, unknown>>('SELECT * FROM workspaces WHERE id = ?', [Number(id)])
    return NextResponse.json({ workspace: updated })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
  }
}

/**
 * DELETE /api/workspaces/[id] - Delete a workspace (moves agents to default workspace)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const tenantId = auth.user.tenant_id ?? 1
    const workspaceId = Number(id)

    const existing = await dbGetOne<{ name: string; slug: string }>(
      'SELECT * FROM workspaces WHERE id = ? AND tenant_id = ?',
      [workspaceId, tenantId]
    )

    if (!existing) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (existing.slug === 'default') {
      return NextResponse.json({ error: 'Cannot delete the default workspace' }, { status: 400 })
    }

    const defaultWs = await dbGetOne<{ id: number }>(
      "SELECT id FROM workspaces WHERE slug = 'default' AND tenant_id = ? LIMIT 1",
      [tenantId]
    )

    const fallbackId = defaultWs?.id ?? 1
    const now = Math.floor(Date.now() / 1000)

    const movedAgents = await dbTransaction(async (conn) => {
      const [agentResult] = await conn.execute(
        'UPDATE agents SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?',
        [fallbackId, now, workspaceId]
      )
      await conn.execute(
        'UPDATE users SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?',
        [fallbackId, now, workspaceId]
      )
      await conn.execute(
        'UPDATE projects SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?',
        [fallbackId, now, workspaceId]
      )
      await conn.execute('DELETE FROM workspaces WHERE id = ?', [workspaceId])
      return (agentResult as any).affectedRows as number
    })

    await logAuditEvent({
      action: 'workspace_deleted',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'workspace',
      target_id: workspaceId,
      detail: {
        name: existing.name,
        slug: existing.slug,
        agents_moved: movedAgents,
        moved_to_workspace: fallbackId,
      },
    })

    return NextResponse.json({
      success: true,
      deleted: existing.name,
      agents_moved_to: fallbackId,
    })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/workspaces/[id] error')
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  }
}
