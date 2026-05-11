import { NextRequest } from 'next/server'

// Health endpoint is intentionally public — no auth required

/**
 * GET /api/amy/health — Unified health check for Vertex Control Center
 *
 * Aggregates:
 * - Bridge health (:3100/api/health)
 * - Ollama status (:11434/api/tags)
 * - Bridge activity stats
 * - Bridge task stats
 * - Bridge approval stats
 *
 * Returns a unified status object for the health page and external monitoring.
 */

const BRIDGE_URL = 'http://127.0.0.1:3100'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'

type ServiceStatus = {
  name: string
  status: 'healthy' | 'degraded' | 'offline'
  latencyMs: number
  detail?: string
  score?: number
}

async function checkService(name: string, url: string): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const latencyMs = Date.now() - start
    if (res.ok) {
      return { name, status: 'healthy', latencyMs }
    }
    return { name, status: 'degraded', latencyMs, detail: `HTTP ${res.status}` }
  } catch {
    return { name, status: 'offline', latencyMs: Date.now() - start, detail: 'Connection refused' }
  }
}

export async function GET(request: NextRequest) {
  const results = await Promise.all([
    // Bridge health
    (async () => {
      const base = await checkService('Amy API Bridge', `${BRIDGE_URL}/api/health`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${BRIDGE_URL}/api/health`)
          const data = await res.json()
          base.detail = `Components: ${Object.keys(data.components || {}).length}`
          base.score = Object.values(data.components || {}).reduce(
            (sum: number, c: any) => sum + (c.score || 0), 0
          ) / Math.max(Object.keys(data.components || {}).length, 1)

          // Get individual component scores
          const components = Object.entries(data.components || {}).map(([name, c]: [string, any]) => ({
            name,
            score: c.score || 0,
            status: c.status || 'unknown',
            detail: c.detail || '',
          }))
          ;(base as any).components = components
        } catch { /* keep base status */ }
      }
      return base
    })(),

    // Ollama
    (async () => {
      const base = await checkService('Ollama (LLM)', `${OLLAMA_URL}/api/tags`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${OLLAMA_URL}/api/tags`)
          const data = await res.json()
          const models = data.models?.map((m: any) => m.name) || []
          base.detail = `Models: ${models.join(', ') || 'none'}`
        } catch { /* keep base status */ }
      }
      return base
    })(),

    // Activity
    (async () => {
      const base = await checkService('Activity Log', `${BRIDGE_URL}/api/activity?limit=1`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${BRIDGE_URL}/api/activity?limit=1`)
          const data = await res.json()
          base.detail = `${data.count} events`
        } catch {}
      }
      return base
    })(),

    // Tasks
    (async () => {
      const base = await checkService('Task Queue', `${BRIDGE_URL}/api/tasks`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${BRIDGE_URL}/api/tasks`)
          const data = await res.json()
          base.detail = `${data.active_count} active, ${(data.recent || []).length} recent`
        } catch {}
      }
      return base
    })(),

    // Approvals
    (async () => {
      const base = await checkService('Approval Gate', `${BRIDGE_URL}/api/approvals`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${BRIDGE_URL}/api/approvals`)
          const data = await res.json()
          base.detail = `${data.count} pending`
        } catch {}
      }
      return base
    })(),

    // Notifications
    (async () => {
      const base = await checkService('Notifications', `${BRIDGE_URL}/api/notifications?limit=1`)
      if (base.status === 'healthy') {
        try {
          const res = await fetch(`${BRIDGE_URL}/api/notifications?limit=1`)
          const data = await res.json()
          base.detail = `${data.stats?.total || 0} total, ${data.stats?.today || 0} today`
        } catch {}
      }
      return base
    })(),
  ])

  const healthyCount = results.filter(r => r.status === 'healthy').length
  const totalCount = results.length
  const overallScore = Math.round((healthyCount / totalCount) * 100)
  const overallStatus = healthyCount === totalCount ? 'healthy'
    : healthyCount > totalCount / 2 ? 'degraded' : 'critical'

  return Response.json({
    status: overallStatus,
    score: overallScore,
    services: results,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: 'vertex-control-center@1.0.0',
  })
}
