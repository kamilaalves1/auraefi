import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { parseJsonlTranscript } from '@/lib/transcript-parser'

/**
 * GET /api/sessions/transcript/gateway?key=<session-key>&limit=50
 *
 * Reads the JSONL transcript file for a gateway session directly from disk.
 * Session transcripts are stored at:
 *   {GATEWAY_STATE_DIR}/agents/{agent}/sessions/{sessionId}.jsonl
 *
 * The session key (e.g. "agent:jarv:cron:task-name") is used to look up
 * the sessionId from the agent's sessions.json, then the JSONL file is read.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const sessionKey = searchParams.get('key') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)

  if (!sessionKey) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  return NextResponse.json({ messages: [], source: 'gateway', error: 'State directory not configured' })
}

function extractAgentName(sessionKey: string): string | null {
  const parts = sessionKey.split(':')
  if (parts.length >= 2 && parts[0] === 'agent') {
    return parts[1]
  }
  return null
}

export const dynamic = 'force-dynamic'
