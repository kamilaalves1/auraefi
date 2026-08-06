import { db_helpers } from './db'
import { dbGet, dbGetAll, dbRun } from './db-pool'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { config } from './config'

interface DispatchableTask {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string
  workspace_id: number
  agent_name: string
  agent_id: number
  agent_config: string | null
  ticket_prefix: string | null
  project_ticket_no: number | null
  project_id: number | null
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Model routing
// ---------------------------------------------------------------------------

/**
 * Classify a task's complexity and return the appropriate model ID.
 * Uses keyword signals on title + description.
 *
 * Tiers:
 *   ROUTINE  → cheap model (Haiku)   — file ops, status checks, formatting
 *   MODERATE → mid model  (Sonnet)   — code gen, summaries, analysis, drafts
 *   COMPLEX  → premium model (Opus)  — debugging, architecture, novel problems
 *
 * The caller may override this by setting agent.config.dispatchModel.
 */
function classifyTaskModel(task: DispatchableTask): string | null {
  // Allow per-agent config override
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) return cfg.dispatchModel
    } catch { /* ignore */ }
  }

  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  const priority = task.priority?.toLowerCase() ?? ''

  // Complex signals → Opus
  const complexSignals = [
    'debug', 'diagnos', 'architect', 'design system', 'security audit',
    'root cause', 'investigate', 'incident', 'failure', 'broken', 'not working',
    'refactor', 'migration', 'performance optim', 'why is',
  ]
  if (priority === 'critical' || complexSignals.some(s => text.includes(s))) {
    return 'claude-opus-4-8'
  }

  // Routine signals → Haiku
  const routineSignals = [
    'status check', 'health check', 'ping', 'list ', 'fetch ', 'format',
    'rename', 'move file', 'read file', 'update readme', 'bump version',
    'send message', 'post to', 'notify', 'summarize', 'translate',
    'quick ', 'simple ', 'routine ', 'minor ',
  ]
  if (priority === 'low' && routineSignals.some(s => text.includes(s))) {
    return 'claude-haiku-4-5-20251001'
  }
  if (routineSignals.some(s => text.includes(s)) && priority !== 'high' && priority !== 'critical') {
    return 'claude-haiku-4-5-20251001'
  }

  // Default: let the agent's own configured model handle it (no override)
  return null
}

/** Extract the agent identifier from the agent's config JSON.
 *  Falls back to agent_name (display name) if agent id is not set. */
function resolveGatewayAgentId(task: DispatchableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.agentId === 'string' && cfg.agentId) return cfg.agentId
    } catch { /* ignore */ }
  }
  return task.agent_name
}

function buildTaskPrompt(task: DispatchableTask, rejectionFeedback?: string | null): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You have been assigned a task in Vertex Control Center.',
    '',
    `**[${ticket}] ${task.title}**`,
    `Priority: ${task.priority}`,
  ]

  if (task.tags && task.tags.length > 0) {
    lines.push(`Tags: ${task.tags.join(', ')}`)
  }

  if (task.description) {
    lines.push('', task.description)
  }

  if (rejectionFeedback) {
    lines.push('', '## Previous Review Feedback', rejectionFeedback, '', 'Please address this feedback in your response.')
  }

  lines.push('', 'Complete this task and provide your response. Be concise and actionable.')
  return lines.join('\n')
}


interface AgentResponseParsed {
  text: string | null
  sessionId: string | null
}

function parseAgentResponse(stdout: string): AgentResponseParsed {
  try {
    const parsed = JSON.parse(stdout)
    const sessionId: string | null = typeof parsed?.sessionId === 'string' ? parsed.sessionId
      : typeof parsed?.session_id === 'string' ? parsed.session_id
      : null

    // Agent --json returns { payloads: [{ text: "..." }] }
    if (parsed?.payloads?.[0]?.text) {
      return { text: parsed.payloads[0].text, sessionId }
    }
    // Fallback: if there's a result or output field
    if (parsed?.result) return { text: String(parsed.result), sessionId }
    if (parsed?.output) return { text: String(parsed.output), sessionId }
    // Last resort: stringify the whole response
    return { text: JSON.stringify(parsed, null, 2), sessionId }
  } catch {
    // Not valid JSON — return raw stdout if non-empty
    return { text: stdout.trim() || null, sessionId: null }
  }
}

// ---------------------------------------------------------------------------
// Pipeline config reader
// ---------------------------------------------------------------------------

interface PipelineConfig {
  llm_simple?: string
  llm_medium?: string
  llm_complex?: string
  llm_fallback_mode?: 'none' | 'fixed' | 'cascade'
  llm_fallback_model?: string
  llm_fallback_max_attempts?: string
  [key: string]: string | undefined
}

