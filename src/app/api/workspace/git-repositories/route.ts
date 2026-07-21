import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import type { GitRepository, GitProvider } from '@/lib/delivery-flow-types'

const VALID_PROVIDERS: GitProvider[] = ['github', 'gitlab', 'bitbucket']

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`)
    if (!['https:', 'http:'].includes(url.protocol)) return true
    const h = url.hostname
    if (['localhost', '0.0.0.0', '::1'].includes(h)) return true
    if (h.endsWith('.local')) return true
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
      const [a, b] = h.split('.').map(Number)
      if (a === 10 || a === 127) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
      if (a === 100 && b >= 64 && b <= 127) return true
    }
    // IPv6 private ranges
    if (/^(\[?fc|fd|fe80)/i.test(h)) return true
    return false
  } catch { return true }
}

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

/** GET /api/workspace/git-repositories — list all repos for workspace */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const rows = db.prepare(
      'SELECT * FROM git_repositories WHERE workspace_id = ? ORDER BY created_at ASC'
    ).all(workspaceId)
    return NextResponse.json({ repositories: (rows as any[]).map(row => rowToRepoForRole(row, auth.user.role)) })
  } catch (err) {
    logger.error({ err }, 'GET /api/workspace/git-repositories error')
    return NextResponse.json({ error: 'Failed to load repositories' }, { status: 500 })
  }
}

/** POST /api/workspace/git-repositories — create a new repo */
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
      : 'Novo repositório'
    const provider: GitProvider = VALID_PROVIDERS.includes(body.provider) ? body.provider : 'github'
    const repo_url = typeof body.repo_url === 'string' ? body.repo_url.trim().slice(0, 500) : ''
    const branch = typeof body.branch === 'string' && body.branch.trim()
      ? body.branch.trim().slice(0, 100)
      : 'main'
    const access_token = typeof body.access_token === 'string' && body.access_token.trim()
      ? body.access_token.trim()
      : null
    const base_url_raw = typeof body.base_url === 'string' ? body.base_url.trim() : ''
    if (base_url_raw && isBlockedUrl(base_url_raw)) {
      return NextResponse.json({ error: 'Invalid base_url: private or loopback addresses are not allowed' }, { status: 400 })
    }
    const base_url = base_url_raw ? base_url_raw.slice(0, 500) : null

    if (!repo_url) {
      return NextResponse.json({ error: 'repo_url is required' }, { status: 400 })
    }

    const now = Math.floor(Date.now() / 1000)
    const result = db.prepare(
      `INSERT INTO git_repositories (workspace_id, name, provider, repo_url, branch, access_token, base_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(workspaceId, name, provider, repo_url, branch, access_token, base_url, now, now)

    const row = db.prepare('SELECT * FROM git_repositories WHERE id = ?').get(result.lastInsertRowid)
    return NextResponse.json({ repository: rowToRepo(row as any) }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/workspace/git-repositories error')
    return NextResponse.json({ error: 'Failed to create repository' }, { status: 500 })
  }
}
