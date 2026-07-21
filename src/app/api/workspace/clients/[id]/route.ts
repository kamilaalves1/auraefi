import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))

    const existing = db.prepare('SELECT * FROM clients WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId) as any
    if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120) : existing.name
    const description = body.description === null
      ? null
      : typeof body.description === 'string'
        ? body.description.trim().slice(0, 500)
        : existing.description

    db.prepare(
      'UPDATE clients SET name = ?, description = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?'
    ).run(name, description, Number(id), workspaceId)

    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(id))
    return NextResponse.json({ client: row })
  } catch (err) {
    logger.error({ err }, 'PUT /api/workspace/clients/[id] error')
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Unlink pipelines from this client before deleting
    db.prepare('UPDATE work_pipelines SET client_id = NULL WHERE client_id = ? AND workspace_id = ?').run(Number(id), workspaceId)

    const result = db.prepare('DELETE FROM clients WHERE id = ? AND workspace_id = ?').run(Number(id), workspaceId)
    if (result.changes === 0) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/workspace/clients/[id] error')
    return NextResponse.json({ error: 'Failed to delete client' }, { status: 500 })
  }
}