async function getPipelineConfig(workspaceId: number): Promise<PipelineConfig> {
  try {
    const row = await dbGet('SELECT config FROM work_pipelines WHERE workspace_id = ? ORDER BY id ASC LIMIT 1', [workspaceId]) as { config: string | null } | undefined
    if (!row?.config) return {}
    const parsed = JSON.parse(row.config)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

// ---------------------------------------------------------------------------
// Provider-agnostic model dispatch
// ---------------------------------------------------------------------------
// Model values follow the format "provider:model-id" (e.g. "anthropic:claude-sonnet-4-6").
// Provider prefix is stripped before sending to the respective API.

interface ProviderCallResult {
  text: string | null
  sessionId: string | null
  model: string
  provider: string
}

async function dispatchToModel(
  providerModel: string,
  prompt: string,
  systemPrompt: string | null,
  taskId: number,
  workspaceId: number,
): Promise<ProviderCallResult> {
  const [rawProvider, ...modelParts] = providerModel.includes(':')
    ? providerModel.split(':')
    : ['anthropic', providerModel]
  const provider = rawProvider.toLowerCase()
  const modelId = modelParts.join(':') || rawProvider

  switch (provider) {
    case 'anthropic':
      return dispatchToAnthropic(modelId, prompt, systemPrompt, taskId, workspaceId)

    case 'openai':
      return dispatchOpenAICompat(
        'https://api.openai.com/v1/chat/completions',
        process.env.OPENAI_API_KEY || '',
        modelId, prompt, systemPrompt, provider,
        taskId, workspaceId,
      )

    case 'groq':
      return dispatchOpenAICompat(
        'https://api.groq.com/openai/v1/chat/completions',
        process.env.GROQ_API_KEY || '',
        modelId, prompt, systemPrompt, provider,
        taskId, workspaceId,
      )

    case 'openrouter':
      return dispatchOpenAICompat(
        'https://openrouter.ai/api/v1/chat/completions',
        process.env.OPENROUTER_API_KEY || '',
        modelId, prompt, systemPrompt, provider,
        taskId, workspaceId,
      )

    case 'deepseek':
      return dispatchOpenAICompat(
        'https://api.deepseek.com/chat/completions',
        process.env.DEEPSEEK_API_KEY || '',
        modelId, prompt, systemPrompt, provider,
        taskId, workspaceId,
      )

    case 'gemini':
      return dispatchToGemini(modelId, prompt, systemPrompt, provider, taskId, workspaceId)

    default:
      // Unknown provider — try Anthropic as last resort with the raw model string
      return dispatchToAnthropic(providerModel, prompt, systemPrompt, taskId, workspaceId)
  }
}

async function dispatchToAnthropic(
  model: string,
  prompt: string,
  systemPrompt: string | null,
  taskId: number,
  workspaceId: number,
): Promise<ProviderCallResult> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  }
  if (systemPrompt) body.system = systemPrompt

  logger.info({ taskId, model, provider: 'anthropic' }, 'Dispatching via Anthropic API')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${errBody.substring(0, 300)}`)
  }
  const data = await res.json() as { content: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
  const text = data.content?.filter(b => b.type === 'text').map(b => b.text || '').join('\n') || null
  recordTokenUsage(model, taskId, workspaceId, data.usage)
  return { text, sessionId: null, model, provider: 'anthropic' }
}

async function dispatchOpenAICompat(
  endpoint: string,
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt: string | null,
  provider: string,
  taskId: number,
  workspaceId: number,
): Promise<ProviderCallResult> {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) throw new Error(`${provider} API key not configured`)

  const messages: Array<{ role: string; content: string }> = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  logger.info({ taskId, model, provider }, `Dispatching via ${provider} API`)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${trimmedKey}` },
    body: JSON.stringify({ model, max_tokens: 4096, messages }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`${provider} API ${res.status}: ${errBody.substring(0, 300)}`)
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const text = data.choices?.[0]?.message?.content || null
  const usage = data.usage ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens } : undefined
  recordTokenUsage(`${provider}:${model}`, taskId, workspaceId, usage)
  return { text, sessionId: null, model, provider }
}

