import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'node:fs'
import { APP_VERSION } from '@/lib/version'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const deploymentMode = existsSync('/.dockerenv') ? 'docker' : 'bare-metal'

  return NextResponse.json(
    { updateAvailable: false, currentVersion: APP_VERSION, latestVersion: APP_VERSION, deploymentMode },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
