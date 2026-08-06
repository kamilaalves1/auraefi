import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { extractClientIp, heavyLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * GET /api/backup - Not applicable for MySQL (backups managed by AWS RDS/Aurora)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    backups: [],
    message: 'Database backups are managed by AWS RDS/Aurora. Use the AWS console or CLI to manage backups.',
  })
}

/**
 * POST /api/backup - Not applicable for MySQL (managed by AWS)
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  return NextResponse.json(
    { error: 'Manual database backup is not supported for MySQL. Database backups are managed by AWS RDS/Aurora.' },
    { status: 501 }
  )
}

/**
 * DELETE /api/backup - Not applicable for MySQL
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json(
    { error: 'Manual database backup deletion is not supported for MySQL.' },
    { status: 501 }
  )
}
