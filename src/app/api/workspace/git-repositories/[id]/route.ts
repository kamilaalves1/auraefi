import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { GitRepository, GitProvider } from '@/lib/delivery-flow-types'

const VALID_PROVIDERS: GitProvider[] = ['github', 'gitlab', 'bitbucket']

function normaliseRepoUrl(raw: string): string {
  const s = raw.trim()
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`)
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '')
  } catch {
    return s.replace(/\.git$/, '')
  }
}

function rowToRepo(row: any): GitRepository {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    provider: row.provider as GitProvider,
    repo_url: row.repo_url,
    branch: row.branch ?? 'main',
    access_token: row.access_token ?? null,
    base_url: row.base_url ?? null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function rowToRepoForRole(row: any, role: string): GitRepository {
  const isOperator = ['operator', 'admin', 'super'].includes(role)
  return { ...rowToRepo(row), access_token: isOperator ? (row.access_token ?? null) : null }
}

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1
    const row = await dbGet('SELECT * FROM git_repositories WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])
    if (!row) return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    return NextResponse.json({ repository: rowToRepoForRole(row as any, auth.user.role) })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/git-repositories/[id] error')
    return NextResponse.json({ error: 'Failed to load repository' }, { status: 500 })
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

    const existing = await dbGet('SELECT * FROM git_repositories WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as any | undefined
    if (!existing) return NextResponse.json({ error: 'Repository not found' }, { status: 404 })

    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120) : existing.name
    const provider: GitProvider = VALID_PROVIDERS.includes(body.provider) ? body.provider : existing.provider
    const repo_url = typeof body.repo_url === 'string' && body.repo_url.trim()
      ? body.repo_url.trim().slice(0, 500) : existing.repo_url
    const branch = typeof body.branch === 'string' && body.branch.trim()
      ? body.branch.trim().slice(0, 100) : existing.branch
    const is_active = typeof body.is_active === 'boolean' ? (body.is_active ? 1 : 0) : existing.is_active
    // access_token: explicit null clears it, string sets it, undefined keeps existing
    const access_token = body.access_token === null
      ? null
      : typeof body.access_token === 'string' && body.access_token.trim()
        ? body.access_token.trim()
        : existing.access_token
    // base_url: same pattern
    const base_url = body.base_url === null
      ? null
      : typeof body.base_url === 'string' && body.base_url.trim()
        ? body.base_url.trim().slice(0, 500)
        : existing.base_url
    const now = Math.floor(Date.now() / 1000)

    await dbRun(`UPDATE git_repositories SET name=?, provider=?, repo_url=?, branch=?, access_token=?, base_url=?, is_active=?, updated_at=?
       WHERE id=? AND workspace_id=?`, [name, provider, repo_url, branch, access_token, base_url, is_active, now, Number(id), workspaceId])

    const updated = await dbGet('SELECT * FROM git_repositories WHERE id = ?', [Number(id)])
    return NextResponse.json({ repository: rowToRepo(updated as any) })
  } catch (err) {
    logger.error({ err }, 'PUT /api/workspace/git-repositories/[id] error')
    return NextResponse.json({ error: 'Failed to update repository' }, { status: 500 })
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

    // Unlink any delivery flows using this repo before deleting
    await dbRun('UPDATE delivery_flows SET git_repository_id = NULL WHERE git_repository_id = ? AND workspace_id = ?', [Number(id), workspaceId])

    // Remove the deleted repo from linkedRepoIds in all pipeline configs of this workspace
    const pipelines = await dbGetAll(
      'SELECT id, config_json FROM work_pipelines WHERE workspace_id = ?',
      [workspaceId]
    ) as Array<{ id: number; config_json: string }>
    for (const pipeline of pipelines) {
      try {
        const cfg = JSON.parse(pipeline.config_json ?? '{}')
        if (Array.isArray(cfg.linkedRepoIds) && cfg.linkedRepoIds.includes(Number(id))) {
          cfg.linkedRepoIds = cfg.linkedRepoIds.filter((rid: number) => rid !== Number(id))
          await dbRun(
            'UPDATE work_pipelines SET config_json = ? WHERE id = ?',
            [JSON.stringify(cfg), pipeline.id]
          )
        }
      } catch { /* non-fatal */ }
    }

    const result = await dbRun('DELETE FROM git_repositories WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId])

    if (result.affectedRows === 0) return NextResponse.json({ error: 'Repository not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/workspace/git-repositories/[id] error')
    return NextResponse.json({ error: 'Failed to delete repository' }, { status: 500 })
  }
}
