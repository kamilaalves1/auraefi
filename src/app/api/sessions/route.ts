import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { syncClaudeSessions } from '@/lib/claude-sessions'
import { db_helpers, dbGetAll } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const LOCAL_SESSION_ACTIVE_WINDOW_MS = 90 * 60 * 1000

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const gatewaySessions = getAllGatewaySessions()
    const mappedGatewaySessions = mapGatewaySessions(gatewaySessions)

    // Always include local sessions alongside gateway sessions
    await syncClaudeSessions()
    const claudeSessions = await getLocalClaudeSessions()
    const localMerged = mergeLocalSessions(claudeSessions)

    if (mappedGatewaySessions.length === 0 && localMerged.length === 0) {
      return NextResponse.json({ sessions: [] })
    }

    const merged = dedupeAndSortSessions([...mappedGatewaySessions, ...localMerged])
    return NextResponse.json({ sessions: merged })
  } catch (error) {
    logger.error({ err: error }, 'Sessions API error')
    return NextResponse.json({ sessions: [] })
  }
}

const VALID_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const VALID_VERBOSE_LEVELS = ['off', 'on', 'full'] as const
const VALID_REASONING_LEVELS = ['off', 'on', 'stream'] as const
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    let logDetail: string

    switch (action) {
      case 'set-thinking': {
        const { level } = body
        if (!VALID_THINKING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid thinking level. Must be: ${VALID_THINKING_LEVELS.join(', ')}` }, { status: 400 })
        }
        logDetail = `Set thinking=${level} on ${sessionKey}`
        break
      }
      case 'set-verbose': {
        const { level } = body
        if (!VALID_VERBOSE_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid verbose level. Must be: ${VALID_VERBOSE_LEVELS.join(', ')}` }, { status: 400 })
        }
        logDetail = `Set verbose=${level} on ${sessionKey}`
        break
      }
      case 'set-reasoning': {
        const { level } = body
        if (!VALID_REASONING_LEVELS.includes(level)) {
          return NextResponse.json({ error: `Invalid reasoning level. Must be: ${VALID_REASONING_LEVELS.join(', ')}` }, { status: 400 })
        }
        logDetail = `Set reasoning=${level} on ${sessionKey}`
        break
      }
      case 'set-label': {
        const { label } = body
        if (typeof label !== 'string' || label.length > 100) {
          return NextResponse.json({ error: 'Label must be a string up to 100 characters' }, { status: 400 })
        }
        logDetail = `Set label="${label}" on ${sessionKey}`
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Must be: set-thinking, set-verbose, set-reasoning, set-label' }, { status: 400 })
    }

    await db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      logDetail,
      { session_key: sessionKey, action }
    ).catch(() => {})

    return NextResponse.json({ success: true, action, sessionKey, result: null })
  } catch (error: any) {
    logger.error({ err: error }, 'Session POST error')
    return NextResponse.json({ error: error.message || 'Session action failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { sessionKey } = body

    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid session key' }, { status: 400 })
    }

    await db_helpers.logActivity(
      'session_control',
      'session',
      0,
      auth.user.username,
      `Deleted session ${sessionKey}`,
      { session_key: sessionKey, action: 'delete' }
    ).catch(() => {})

    return NextResponse.json({ success: true, sessionKey, result: null })
  } catch (error: any) {
    logger.error({ err: error }, 'Session DELETE error')
    return NextResponse.json({ error: error.message || 'Session deletion failed' }, { status: 500 })
  }
}

