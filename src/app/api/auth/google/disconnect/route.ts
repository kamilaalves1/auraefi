import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { dbGetOne, dbRun, logAuditEvent } from '@/lib/db'
import { extractClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const user = getUserFromRequest(request)
  if (!user || user.id === 0) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  if (user.provider !== 'google') {
    return NextResponse.json({ error: 'Account is not connected to Google' }, { status: 400 })
  }

  // Check that the user has a password set so they can still log in after disconnect
  const row = await dbGetOne<{ password_hash?: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id])
  if (!row?.password_hash) {
    return NextResponse.json(
      { error: 'Cannot disconnect Google — no password set. Set a password first to avoid being locked out.' },
      { status: 400 }
    )
  }

  await dbRun(`
    UPDATE users
    SET provider = 'local', provider_user_id = NULL, updated_at = UNIX_TIMESTAMP()
    WHERE id = ?
  `, [user.id])

  const ipAddress = extractClientIp(request)
  const userAgent = request.headers.get('user-agent') || undefined
  await logAuditEvent({
    action: 'google_disconnect',
    actor: user.username,
    actor_id: user.id,
    ip_address: ipAddress,
    user_agent: userAgent,
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
