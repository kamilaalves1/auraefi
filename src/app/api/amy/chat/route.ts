import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * POST /api/amy/chat — Direct chat with Amy via Ollama
 * 
 * Body: { message: string, conversation_id?: string, model?: string }
 * Returns: { reply: string, model: string, conversation_id: string }
 * 
 * This is the Vertex-specific chat endpoint that bypasses the OpenClaw
 * gateway and talks directly to Ollama on the local machine.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const DEFAULT_MODEL = process.env.AMY_MODEL || 'llama3.1:8b'

const SYSTEM_PROMPT = `You are Amy, an AI operations assistant for Silver Snow Vertex.
You help with task management, document analysis, and operational decisions.
You are professional, concise, and provide actionable insights.
When asked about tasks, you can reference the knowledge base and provide structured recommendations.
Always respond in the same language the user writes in.`

// In-memory conversation history (for streaming context)
// In production, this would be persisted to SQLite
const conversationHistory = new Map<string, Array<{ role: string; content: string }>>()

function getHistory(conversationId: string): Array<{ role: string; content: string }> {
  if (!conversationHistory.has(conversationId)) {
    conversationHistory.set(conversationId, [])
  }
  return conversationHistory.get(conversationId)!
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { message, conversation_id, model } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const convId = conversation_id || `amy_${Date.now()}`
    const selectedModel = model || DEFAULT_MODEL

    // Build conversation
    const history = getHistory(convId)
    history.push({ role: 'user', content: message })

    // Keep conversation context manageable (last 20 messages)
    const contextMessages = history.slice(-20)

    // Try to augment with knowledge from the bridge
    let knowledgeContext = ''
    try {
      const searchRes = await fetch(`http://127.0.0.1:3100/api/vault/search?q=${encodeURIComponent(message)}`)
      if (searchRes.ok) {
        const searchData = await searchRes.json()
        if (searchData.results?.length > 0) {
          const topRefs = searchData.results.slice(0, 3)
          knowledgeContext = '\n\n[Knowledge Base Context]\n' + 
            topRefs.map((r: any) => `- ${r.title} (${r.domain}): ${r.snippet}`).join('\n')
        }
      }
    } catch {
      // Bridge might be down, proceed without knowledge
    }

    const systemContent = SYSTEM_PROMPT + knowledgeContext

    // Call Ollama
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemContent },
          ...contextMessages,
        ],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 2048,
        },
      }),
    })

    if (!ollamaRes.ok) {
      const errorText = await ollamaRes.text()
      logger.error({ status: ollamaRes.status, error: errorText }, 'Ollama chat error')
      return NextResponse.json({ error: `Ollama error: ${ollamaRes.status}` }, { status: 502 })
    }

    const ollamaData = await ollamaRes.json()
    const reply = ollamaData.message?.content || ollamaData.response || ''

    // Save to history
    history.push({ role: 'assistant', content: reply })

    // Also save the exchange to the database
    try {
      const db = getDatabase()
      const workspaceId = auth.user.workspace_id ?? 1

      // Ensure conversation exists
      db.prepare(`
        INSERT OR IGNORE INTO conversations (id, title, workspace_id, created_at) 
        VALUES (?, ?, ?, ?)
      `).run(convId, `Amy Chat`, workspaceId, Math.floor(Date.now() / 1000))

      // Save user message
      db.prepare(`
        INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, workspace_id, created_at)
        VALUES (?, 'human', 'amy', ?, 'text', ?, ?)
      `).run(convId, message, workspaceId, Math.floor(Date.now() / 1000))

      // Save assistant reply
      db.prepare(`
        INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, workspace_id, created_at)
        VALUES (?, 'amy', 'human', ?, 'text', ?, ?)
      `).run(convId, reply, workspaceId, Math.floor(Date.now() / 1000))
    } catch (dbErr) {
      logger.warn({ err: dbErr }, 'Could not persist Amy chat to database')
    }

    return NextResponse.json({
      reply,
      model: selectedModel,
      conversation_id: convId,
      knowledge_refs: knowledgeContext ? true : false,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/amy/chat error')
    return NextResponse.json({ error: 'Chat request failed' }, { status: 500 })
  }
}

/**
 * GET /api/amy/chat — Get Amy's status and available models
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    // Check Ollama status
    const models: string[] = []
    let ollamaOnline = false
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`)
      if (res.ok) {
        ollamaOnline = true
        const data = await res.json()
        if (data.models) {
          for (const m of data.models) {
            models.push(m.name)
          }
        }
      }
    } catch { /* offline */ }

    // Check bridge
    let bridgeOnline = false
    try {
      const res = await fetch('http://127.0.0.1:3100/api/health')
      bridgeOnline = res.ok
    } catch { /* offline */ }

    return NextResponse.json({
      status: ollamaOnline ? 'ready' : 'offline',
      model: DEFAULT_MODEL,
      models,
      ollama: ollamaOnline,
      bridge: bridgeOnline,
      features: {
        knowledge_search: bridgeOnline,
        conversation_history: true,
        multi_model: models.length > 1,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: 'Status check failed' }, { status: 500 })
  }
}