async function dispatchToGemini(
  model: string,
  prompt: string,
  systemPrompt: string | null,
  provider: string,
  taskId: number,
  workspaceId: number,
): Promise<ProviderCallResult> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  logger.info({ taskId, model, provider }, 'Dispatching via Gemini API')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Gemini API ${res.status}: ${errBody.substring(0, 300)}`)
  }
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || null
  return { text, sessionId: null, model, provider }
}

async function recordTokenUsage(
  model: string,
  taskId: number,
  workspaceId: number,
  usage?: { input_tokens?: number; output_tokens?: number },
): Promise<void> {
  if (!usage) return
  try {
    const now = Math.floor(Date.now() / 1000)
    await dbRun(`
      INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, total_tokens, cost, created_at, workspace_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `, [model, `task-${taskId}`,
      usage.input_tokens || 0, usage.output_tokens || 0,
      (usage.input_tokens || 0) + (usage.output_tokens || 0),
      now, workspaceId,
    ])
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Fallback cascade engine
// ---------------------------------------------------------------------------

async function callWithFallback(
  task: DispatchableTask,
  prompt: string,
  primaryModel: string,
): Promise<AgentResponseParsed> {
  const cfg = await getPipelineConfig(task.workspace_id)
  const mode = cfg.llm_fallback_mode ?? 'none'
  const maxAttempts = Math.max(1, parseInt(cfg.llm_fallback_max_attempts ?? '2', 10))
  const soul = await getAgentSoulContent(task)

  // Build ordered list of models to try
  const candidates: string[] = [primaryModel]

  if (mode === 'fixed' && cfg.llm_fallback_model && cfg.llm_fallback_model !== primaryModel) {
    candidates.push(cfg.llm_fallback_model)
  } else if (mode === 'cascade') {
    // Add pipeline-configured models (exclude primary, dedupe)
    for (const m of [cfg.llm_complex, cfg.llm_medium, cfg.llm_simple]) {
      if (m && m !== primaryModel && !candidates.includes(m)) candidates.push(m)
    }
    // Add fixed fallback model too if set
    if (cfg.llm_fallback_model && !candidates.includes(cfg.llm_fallback_model)) {
      candidates.push(cfg.llm_fallback_model)
    }
  }

  const limit = Math.min(candidates.length, maxAttempts)
  const errors: string[] = []

  for (let i = 0; i < limit; i++) {
    const model = candidates[i]
    const attempt = i + 1
    try {
      if (i > 0) {
        logger.warn({ taskId: task.id, model, attempt, mode }, `Fallback attempt ${attempt}/${limit}`)
      }
      const result = await dispatchToModel(model, prompt, soul, task.id, task.workspace_id)
      if (result.text) {
        if (i > 0) {
          logger.info({ taskId: task.id, model, attempt }, 'Fallback succeeded')
        }
        return { text: result.text, sessionId: result.sessionId }
      }
      errors.push(`${model}: empty response`)
    } catch (err: any) {
      const msg = err.message || String(err)
      logger.warn({ taskId: task.id, model, attempt, err: msg }, `Model attempt ${attempt} failed`)
      errors.push(`${model}: ${msg.substring(0, 120)}`)
    }
  }

  throw new Error(`All ${limit} model attempt(s) failed:\n${errors.join('\n')}`)
}

// ---------------------------------------------------------------------------
// Direct Claude API dispatch (gateway-free)
// ---------------------------------------------------------------------------

function getAnthropicApiKey(): string | null {
  return (process.env.ANTHROPIC_API_KEY || '').trim() || null
}

async function isGatewayAvailable(): Promise<boolean> {
  try {
    const row = await dbGet('SELECT COUNT(*) as c FROM gateways', []) as { c: number } | undefined
    return (row?.c ?? 0) > 0
  } catch {
    return false
  }
}

async function classifyDirectModel(task: DispatchableTask, pipelineCfg?: PipelineConfig): Promise<string> {
  // 1. Per-agent config override
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.dispatchModel === 'string' && cfg.dispatchModel) {
        return cfg.dispatchModel.replace(/^.*\//, '')
      }
    } catch { /* ignore */ }
  }

  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  const priority = task.priority?.toLowerCase() ?? ''

  // 2. Classify complexity tier
  const complexSignals = [
    'debug', 'diagnos', 'architect', 'design system', 'security audit',
    'root cause', 'investigate', 'incident', 'refactor', 'migration',
  ]
  const routineSignals = [
    'status check', 'health check', 'format', 'rename', 'summarize',
    'translate', 'quick ', 'simple ', 'routine ', 'minor ',
  ]

  let tier: 'complex' | 'medium' | 'simple'
  if (priority === 'critical' || complexSignals.some(s => text.includes(s))) {
    tier = 'complex'
  } else if (routineSignals.some(s => text.includes(s)) && priority !== 'high' && priority !== 'critical') {
    tier = 'simple'
  } else {
    tier = 'medium'
  }

  // 3. Pipeline config takes priority over hardcoded models
  const cfg = pipelineCfg ?? await getPipelineConfig(task.workspace_id)
  const cfgModel = tier === 'complex' ? cfg.llm_complex : tier === 'simple' ? cfg.llm_simple : cfg.llm_medium
  if (cfgModel) return cfgModel

  // 4. Hardcoded fallbacks (bare Anthropic model IDs)
  if (tier === 'complex') return 'claude-opus-4-6'
  if (tier === 'simple')  return 'claude-haiku-4-5-20251001'
  return 'claude-sonnet-4-6'
}

async function getAgentSoulContent(task: DispatchableTask): Promise<string | null> {
  try {
    const row = await dbGet('SELECT soul_content FROM agents WHERE id = ? AND workspace_id = ?', [task.agent_id, task.workspace_id]) as { soul_content: string | null } | undefined
    return row?.soul_content || null
  } catch {
    return null
  }
}

async function callClaudeDirectly(
  task: DispatchableTask,
  prompt: string,
): Promise<AgentResponseParsed> {
  if (!getAnthropicApiKey()) throw new Error('ANTHROPIC_API_KEY not set — cannot dispatch without gateway')
  const pipelineCfg = await getPipelineConfig(task.workspace_id)
  const model = await classifyDirectModel(task, pipelineCfg)
  return callWithFallback(task, prompt, model)
}

interface ReviewableTask {
  id: number
  title: string
  description: string | null
  resolution: string | null
  assigned_to: string | null
  agent_config: string | null
  workspace_id: number
  ticket_prefix: string | null
  project_ticket_no: number | null
}

function resolveGatewayAgentIdForReview(task: ReviewableTask): string {
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (typeof cfg.agentId === 'string' && cfg.agentId) return cfg.agentId
    } catch { /* ignore */ }
  }
  return task.assigned_to || 'jarv'
}

function buildReviewPrompt(task: ReviewableTask): string {
  const ticket = task.ticket_prefix && task.project_ticket_no
    ? `${task.ticket_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `TASK-${task.id}`

  const lines = [
    'You are Aegis, the quality reviewer for Mission Control.',
    'Review the following completed task and its resolution.',
    '',
    `**[${ticket}] ${task.title}**`,
  ]

  if (task.description) {
    lines.push('', '## Task Description', task.description)
  }

  if (task.resolution) {
    lines.push('', '## Agent Resolution', task.resolution.substring(0, 6000))
  }

  lines.push(
    '',
    '## Instructions',
    'Evaluate whether the agent\'s response adequately addresses the task.',
    'Respond with EXACTLY one of these two formats:',
    '',
    'If the work is acceptable:',
    'VERDICT: APPROVED',
    'NOTES: <brief summary of why it passes>',
    '',
    'If the work needs improvement:',
    'VERDICT: REJECTED',
    'NOTES: <specific issues that need to be fixed>',
  )

  return lines.join('\n')
}

