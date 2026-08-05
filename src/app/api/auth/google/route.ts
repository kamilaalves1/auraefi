import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { dbGetOne, dbRun, logAuditEvent } from '@/lib/db'
import { verifyGoogleIdToken } from '@/lib/google-auth'
import { getMcSessionCookieName, getMcSessionCookieOptions, isRequestSecure } from '@/lib/session-cookie'
import { loginLimiter, extractClientIp } from '@/lib/rate-limit'

async function upsertAccessRequest(input: {
  email: string
  providerUserId: string
  displayName: string
  avatarUrl?: string
}) {
  await dbRun(`
    INSERT INTO access_requests (provider, email, provider_user_id, display_name, avatar_url, status, attempt_count, requested_at, last_attempt_at)
    VALUES ('google', ?, ?, ?, ?, 'pending', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
    ON DUPLICATE KEY UPDATE
      provider_user_id = VALUES(provider_user_id),
      display_name = VALUES(display_name),
      avatar_url = VALUES(avatar_url),
      status = 'pending',
      attempt_count = access_requests.attempt_count + 1,
      last_attempt_at = UNIX_TIMESTAMP()
  `, [input.email.toLowerCase(), input.providerUserId, input.displayName, input.avatarUrl || null])
}

export async function POST(request: NextRequest) {
  const rateCheck = loginLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const credential = String(body?.credential || '')
    const profile = await verifyGoogleIdToken(credential)

    const email = String(profile.email || '').toLowerCase().trim()
    const sub = String(profile.sub || '').trim()
    const displayName = String(profile.name || email.split('@')[0] || 'Google User').trim()
    const avatar = profile.picture ? String(profile.picture) : null

    const row = await dbGetOne<any>(`
      SELECT u.id, u.username, u.display_name, u.role, u.provider, u.email, u.avatar_url, u.is_approved,
             u.created_at, u.updated_at, u.last_login_at, u.workspace_id, COALESCE(w.tenant_id, 1) as tenant_id
      FROM users u
      LEFT JOIN workspaces w ON w.id = u.workspace_id
      WHERE (provider = 'google' AND provider_user_id = ?) OR lower(email) = ?
      ORDER BY id ASC
      LIMIT 1
    `, [sub, email])

    const ipAddress = extractClientIp(request)
    const userAgent = request.headers.get('user-agent') || undefined

    if (!row || Number(row.is_approved ?? 1) !== 1) {
      await upsertAccessRequest({
        email,
        providerUserId: sub,
        displayName,
        avatarUrl: avatar || undefined,
      })

      await logAuditEvent({
        action: 'google_login_pending_approval',
        actor: email,
        detail: { email, sub },
        ip_address: ipAddress,
        user_agent: userAgent,
      }).catch(() => {})

      return NextResponse.json(
        { error: 'Access request pending admin approval', code: 'PENDING_APPROVAL' },
        { status: 403 }
      )
    }

    await dbRun(`
      UPDATE users
      SET provider = 'google', provider_user_id = ?, email = ?, avatar_url = COALESCE(?, avatar_url), updated_at = UNIX_TIMESTAMP()
      WHERE id = ?
    `, [sub, email, avatar, row.id])

    const { token, expiresAt } = createSession(row.id, ipAddress, userAgent, row.workspace_id ?? 1)

    await logAuditEvent({ action: 'login_google', actor: row.username, actor_id: row.id, ip_address: ipAddress, user_agent: userAgent }).catch(() => {})

    const response = NextResponse.json({
      user: {
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        provider: 'google',
        email,
        avatar_url: avatar,
        workspace_id: row.workspace_id ?? 1,
        tenant_id: row.tenant_id ?? 1,
      },
    })

    const isSecureRequest = isRequestSecure(request)
    const cookieName = getMcSessionCookieName(isSecureRequest)

    response.cookies.set(cookieName, token, {
      ...getMcSessionCookieOptions({ maxAgeSeconds: expiresAt - Math.floor(Date.now() / 1000), isSecureRequest }),
    })

    return response
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Google login failed' }, { status: 400 })
  }
}
