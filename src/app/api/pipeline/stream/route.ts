import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { eventBus, type ServerEvent } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

/**
 * GET /api/pipeline/stream?run_id=<id>
 *
 * SSE stream de eventos em tempo real de um pipeline run.
 * Emite:
 *   pipeline.stage_started   — etapa iniciou (agente, stage)
 *   pipeline.agent_output    — agente produziu output (preview, tokens, model)
 *   pipeline.run_completed   — esteira concluída
 *   pipeline.awaiting_approval — aguardando aprovação humana
 *   pipeline.loop_detected   — loop semântico detectado
 *   pipeline.sandbox_failed  — testes falharam no sandbox
 *   pipeline.ci_failed       — CI falhou
 *   pipeline.ci_passed       — CI passou
 *
 * Parâmetros:
 *   run_id  — filtra eventos para um run específico (opcional; sem filtro = todos os runs do workspace)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { searchParams } = new URL(request.url)
  const runIdFilter = searchParams.get('run_id') ? Number(searchParams.get('run_id')) : null
  const workspaceId = auth.user.workspace_id ?? 1

  const PIPELINE_EVENTS = new Set([
    'pipeline.stage_started',
    'pipeline.agent_output',
    'pipeline.run_completed',
    'pipeline.awaiting_approval',
    'pipeline.loop_detected',
    'pipeline.sandbox_failed',
    'pipeline.ci_failed',
    'pipeline.ci_passed',
    'pipeline.agent_completed',
    'pipeline.card_failed',
    'pipeline.card_done',
    'pipeline.ci_fix_attempt',
    'pipeline.pr_review_rejected',
  ])

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: ServerEvent) => {
        if (!PIPELINE_EVENTS.has(event.type)) return

        // Filtra por workspace
        const evWorkspace = event.data?.workspace_id
        if (typeof evWorkspace === 'number' && evWorkspace !== workspaceId) return

        // Filtra por run_id se especificado
        if (runIdFilter !== null && event.data?.run_id !== runIdFilter) return

        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          )
        } catch {
          // Client disconnected
        }
      }

      eventBus.on('server-event', send)

      // Envia evento de conexão confirmada
      try {
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ run_id: runIdFilter, workspace_id: workspaceId, ts: Date.now() })}\n\n`)
        )
      } catch { /* ignore */ }

      // Heartbeat a cada 20s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          clearInterval(heartbeat)
        }
      }, 20_000)

      request.signal.addEventListener('abort', () => {
        eventBus.off('server-event', send)
        clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
        logger.debug({ run_id: runIdFilter }, 'pipeline/stream: client disconnected')
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  })
}