function parseReviewVerdict(text: string): { status: 'approved' | 'rejected'; notes: string } {
  const upper = text.toUpperCase()
  const status = upper.includes('VERDICT: APPROVED') ? 'approved' as const : 'rejected' as const
  const notesMatch = text.match(/NOTES:\s*(.+)/i)
  const notes = notesMatch?.[1]?.trim().substring(0, 2000) || (status === 'approved' ? 'Quality check passed' : 'Quality check failed')
  return { status, notes }
}

/**
 * Run Aegis quality reviews on tasks in 'review' status.
 * Uses an agent to evaluate the task resolution, then approves or rejects.
 */
export async function runAegisReviews(): Promise<{ ok: boolean; message: string }> {
  const tasks = await dbGetAll(`
    SELECT t.id, t.title, t.description, t.resolution, t.assigned_to, t.workspace_id,
           p.ticket_prefix, t.project_ticket_no, a.config as agent_config
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'review'
    ORDER BY t.updated_at ASC
    LIMIT 3
  `, []) as ReviewableTask[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No tasks awaiting review' }
  }

  const results: Array<{ id: number; verdict: string; error?: string }> = []

  for (const task of tasks) {
    // Move to quality_review to prevent re-processing
    await dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['quality_review', Math.floor(Date.now() / 1000), task.id])

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'quality_review',
      previous_status: 'review',
    })

    try {
      const prompt = buildReviewPrompt(task)
      let agentResponse: AgentResponseParsed

      if (!isGatewayAvailable() && getAnthropicApiKey()) {
        // Direct Claude API review — no gateway needed
        const reviewTask: DispatchableTask = {
          id: task.id, title: task.title, description: task.description,
          status: 'quality_review', priority: 'high', assigned_to: 'aegis',
          workspace_id: task.workspace_id, agent_name: 'aegis', agent_id: 0,
          agent_config: null, ticket_prefix: task.ticket_prefix,
          project_ticket_no: task.project_ticket_no, project_id: null,
        }
        agentResponse = await callClaudeDirectly(reviewTask, prompt)
      } else {
        throw new Error('Gateway dispatch for quality review requires a direct API key')
      }

      if (!agentResponse.text) {
        throw new Error('Aegis review returned empty response')
      }

      const verdict = parseReviewVerdict(agentResponse.text)

      // Insert quality review record
      await dbRun(`
        INSERT INTO quality_reviews (task_id, reviewer, status, notes, workspace_id)
        VALUES (?, 'aegis', ?, ?, ?)
      `, [task.id, verdict.status, verdict.notes, task.workspace_id])

      if (verdict.status === 'approved') {
        await dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['done', Math.floor(Date.now() / 1000), task.id])

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'done',
          previous_status: 'quality_review',
        })
      } else {
        // Rejected: check dispatch_attempts to decide next status
        const now = Math.floor(Date.now() / 1000)
        const currentAttempts = (await dbGet('SELECT dispatch_attempts FROM tasks WHERE id = ?', [task.id]) as { dispatch_attempts: number } | undefined)?.dispatch_attempts ?? 0
        const newAttempts = currentAttempts + 1
        const maxAegisRetries = 3

        if (newAttempts >= maxAegisRetries) {
          // Too many rejections — move to failed
          await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['failed', `Aegis rejected ${newAttempts} times. Last: ${verdict.notes}`, newAttempts, now, task.id])

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'failed',
            previous_status: 'quality_review',
            error_message: `Aegis rejected ${newAttempts} times`,
            reason: 'max_aegis_retries_exceeded',
          })
        } else {
          // Requeue to assigned for re-dispatch with feedback
          await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['assigned', `Aegis rejected: ${verdict.notes}`, newAttempts, now, task.id])

          eventBus.broadcast('task.status_changed', {
            id: task.id,
            status: 'assigned',
            previous_status: 'quality_review',
            error_message: `Aegis rejected: ${verdict.notes}`,
            reason: 'aegis_rejection',
          })
        }

        // Add rejection as a comment so the agent sees it on next dispatch
        await dbRun(`
          INSERT INTO comments (task_id, author, content, created_at, workspace_id)
          VALUES (?, 'aegis', ?, ?, ?)
        `, [task.id, `Quality Review Rejected (attempt ${newAttempts}/${maxAegisRetries}):\n${verdict.notes}`, now, task.workspace_id])
      }

      db_helpers.logActivity(
        'aegis_review',
        'task',
        task.id,
        'aegis',
        `Aegis ${verdict.status} task "${task.title}": ${verdict.notes.substring(0, 200)}`,
        { verdict: verdict.status, notes: verdict.notes },
        task.workspace_id
      )

      results.push({ id: task.id, verdict: verdict.status })
      logger.info({ taskId: task.id, verdict: verdict.status }, 'Aegis review completed')
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, err }, 'Aegis review failed')

      // Revert to review so it can be retried
      await dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['review', Math.floor(Date.now() / 1000), task.id])

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'review',
        previous_status: 'quality_review',
      })

      results.push({ id: task.id, verdict: 'error', error: errorMsg.substring(0, 100) })
    }
  }

  const approved = results.filter(r => r.verdict === 'approved').length
  const rejected = results.filter(r => r.verdict === 'rejected').length
  const errors = results.filter(r => r.verdict === 'error').length

  return {
    ok: errors === 0,
    message: `Reviewed ${tasks.length}: ${approved} approved, ${rejected} rejected${errors ? `, ${errors} error(s)` : ''}`,
  }
}

