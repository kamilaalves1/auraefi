import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGetAll, dbGetOne, dbRun } from '@/lib/db'
import { getDetectedGatewayPort, getDetectedGatewayToken } from '@/lib/gateway-runtime'

interface GatewayEntry {
  id: number
  name: string
  host: string
  port: number
  token: string
  is_primary: number
  status: string
  last_seen: number | null
  latency: number | null
  sessions_count: number
  agents_count: number
  created_at: number
  updated_at: number
}

async function ensureTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS gateways (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 18789,
      token TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen INTEGER,
      latency INTEGER,
      sessions_count INTEGER NOT NULL DEFAULT 0,
      agents_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP()),
      updated_at INTEGER NOT NULL DEFAULT (UNIX_TIMESTAMP())
    )
  `, [])
}

/**
 * GET /api/gateways - List all registered gateways
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await ensureTable()

  const gateways = await dbGetAll<GatewayEntry>('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC')

  // If no gateways exist, seed defaults from environment
  if (gateways.length === 0) {
    const name = String(process.env.MC_DEFAULT_GATEWAY_NAME || 'primary')
    const host = String(process.env.GATEWAY_HOST || '127.0.0.1')
    const mainPort = getDetectedGatewayPort() || parseInt(process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789')
    const mainToken = getDetectedGatewayToken()

    await dbRun(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, 1)
    `, [name, host, mainPort, mainToken])

    const seeded = await dbGetAll<GatewayEntry>('SELECT * FROM gateways ORDER BY is_primary DESC, name ASC')
    return NextResponse.json({ gateways: redactTokens(seeded) })
  }

  return NextResponse.json({ gateways: redactTokens(gateways) })
}

/**
 * POST /api/gateways - Add a new gateway
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await ensureTable()
  const body = await request.json()

  const { name, host, port, token, is_primary, agents } = body

  if (!name || !host || !port) {
    return NextResponse.json({ error: 'name, host, and port are required' }, { status: 400 })
  }

  try {
    // If marking as primary, unset other primaries
    if (is_primary) {
      await dbRun('UPDATE gateways SET is_primary = 0', [])
    }

    const result = await dbRun(`
      INSERT INTO gateways (name, host, port, token, is_primary) VALUES (?, ?, ?, ?, ?)
    `, [name, host, port, token || '', is_primary ? 1 : 0])

    // Auto-register agents reported by the gateway (k8s sidecar support)
    let agentsRegistered = 0
    if (Array.isArray(agents) && agents.length > 0) {
      const workspaceId = auth.user?.workspace_id ?? 1
      const now = Math.floor(Date.now() / 1000)
      for (const agent of agents.slice(0, 50)) {
        if (typeof agent?.name !== 'string' || !agent.name.trim()) continue
        const agentName = agent.name.trim().substring(0, 100)
        const agentRole = typeof agent?.role === 'string' ? agent.role.trim().substring(0, 100) : 'agent'
        await dbRun(`
          INSERT INTO agents (name, role, status, last_seen, source, workspace_id, updated_at)
          VALUES (?, ?, 'idle', ?, 'gateway', ?, ?)
          ON DUPLICATE KEY UPDATE
            status = 'idle',
            last_seen = VALUES(last_seen),
            source = 'gateway',
            updated_at = VALUES(updated_at)
        `, [agentName, agentRole, now, workspaceId, now])
        agentsRegistered++
      }
    }

    try {
      await dbRun('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)', [
        'gateway_added', auth.user?.username || 'system', `Added gateway: ${name} (${host}:${port})${agentsRegistered ? `, registered ${agentsRegistered} agent(s)` : ''}`
      ])
    } catch { /* audit might not exist */ }

    const gw = await dbGetOne<GatewayEntry>('SELECT * FROM gateways WHERE id = ?', [result.insertId])
    return NextResponse.json({ gateway: redactToken(gw!), agents_registered: agentsRegistered }, { status: 201 })
  } catch (err: any) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('Duplicate entry')) {
      return NextResponse.json({ error: 'A gateway with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: err.message || 'Failed to add gateway' }, { status: 500 })
  }
}

/**
 * PUT /api/gateways - Update a gateway
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await ensureTable()
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existing = await dbGetOne<GatewayEntry>('SELECT * FROM gateways WHERE id = ?', [id])
  if (!existing) return NextResponse.json({ error: 'Gateway not found' }, { status: 404 })

  // If setting as primary, unset others
  if (updates.is_primary) {
    await dbRun('UPDATE gateways SET is_primary = 0', [])
  }

  const allowed = ['name', 'host', 'port', 'token', 'is_primary', 'status', 'last_seen', 'latency', 'sessions_count', 'agents_count']
  const sets: string[] = []
  const values: any[] = []

  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`)
      values.push(updates[key])
    }
  }

  if (sets.length === 0 && !Array.isArray(updates.agents)) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  if (sets.length > 0) {
    sets.push('updated_at = (UNIX_TIMESTAMP())')
    values.push(id)
    await dbRun(`UPDATE gateways SET ${sets.join(', ')} WHERE id = ?`, values)
  }

  // Auto-register agents reported by the gateway (k8s sidecar support)
  let agentsRegistered = 0
  if (Array.isArray(updates.agents) && updates.agents.length > 0) {
    const workspaceId = auth.user?.workspace_id ?? 1
    const now = Math.floor(Date.now() / 1000)
    for (const agent of updates.agents.slice(0, 50)) {
      if (typeof agent?.name !== 'string' || !agent.name.trim()) continue
      const agentName = agent.name.trim().substring(0, 100)
      const agentRole = typeof agent?.role === 'string' ? agent.role.trim().substring(0, 100) : 'agent'
      await dbRun(`
        INSERT INTO agents (name, role, status, last_seen, source, workspace_id, updated_at)
        VALUES (?, ?, 'idle', ?, 'gateway', ?, ?)
        ON DUPLICATE KEY UPDATE
          status = 'idle',
          last_seen = VALUES(last_seen),
          source = 'gateway',
          updated_at = VALUES(updated_at)
      `, [agentName, agentRole, now, workspaceId, now])
      agentsRegistered++
    }
  }

  const updated = await dbGetOne<GatewayEntry>('SELECT * FROM gateways WHERE id = ?', [id])
  return NextResponse.json({ gateway: redactToken(updated!), agents_registered: agentsRegistered })
}

/**
 * DELETE /api/gateways - Remove a gateway
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  await ensureTable()
  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const gw = await dbGetOne<GatewayEntry>('SELECT * FROM gateways WHERE id = ?', [id])
  if (gw?.is_primary) {
    return NextResponse.json({ error: 'Cannot delete the primary gateway' }, { status: 400 })
  }

  const result = await dbRun('DELETE FROM gateways WHERE id = ?', [id])

  try {
    await dbRun('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)', [
      'gateway_removed', auth.user?.username || 'system', `Removed gateway: ${gw?.name}`
    ])
  } catch { /* audit might not exist */ }

  return NextResponse.json({ deleted: result.affectedRows > 0 })
}

function redactToken(gw: GatewayEntry): GatewayEntry & { token_set: boolean } {
  return { ...gw, token: gw.token ? '--------' : '', token_set: !!gw.token }
}

function redactTokens(gws: GatewayEntry[]) {
  return gws.map(redactToken)
}
