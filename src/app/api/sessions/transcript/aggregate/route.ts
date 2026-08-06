import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getAllGatewaySessions } from '@/lib/sessions'
import { parseJsonlTranscript, readSessionJsonl, type TranscriptMessage, type MessageContentPart } from '@/lib/transcript-parser'

export interface AggregateEvent {
  id: string
  ts: number
  sessionKey: string
  agentName: string
  role: string
  type: string
  content: string
  metadata?: Record<string, any>
}

/**
 * GET /api/sessions/transcript/aggregate?limit=100&since=<unix-ms>
 *
 * Fan out to all active session JSONL files on disk, parse, merge into
 * a single chronological event stream for the agent-feed panel.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 500)
  const since = parseInt(searchParams.get('since') || '0', 10) || 0

  return NextResponse.json({ events: [], sessionCount: 0 })
}

function partToEvent(
  part: MessageContentPart,
  role: string,
  ts: number,
  sessionKey: string,
  agentName: string,
  lineIndex: number,
): AggregateEvent {
  const id = `tx-${sessionKey}-${lineIndex}`

  switch (part.type) {
    case 'text':
      return { id, ts, sessionKey, agentName, role, type: 'text', content: part.text.slice(0, 500) }
    case 'thinking':
      return { id, ts, sessionKey, agentName, role, type: 'thinking', content: part.thinking.slice(0, 300) }
    case 'tool_use':
      return { id, ts, sessionKey, agentName, role, type: 'tool_use', content: part.name, metadata: { toolId: part.id, input: part.input } }
    case 'tool_result':
      return { id, ts, sessionKey, agentName, role, type: 'tool_result', content: part.content.slice(0, 500), metadata: { toolUseId: part.toolUseId, isError: part.isError } }
  }
}

export const dynamic = 'force-dynamic'
