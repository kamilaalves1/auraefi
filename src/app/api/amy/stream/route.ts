import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * POST /api/amy/stream — Streaming chat with Amy via Ollama
 * 
 * Body: { message: string, conversation_id?: string, model?: string }
 * Returns: Server-Sent Events stream with token-by-token response
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const DEFAULT_MODEL = process.env.AMY_MODEL || 'llama3.1:8b'

const SYSTEM_PROMPT = `You are Amy, an AI operations assistant for Silver Snow Vertex.
You help with task management, document analysis, and operational decisions.
You are professional, concise, and provide actionable insights.
When asked about tasks, you can reference the knowledge base and provide structured recommendations.
Always respond in the same language the user writes in.`

// Shared conversation history with the non-streaming endpoint
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
    return new Response(JSON.stringify({ error: auth.error }), { 
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { message, conversation_id, model } = body

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'message is required' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const convId = conversation_id || `amy_${Date.now()}`
    const selectedModel = model || DEFAULT_MODEL

    // Build conversation context
    const history = getHistory(convId)
    history.push({ role: 'user', content: message })
    const contextMessages = history.slice(-20)

    // Try RAG knowledge augmentation
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
    } catch { /* bridge down */ }

    const systemContent = SYSTEM_PROMPT + knowledgeContext

    // Call Ollama with streaming
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemContent },
          ...contextMessages,
        ],
        stream: true,
        options: {
          temperature: 0.7,
          num_predict: 2048,
        },
      }),
    })

    if (!ollamaRes.ok || !ollamaRes.body) {
      return new Response(JSON.stringify({ error: `Ollama error: ${ollamaRes.status}` }), { 
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Transform Ollama NDJSON stream → SSE stream
    const reader = ollamaRes.body.getReader()
    const decoder = new TextDecoder()
    let fullReply = ''

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        // Send initial event
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', model: selectedModel, conversation_id: convId })}\n\n`))

        try {
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.trim()) continue
              try {
                const chunk = JSON.parse(line)
                if (chunk.message?.content) {
                  fullReply += chunk.message.content
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: chunk.message.content })}\n\n`))
                }
                if (chunk.done) {
                  // Save to history
                  history.push({ role: 'assistant', content: fullReply })
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', full_reply: fullReply })}\n\n`))
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const chunk = JSON.parse(buffer)
              if (chunk.message?.content) {
                fullReply += chunk.message.content
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: chunk.message.content })}\n\n`))
              }
            } catch { /* skip */ }
          }

          // Ensure done event
          if (!fullReply.includes('[DONE]')) {
            history.push({ role: 'assistant', content: fullReply })
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', full_reply: fullReply })}\n\n`))
          }
        } catch (err) {
          logger.error({ err }, 'Streaming error')
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Stream interrupted' })}\n\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/amy/stream error')
    return new Response(JSON.stringify({ error: 'Stream request failed' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
