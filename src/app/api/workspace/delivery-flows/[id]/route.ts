import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { parseDeliveryFlowJson, type DeliveryFlow, type GitRepository } from '@/lib/delivery-flow-types'
import { logger } from '@/lib/logger'

function rowToFlow(row: any, repoRow?: any): DeliveryFlow {
  const git_repository: GitRepository | null = repoRow
    ? {
        id: repoRow.id,
        workspace_id: repoRow.workspace_id,
        name: repoRow.name,
        provider: repoRow.provider,
        repo_url: repoRow.repo_url,
        branch: repoRow.branch ?? 'main',
        is_active: Boolean(repoRow.is_active),
        created_at: repoRow.created_at,
        updated_at: repoRow.updated_at,
      }
    : null

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    git_repository_id: row.git_repository_id ?? null,
    git_repository,
    is_active: Boolean(row.is_active),
    definition: parseDeliveryFlowJson(row.definition_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? null,
  }
}

async function loadFlowWithRepo(flowRow: any): Promise<DeliveryFlow> {
  const repoRow = flowRow.git_repository_id
    ? await dbGet('SELECT * FROM git_repositories WHERE id = ?', [flowRow.git_repository_id])
    : null
  return rowToFlow(flowRow, repoRow)
}

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1
    const row = await dbGet('SELECT * FROM delivery_flows WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as any | undefined

    if (!row) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    return NextResponse.json({ flow: await loadFlowWithRepo(row) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspace/delivery-flows/[id] error')
    return NextResponse.json({ error: 'Failed to load delivery flow' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const workspaceId = auth.user.workspace_id ?? 1

    const existing = await dbGet('SELECT * FROM delivery_flows WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as any | undefined
    if (!existing) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120) : existing.name
    const is_active = typeof body.is_active === 'boolean' ? (body.is_active ? 1 : 0) : existing.is_active
    const definition_json = body.definition ? JSON.stringify(body.definition) : existing.definition_json

    // git_repository_id: explicit null clears it; undefined keeps existing
    const git_repository_id = body.git_repository_id === null
      ? null
      : typeof body.git_repository_id === 'number'
        ? body.git_repository_id
        : existing.git_repository_id

    const now = Math.floor(Date.now() / 1000)

    await dbRun(`UPDATE delivery_flows
       SET name=?, is_active=?, definition_json=?, git_repository_id=?, updated_at=?, updated_by=?
       WHERE id=? AND workspace_id=?`, [name, is_active, definition_json, git_repository_id, now, auth.user.username, Number(id), workspaceId])

    const updated = await dbGet('SELECT * FROM delivery_flows WHERE id = ?', [Number(id)]) as any
    return NextResponse.json({ flow: await loadFlowWithRepo(updated) })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workspace/delivery-flows/[id] error')
    return NextResponse.json({ error: 'Failed to update delivery flow' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1

    const count = (await dbGet('SELECT COUNT(*) as cnt FROM delivery_flows WHERE workspace_id = ?', [workspaceId]) as { cnt: number }).cnt
    if (count <= 1) return NextResponse.json({ error: 'Cannot delete the last flow' }, { status: 400 })

    const result = await dbRun('DELETE FROM delivery_flows WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (result.affectedRows === 0) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/workspace/delivery-flows/[id] error')
    return NextResponse.json({ error: 'Failed to delete delivery flow' }, { status: 500 })
  }
}