/**
 * Requeue stale tasks stuck in 'in_progress' whose assigned agent is offline.
 * Prevents tasks from being permanently stuck when agents crash or disconnect.
 */
export async function requeueStaleTasks(): Promise<{ ok: boolean; message: string }> {
  const now = Math.floor(Date.now() / 1000)
  const staleThreshold = now - 10 * 60 // 10 minutes
  const maxDispatchRetries = 5

  const staleTasks = await dbGetAll(`
    SELECT t.id, t.title, t.assigned_to, t.dispatch_attempts, t.workspace_id,
           a.status as agent_status, a.last_seen as agent_last_seen
    FROM tasks t
    LEFT JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    WHERE t.status = 'in_progress'
      AND t.updated_at < ?
  `, [staleThreshold]) as Array<{
    id: number; title: string; assigned_to: string | null; dispatch_attempts: number
    workspace_id: number; agent_status: string | null; agent_last_seen: number | null
  }>

  if (staleTasks.length === 0) {
    return { ok: true, message: 'No stale tasks found' }
  }

  let requeued = 0
  let failed = 0

  for (const task of staleTasks) {
    // Only requeue if the agent is offline or unknown
    const agentOffline = !task.agent_status || task.agent_status === 'offline'
    if (!agentOffline) continue

    const newAttempts = (task.dispatch_attempts ?? 0) + 1

    if (newAttempts >= maxDispatchRetries) {
      await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['failed', `Task stuck in_progress ${newAttempts} times — agent "${task.assigned_to}" offline. Moved to failed.`, newAttempts, now, task.id])

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'failed',
        previous_status: 'in_progress',
        error_message: `Stale task — agent offline after ${newAttempts} attempts`,
        reason: 'stale_task_max_retries',
      })

      failed++
    } else {
      await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['assigned', `Requeued: agent "${task.assigned_to}" went offline while task was in_progress`, newAttempts, now, task.id])

      // Add a comment explaining the requeue
      await dbRun(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, 'scheduler', ?, ?, ?)
      `, [task.id, `Task requeued (attempt ${newAttempts}/${maxDispatchRetries}): agent "${task.assigned_to}" went offline while task was in_progress.`, now, task.workspace_id])

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'assigned',
        previous_status: 'in_progress',
        error_message: `Agent "${task.assigned_to}" went offline`,
        reason: 'stale_task_requeue',
      })

      requeued++
    }
  }

  const total = requeued + failed
  return {
    ok: true,
    message: total === 0
      ? `Found ${staleTasks.length} stale task(s) but agents still online`
      : `Requeued ${requeued}, failed ${failed} of ${staleTasks.length} stale task(s)`,
  }
}

export async function dispatchAssignedTasks(): Promise<{ ok: boolean; message: string }> {
  const tasks = await dbGetAll(`
    SELECT t.*, a.name as agent_name, a.id as agent_id, a.config as agent_config,
           p.ticket_prefix, t.project_ticket_no
    FROM tasks t
    JOIN agents a ON a.name = t.assigned_to AND a.workspace_id = t.workspace_id
    LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
    WHERE t.status = 'assigned'
      AND t.assigned_to IS NOT NULL
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      t.created_at ASC
    LIMIT 3
  `, []) as (DispatchableTask & { tags?: string })[]

  if (tasks.length === 0) {
    return { ok: true, message: 'No assigned tasks to dispatch' }
  }

  // Parse JSON tags column
  for (const task of tasks) {
    if (typeof task.tags === 'string') {
      try { task.tags = JSON.parse(task.tags as string) } catch { task.tags = undefined }
    }
  }

  const results: Array<{ id: number; success: boolean; error?: string }> = []
  const now = Math.floor(Date.now() / 1000)

  for (const task of tasks) {
    // Mark as in_progress immediately to prevent re-dispatch
    await dbRun('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['in_progress', now, task.id])

    eventBus.broadcast('task.status_changed', {
      id: task.id,
      status: 'in_progress',
      previous_status: 'assigned',
    })

    db_helpers.logActivity(
      'task_dispatched',
      'task',
      task.id,
      'scheduler',
      `Dispatching task "${task.title}" to agent ${task.agent_name}`,
      { agent: task.agent_name, priority: task.priority },
      task.workspace_id
    )

    try {
      // Check for previous Aegis rejection feedback
      const rejectionRow = await dbGet(`
        SELECT content FROM comments
        WHERE task_id = ? AND author = 'aegis' AND content LIKE 'Quality Review Rejected:%'
        ORDER BY created_at DESC LIMIT 1
      `, [task.id]) as { content: string } | undefined
      const rejectionFeedback = rejectionRow?.content?.replace(/^Quality Review Rejected:\n?/, '') || null

      const prompt = buildTaskPrompt(task, rejectionFeedback)

      // Check if task has a target session specified in metadata
      const taskMeta = await (async () => {
        try {
          const row = await dbGet('SELECT metadata FROM tasks WHERE id = ?', [task.id]) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      const targetSession: string | null = typeof taskMeta?.target_session === 'string' && taskMeta.target_session
        ? taskMeta.target_session
        : null

      let agentResponse: AgentResponseParsed
      const useDirectApi = !isGatewayAvailable() && getAnthropicApiKey()

      if (useDirectApi && !targetSession) {
        // Direct Claude API dispatch — no gateway needed
        agentResponse = await callClaudeDirectly(task, prompt)
      } else if (targetSession) {
        // Session-targeted dispatch: fire-and-forget acknowledgement
        logger.info({ taskId: task.id, targetSession, agent: task.agent_name }, 'Dispatching task to targeted session (gateway RPC unavailable)')
        agentResponse = {
          text: `Task dispatched to session ${targetSession}. The agent will process it within that session context.`,
          sessionId: targetSession,
        }
      } else {
        throw new Error('Gateway dispatch requires a direct API key or a target session')
      }

      if (!agentResponse.text) {
        throw new Error('Agent returned empty response')
      }

      const truncated = agentResponse.text.length > 10_000
        ? agentResponse.text.substring(0, 10_000) + '\n\n[Response truncated at 10,000 characters]'
        : agentResponse.text

      // Merge dispatch_session_id into existing metadata
      const existingMeta = await (async () => {
        try {
          const row = await dbGet('SELECT metadata FROM tasks WHERE id = ?', [task.id]) as { metadata: string } | undefined
          return row?.metadata ? JSON.parse(row.metadata) : {}
        } catch { return {} }
      })()
      if (agentResponse.sessionId) {
        existingMeta.dispatch_session_id = agentResponse.sessionId
      }

      // Update task: status → review, set outcome
      await dbRun(`
        UPDATE tasks SET status = ?, outcome = ?, resolution = ?, metadata = ?, updated_at = ? WHERE id = ?
      `, ['review', 'success', truncated, JSON.stringify(existingMeta), Math.floor(Date.now() / 1000), task.id])

      // Add a comment from the agent with the full response
      await dbRun(`
        INSERT INTO comments (task_id, author, content, created_at, workspace_id)
        VALUES (?, ?, ?, ?, ?)
      `, [task.id,
        task.agent_name,
        truncated,
        Math.floor(Date.now()) / 1000,
        task.workspace_id
      ])

      eventBus.broadcast('task.status_changed', {
        id: task.id,
        status: 'review',
        previous_status: 'in_progress',
      })

      eventBus.broadcast('task.updated', {
        id: task.id,
        status: 'review',
        outcome: 'success',
        assigned_to: task.assigned_to,
        dispatch_session_id: agentResponse.sessionId,
      })

      db_helpers.logActivity(
        'task_agent_completed',
        'task',
        task.id,
        task.agent_name,
        `Agent completed task "${task.title}" — awaiting review`,
        { response_length: agentResponse.text.length, dispatch_session_id: agentResponse.sessionId },
        task.workspace_id
      )

      results.push({ id: task.id, success: true })
      logger.info({ taskId: task.id, agent: task.agent_name }, 'Task dispatched and completed')
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error'
      logger.error({ taskId: task.id, agent: task.agent_name, err }, 'Task dispatch failed')

      // Increment dispatch_attempts and decide next status
      const currentAttempts = (await dbGet('SELECT dispatch_attempts FROM tasks WHERE id = ?', [task.id]) as { dispatch_attempts: number } | undefined)?.dispatch_attempts ?? 0
      const newAttempts = currentAttempts + 1
      const maxDispatchRetries = 5

      if (newAttempts >= maxDispatchRetries) {
        // Too many failures — move to failed
        await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['failed', `Dispatch failed ${newAttempts} times. Last: ${errorMsg.substring(0, 5000)}`, newAttempts, Math.floor(Date.now() / 1000), task.id])

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'failed',
          previous_status: 'in_progress',
          error_message: `Dispatch failed ${newAttempts} times`,
          reason: 'max_dispatch_retries_exceeded',
        })
      } else {
        // Revert to assigned so it can be retried on the next tick
        await dbRun('UPDATE tasks SET status = ?, error_message = ?, dispatch_attempts = ?, updated_at = ? WHERE id = ?', ['assigned', errorMsg.substring(0, 5000), newAttempts, Math.floor(Date.now() / 1000), task.id])

        eventBus.broadcast('task.status_changed', {
          id: task.id,
          status: 'assigned',
          previous_status: 'in_progress',
          error_message: errorMsg.substring(0, 500),
          reason: 'dispatch_failed',
        })
      }

      db_helpers.logActivity(
        'task_dispatch_failed',
        'task',
        task.id,
        'scheduler',
        `Task dispatch failed for "${task.title}": ${errorMsg.substring(0, 200)}`,
        { error: errorMsg.substring(0, 1000) },
        task.workspace_id
      )

      results.push({ id: task.id, success: false, error: errorMsg.substring(0, 100) })
    }
  }

  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success)
  const failSummary = failed.length > 0
    ? ` (${failed.length} failed: ${failed.map(f => f.error).join('; ')})`
    : ''

  return {
    ok: failed.length === 0,
    message: `Dispatched ${succeeded}/${tasks.length} tasks${failSummary}`,
  }
}

// ---------------------------------------------------------------------------
// Auto-routing: assign inbox tasks to available agents
// ---------------------------------------------------------------------------

/** Role affinity mapping — which task keywords match which agent roles. */
const ROLE_AFFINITY: Record<string, string[]> = {
  coder: ['code', 'implement', 'build', 'fix', 'bug', 'test', 'unit test', 'refactor', 'feature', 'api', 'endpoint', 'function', 'class', 'module', 'component', 'deploy', 'ci', 'pipeline'],
  researcher: ['research', 'investigate', 'analyze', 'compare', 'find', 'discover', 'audit', 'review', 'survey', 'benchmark', 'evaluate', 'assess', 'competitor', 'market', 'trend'],
  reviewer: ['review', 'audit', 'check', 'verify', 'validate', 'quality', 'security', 'compliance', 'approve'],
  tester: ['test', 'qa', 'e2e', 'integration test', 'regression', 'coverage', 'verify', 'validate'],
  devops: ['deploy', 'infrastructure', 'ci', 'cd', 'docker', 'kubernetes', 'monitoring', 'pipeline', 'server', 'nginx', 'ssl'],
  assistant: ['write', 'draft', 'summarize', 'translate', 'format', 'document', 'docs', 'readme', 'email', 'message', 'report'],
  agent: [], // generic fallback
}

function scoreAgentForTask(
  agent: { name: string; role: string; status: string; config: string | null },
  taskText: string,
): number {
  // Offline agents can't take work
  if (agent.status === 'offline' || agent.status === 'error' || agent.status === 'sleeping') return -1

  const text = taskText.toLowerCase()
  const keywords = ROLE_AFFINITY[agent.role] || []

  let score = 0
  // Role keyword match
  for (const kw of keywords) {
    if (text.includes(kw)) score += 10
  }

  // Idle agents get a bonus (prefer agents not currently busy)
  if (agent.status === 'idle') score += 5

  // Check agent capabilities from config
  if (agent.config) {
    try {
      const cfg = JSON.parse(agent.config)
      const caps = Array.isArray(cfg.capabilities) ? cfg.capabilities : []
      for (const cap of caps) {
        if (typeof cap === 'string' && text.includes(cap.toLowerCase())) score += 15
      }
    } catch { /* ignore */ }
  }

  // Any non-offline agent gets at least 1 (can be a fallback)
  return Math.max(score, 1)
}

/**
 * Auto-route inbox tasks to the best available agent.
 * Runs before dispatch — moves tasks from inbox → assigned.
 */
export async function autoRouteInboxTasks(): Promise<{ ok: boolean; message: string }> {
  const inboxTasks = await dbGetAll(`
    SELECT id, title, description, priority, tags, workspace_id
    FROM tasks
    WHERE status = 'inbox' AND assigned_to IS NULL
    ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
      created_at ASC
    LIMIT 5
  `, []) as Array<{ id: number; title: string; description: string | null; priority: string; tags: string | null; workspace_id: number }>

  if (inboxTasks.length === 0) {
    return { ok: true, message: 'No inbox tasks to route' }
  }

  // Get all non-hidden, non-offline agents
  const agents = await dbGetAll(`
    SELECT id, name, role, status, config
    FROM agents
    WHERE hidden = 0 AND status NOT IN ('offline', 'error')
    LIMIT 50
  `, []) as Array<{ id: number; name: string; role: string; status: string; config: string | null }>

  if (agents.length === 0) {
    return { ok: true, message: `${inboxTasks.length} inbox task(s) but no available agents` }
  }

  let routed = 0
  const now = Math.floor(Date.now() / 1000)

  for (const task of inboxTasks) {
    const taskText = `${task.title} ${task.description || ''}`
    let parsedTags: string[] = []
    if (task.tags) {
      try { parsedTags = JSON.parse(task.tags) } catch { /* ignore */ }
    }
    const fullText = `${taskText} ${parsedTags.join(' ')}`

    // Score each agent
    const scored = agents
      .map(a => ({ agent: a, score: scoreAgentForTask(a, fullText) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) continue

    const best = scored[0].agent

    // Check capacity — skip agents with 3+ in-progress tasks
    const inProgressCount = (await dbGet('SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = \'in_progress\' AND workspace_id = ?', [best.name, task.workspace_id]) as { c: number }).c

    if (inProgressCount >= 3) {
      // Try next best agent
      let alt: typeof scored[0] | undefined
      for (const s of scored) {
        const altRow = await dbGet('SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = \'in_progress\' AND workspace_id = ?', [s.agent.name, task.workspace_id]) as { c: number } | undefined
        if ((altRow?.c ?? 0) < 3) { alt = s; break }
      }
      if (!alt) continue // all agents at capacity
      await dbRun('UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?', ['assigned', alt.agent.name, now, task.id])

      db_helpers.logActivity('task_auto_routed', 'task', task.id, 'scheduler',
        `Auto-assigned "${task.title}" to ${alt.agent.name} (${alt.agent.role}, score: ${alt.score})`,
        { agent: alt.agent.name, role: alt.agent.role, score: alt.score },
        task.workspace_id)

      eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'inbox', assigned_to: alt.agent.name })
      routed++
      continue
    }

    await dbRun('UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?', ['assigned', best.name, now, task.id])

    db_helpers.logActivity('task_auto_routed', 'task', task.id, 'scheduler',
      `Auto-assigned "${task.title}" to ${best.name} (${best.role}, score: ${scored[0].score})`,
      { agent: best.name, role: best.role, score: scored[0].score },
      task.workspace_id)

    eventBus.broadcast('task.status_changed', { id: task.id, status: 'assigned', previous_status: 'inbox', assigned_to: best.name })
    routed++
  }

  return {
    ok: true,
    message: routed > 0
      ? `Auto-routed ${routed}/${inboxTasks.length} inbox task(s)`
      : `${inboxTasks.length} inbox task(s), no suitable agents found`,
  }
}
