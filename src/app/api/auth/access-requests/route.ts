import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createUser, getUserFromRequest , requireRole } from '@/lib/auth'
import { dbGetOne, dbGetAll, dbRun, dbTransaction, logAuditEvent } from '@/lib/db'
import { validateBody, accessRequestActionSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'

function makeUsernameFromEmail(email: string): string {
  const base = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user'
  return base.slice(0, 28)
}

async function ensureUniqueUsername(base: string): Promise<string> {
  let candidate = base
  let i = 0
  while (await dbGetOne<any>('SELECT 1 FROM users WHERE username = ?', [candidate])) {
    i += 1
    candidate = `${base.slice(0, 24)}-${i}`
  }
  return candidate
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const user = getUserFromRequest(request)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL DEFAULT 'google',
      email TEXT NOT NULL,
      provider_user_id TEXT,
      display_name TEXT,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
      last_attempt_at INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
      attempt_count INTEGER NOT NULL DEFAULT 1,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      review_note TEXT,
      approved_user_id INTEGER
    )
  `, [])

  const status = String(request.nextUrl.searchParams.get('status') || 'all')
  const rows = status === 'all'
    ? await dbGetAll<any>("SELECT * FROM access_requests ORDER BY status = 'pending' DESC, last_attempt_at DESC, id DESC", [])
    : await dbGetAll<any>('SELECT * FROM access_requests WHERE status = ? ORDER BY last_attempt_at DESC, id DESC', [status])

  return NextResponse.json({ requests: rows })
}

export async function POST(request: NextRequest) {
  const admin = getUserFromRequest(request)
  if (!admin || admin.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, accessRequestActionSchema)
  if ('error' in result) return result.error

  const { request_id: requestId, action, role, note } = result.data

  const reqRow = await dbGetOne<any>('SELECT * FROM access_requests WHERE id = ?', [requestId])
  if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  if (action === 'reject') {
    await dbRun(`
      UPDATE access_requests
      SET status = 'rejected', reviewed_by = ?, reviewed_at = UNIX_TIMESTAMP(), review_note = ?
      WHERE id = ?
    `, [admin.username, note, requestId])

    await logAuditEvent({
      action: 'access_request_rejected',
      actor: admin.username,
      actor_id: admin.id,
      detail: { request_id: requestId, email: reqRow.email, note },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  }

  const email = String(reqRow.email || '').toLowerCase()
  const providerUserId = reqRow.provider_user_id ? String(reqRow.provider_user_id) : null
  const displayName = String(reqRow.display_name || email.split('@')[0] || 'Google User')
  const avatarUrl = reqRow.avatar_url ? String(reqRow.avatar_url) : null

  const user = await dbTransaction(async (conn) => {
    const [existingRows] = await conn.execute(
      'SELECT * FROM users WHERE lower(email) = ? OR (provider = ? AND provider_user_id = ?) ORDER BY id ASC LIMIT 1',
      [email, 'google', providerUserId || '']
    )
    const existing = (existingRows as any[])[0] as any

    let userId: number
    if (existing) {
      await conn.execute(`
        UPDATE users
        SET provider = 'google', provider_user_id = ?, email = ?, avatar_url = COALESCE(?, avatar_url), is_approved = 1, role = ?, approved_by = ?, approved_at = UNIX_TIMESTAMP(), updated_at = UNIX_TIMESTAMP()
        WHERE id = ?
      `, [providerUserId, email, avatarUrl, role, admin.username, existing.id])
      userId = Number(existing.id)
    } else {
      const username = await ensureUniqueUsername(makeUsernameFromEmail(email))
      const randomPwd = randomBytes(24).toString('hex')
      const created = createUser(username, randomPwd, displayName, role, {
        provider: 'google',
        provider_user_id: providerUserId,
        email,
        avatar_url: avatarUrl,
        is_approved: 1,
        approved_by: admin.username,
        approved_at: Math.floor(Date.now() / 1000),
      })
      userId = created.id
    }

    await conn.execute(`
      UPDATE access_requests
      SET status = 'approved', reviewed_by = ?, reviewed_at = UNIX_TIMESTAMP(), review_note = ?, approved_user_id = ?
      WHERE id = ?
    `, [admin.username, note, userId, requestId])

    const [userRows] = await conn.execute(
      'SELECT id, username, display_name, role, provider, email, avatar_url, is_approved FROM users WHERE id = ?',
      [userId]
    )
    return (userRows as any[])[0]
  }) as any

  await logAuditEvent({
    action: 'access_request_approved',
    actor: admin.username,
    actor_id: admin.id,
    detail: { request_id: requestId, email, role, user_id: user?.id, note },
  }).catch(() => {})

  return NextResponse.json({ ok: true, user })
}