function mapGatewaySessions(gatewaySessions: ReturnType<typeof getAllGatewaySessions>) {
  // Deduplicate by sessionId — cron runs may share the same
  // session ID as the parent session, causing duplicate React keys (#80).
  // Keep the most recently updated entry when duplicates exist.
  const sessionMap = new Map<string, (typeof gatewaySessions)[0]>()
  for (const s of gatewaySessions) {
    const id = s.sessionId || `${s.agent}:${s.key}`
    const existing = sessionMap.get(id)
    if (!existing || s.updatedAt > existing.updatedAt) {
      sessionMap.set(id, s)
    }
  }

  return Array.from(sessionMap.values()).map((s) => {
    const total = s.totalTokens || 0
    const context = s.contextTokens || 35000
    const pct = context > 0 ? Math.round((total / context) * 100) : 0
    return {
      id: s.sessionId || `${s.agent}:${s.key}`,
      key: s.key,
      agent: s.agent,
      kind: s.chatType || 'unknown',
      age: formatAge(s.updatedAt),
      model: s.model,
      tokens: `${formatTokens(total)}/${formatTokens(context)} (${pct}%)`,
      channel: s.channel,
      flags: [],
      active: s.active,
      startTime: s.updatedAt,
      lastActivity: s.updatedAt,
      source: 'gateway' as const,
    }
  })
}

/** Read Claude Code sessions from the local database */
async function getLocalClaudeSessions() {
  try {
    const rows = await dbGetAll<Record<string, any>>(
      'SELECT * FROM claude_sessions ORDER BY last_message_at DESC LIMIT 50',
      []
    )

    return rows.map((s) => {
      const total = (s.input_tokens || 0) + (s.output_tokens || 0)
      const lastMsg = s.last_message_at ? new Date(s.last_message_at).getTime() : 0
      // Trust scanner state first, but fall back to derived recency so UI doesn't
      // show stale "xh ago" when the active flag lags behind disk updates.
      const derivedActive = lastMsg > 0 && (Date.now() - lastMsg) < LOCAL_SESSION_ACTIVE_WINDOW_MS
      const isActive = s.is_active === 1 || derivedActive
      const effectiveLastActivity = isActive ? Date.now() : lastMsg
      return {
        id: s.session_id,
        key: s.project_slug || s.session_id,
        agent: s.project_slug || 'local',
        kind: 'claude-code',
        age: isActive ? 'now' : formatAge(lastMsg),
        model: s.model || 'unknown',
        tokens: `${formatTokens(s.input_tokens || 0)}/${formatTokens(s.output_tokens || 0)}`,
        channel: 'local',
        flags: s.git_branch ? [s.git_branch] : [],
        active: isActive,
        startTime: s.first_message_at ? new Date(s.first_message_at).getTime() : 0,
        lastActivity: effectiveLastActivity,
        source: 'local' as const,
        userMessages: s.user_messages || 0,
        assistantMessages: s.assistant_messages || 0,
        toolUses: s.tool_uses || 0,
        estimatedCost: s.estimated_cost || 0,
        lastUserPrompt: s.last_user_prompt || null,
        workingDir: s.project_path || null,
      }
    })
  } catch (err) {
    logger.warn({ err }, 'Failed to read local Claude sessions')
    return []
  }
}

function mergeLocalSessions(
  claudeSessions: Array<Record<string, any>>,
) {
  return dedupeAndSortSessions(claudeSessions)
}

function dedupeAndSortSessions(merged: Array<Record<string, any>>) {
  const deduped = new Map<string, Record<string, any>>()

  for (const session of merged) {
    const id = String(session?.id || '')
    const source = String(session?.source || '')
    const key = `${source}:${id}`
    if (!id) continue
    const existing = deduped.get(key)
    const currentActivity = Number(session?.lastActivity || 0)
    const existingActivity = Number(existing?.lastActivity || 0)
    if (!existing || currentActivity > existingActivity) deduped.set(key, session)
  }

  return Array.from(deduped.values())
    .sort((a, b) => Number(b?.lastActivity || 0) - Number(a?.lastActivity || 0))
    .slice(0, 100)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatAge(timestamp: number): string {
  if (!timestamp) return '-'
  const diff = Date.now() - timestamp
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

export const dynamic = 'force-dynamic'
