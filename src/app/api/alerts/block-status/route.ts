import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * GET /api/alerts/block-status
 * Returns whether any active "block" cost alert is currently triggered.
 * Used by task dispatch to reject new LLM requests when cost limit is exceeded.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const now = Math.floor(Date.now() / 1000)

  try {
    // A block is active when: action_type='block', entity_type='token_cost', enabled=1,
    // and last_triggered_at is within the cooldown window (rule was triggered recently)
    const blockRules = db.prepare(`
      SELECT id, name, cooldown_minutes, last_triggered_at
      FROM alert_rules
      WHERE workspace_id = ? AND enabled = 1 AND action_type = 'block' AND entity_type = 'token_cost'
    `).all(workspaceId) as { id: number; name: string; cooldown_minutes: number; last_triggered_at: number | null }[]

    const activeBlock = blockRules.find(r =>
      r.last_triggered_at != null &&
      (now - r.last_triggered_at) < r.cooldown_minutes * 60
    )

    return NextResponse.json({
      blocked: !!activeBlock,
      rule: activeBlock ? { id: activeBlock.id, name: activeBlock.name } : null,
    })
  } catch {
    return NextResponse.json({ blocked: false, rule: null })
  }
}
