import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
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

function loadFlowWithRepo(db: ReturnType<typeof getDatabase>, flowRow: any): DeliveryFlow {
  const repoRow = flowRow.git_repository_id
    ? db.prepare('SELECT * FROM git_repositories WHERE id = ?').get(flowRow.git_repository_id)
    : null
  return rowToFlow(flowRow, repoRow)
}

/** GET /api/workspace/delivery-flows — list all flows for the workspace */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = db.prepare(
      'SELECT * FROM delivery_flows WHERE workspace_id = ? ORDER BY created_at ASC'
    ).all(workspaceId) as any[]

    return NextResponse.json({ flows: rows.map(r => loadFlowWithRepo(db, r)) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workspace/delivery-flows error')
    return NextResponse.json({ error: 'Failed to load delivery flows' }, { status: 500 })
  }
}

/** POST /api/workspace/delivery-flows — create a new flow */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const workspaceId = auth.user.workspace_id ?? 1
    const db = getDatabase()

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : 'Novo fluxo'
    const git_repository_id = typeof body.git_repository_id === 'number' ? body.git_repository_id : null
    const definition_json = body.definition ? JSON.stringify(body.definition) : '{}'
    const now = Math.floor(Date.now() / 1000)

    const result = db.prepare(
      `INSERT INTO delivery_flows (workspace_id, name, git_repository_id, definition_json, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(workspaceId, name, git_repository_id, definition_json, now, now, auth.user.username)

    const row = db.prepare('SELECT * FROM delivery_flows WHERE id = ?').get(result.lastInsertRowid) as any
    return NextResponse.json({ flow: loadFlowWithRepo(db, row) }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/workspace/delivery-flows error')
    return NextResponse.json({ error: 'Failed to create delivery flow' }, { status: 500 })
  }
}
