import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'

const GATEWAY_TIMEOUT = 5000

/** Probe the gateway HTTP /health endpoint to check reachability. */
async function isGatewayReachable(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT)
  try {
    const res = await fetch(
      `http://${config.gatewayHost}:${config.gatewayPort}/health`,
      { signal: controller.signal },
    )
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action') || 'list'

  if (action === 'list') {
    const connected = await isGatewayReachable()
    return NextResponse.json({ nodes: [], connected })
  }

  if (action === 'devices') {
    return NextResponse.json({ devices: [] })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}

/**
 * POST /api/nodes - Device management actions
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  logger.warn({}, 'Device action not supported without gateway RPC')
  return NextResponse.json({ error: 'Device management actions require direct gateway connectivity' }, { status: 503 })
}
