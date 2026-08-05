import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { extractClientIp } from '@/lib/rate-limit'

/**
 * GET /api/backup - Not applicable for Aurora MySQL (backups are managed by AWS RDS)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    backups: [],
    message: 'Database backups are managed by AWS Aurora. Use the RDS console for snapshot management.',
  })
}

/**
 * POST /api/backup - Not applicable for Aurora MySQL
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const ipAddress = extractClientIp(request)
  await logAuditEvent({
    action: 'backup_create_attempted',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { note: 'Aurora MySQL — backups managed by AWS' },
    ip_address: ipAddress,
  }).catch(() => {})

  return NextResponse.json(
    {
      error: 'Manual database backup is not available with Aurora MySQL. Use AWS RDS automated snapshots.',
      hint: 'Configure automated backups in your Aurora cluster settings in the AWS console.',
    },
    { status: 501 }
  )
}

/**
 * DELETE /api/backup — Not applicable for Aurora MySQL
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { error: 'Backup management is handled by AWS Aurora. Use the RDS console.' },
    { status: 501 }
  )
}
