/**
 * Pipeline Engine — polls JIRA/Azure for cards entering trigger columns,
 * routes them through pipeline_columns (each column with assigned agents = a stage),
 * calls Claude API directly, posts results back, and advances the card.
 *
 * Runs inside Next.js via the scheduler (no separate worker process needed).
 */

import { db_helpers } from '@/lib/db'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { getWorkPipelineRow, decryptPipelineSecrets } from '@/lib/work-pipeline-config'
import type { WorkPipelineConfigJson, WorkPipelineSecrets } from '@/lib/work-pipeline-types'
import { calculateTokenCost } from '@/lib/token-pricing'
import { fetchJiraIssuesByStatus, postJiraComment, getJiraCommentsSince, transitionJiraIssue } from '@/lib/work-pipeline-jira'
import { fetchAzureWorkItemsByState, postAzureComment, getAzureCommentsSince, moveAzureWorkItem } from '@/lib/work-pipeline-azure'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineCardRun {
  id: number
  workspace_id: number
  provider: string
  card_key: string
  card_title: string
  card_description: string
  card_url: string
  current_stage_id: string
  status: 'running' | 'waiting_input' | 'done' | 'cancelled' | 'failed'
  task_id: number | null
  last_comment_ts: number
  run_count: number
  llm_models: string
  cost_usd: number
  pr_check_json: string | null
  created_at: number
  updated_at: number
}

interface AgentRow {
  id: number
  name: string
  role: string
  status: string
}

interface AgentFullRow extends AgentRow {
  model: string | null
  instructions: string | null
  soul_content: string | null
  config: string | null
}

interface PipelineColumn {
  id: number
  pipeline_id: number
  workspace_id: number
  column_name: string
  column_order: number
  is_trigger: number
  agent_id: number | null
  instructions: string | null
  assignments_json: string
}

interface ColumnAssignment {
  role: string
  agent_id: number
  order: number
  llm_model?: string  // "provider:model" chosen per-assignment in the UI; overrides pipeline-level config
  repo_id?: number | null
}

interface ActivePipelineEntry {
  pipelineId: number
  workspaceId: number
  provider: string
  cfg: WorkPipelineConfigJson
  secrets: WorkPipelineSecrets
  columns: PipelineColumn[]
}

// ─── Run DB helpers ───────────────────────────────────────────────────────────

async function getActiveRuns(workspaceId: number): Promise<PipelineCardRun[]> {
  const now = Math.floor(Date.now() / 1000)
  const recentCutoff = now - 48 * 60 * 60  // keep monitoring done runs for 48h so users can reprocess
  return dbGetAll<PipelineCardRun>(
    `SELECT * FROM pipeline_card_runs
     WHERE workspace_id = ? AND (
       status NOT IN ('done','cancelled','failed')
       OR (status = 'failed' AND updated_at < ?)
       OR (status = 'done' AND updated_at > ?)
     )
     ORDER BY created_at ASC`,
    [workspaceId, now - 60, recentCutoff]
  )
}

async function upsertRun(
  workspaceId: number,
  provider: string,
  cardKey: string,
  cardTitle: string,
  cardDescription: string,
  cardUrl: string,
  stageId: string
): Promise<PipelineCardRun | null> {
  const now = Math.floor(Date.now() / 1000)
  const descricao = cardDescription.slice(0, 4000)
  const ESTADOS_TERMINAIS = ['done', 'failed', 'cancelled', 'waiting_input']

  // Tres caminhos explicitos, em vez de INSERT ... ON DUPLICATE KEY UPDATE ... WHERE.
  //
  // Incidente 2026-09-08: o statement anterior levava um `WHERE` depois do
  // ON DUPLICATE KEY UPDATE. Isso e sintaxe do PostgreSQL (ON CONFLICT ... DO UPDATE
  // ... WHERE); o MySQL NAO aceita e devolve erro de parse. Como o catch era vazio,
  // upsertRun devolvia null, quem chamava fazia `continue` sem log, e o motor achou o
  // cartao a cada 10s por dias sem criar UMA execucao e sem UMA linha de erro.
  // Provado no banco: a instrucao com WHERE da rc=1 (parse error); sem WHERE, insere.
  //
  // Corrida: entre o SELECT e o INSERT outro tick poderia inserir. A chave unica
  // uq_pipeline_card_runs (workspace_id, provider, card_key) impede duplicata -- o
  // INSERT falha por duplicidade, cai no catch, e o cartao entra no tick seguinte.
  try {
    const atual = await dbGet<{ id: number; status: string }>(
      'SELECT id, status FROM pipeline_card_runs WHERE workspace_id = ? AND provider = ? AND card_key = ?',
      [workspaceId, provider, cardKey]
    )

    if (!atual) {
      // 1. nao existe -> cria
      await dbRun(`INSERT INTO pipeline_card_runs
           (workspace_id, provider, card_key, card_title, card_description, card_url, current_stage_id, status, task_id, last_comment_ts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', NULL, 0, ?, ?)`,
        [workspaceId, provider, cardKey, cardTitle, descricao, cardUrl, stageId, now, now])
    } else if (ESTADOS_TERMINAIS.includes(atual.status)) {
      // 2. existe e ja terminou -> reinicia (UPDATE com WHERE na chave primaria)
      await dbRun(`UPDATE pipeline_card_runs SET
           card_title = ?, card_description = ?, current_stage_id = ?,
           status = 'running', task_id = NULL, last_comment_ts = 0,
           run_count = COALESCE(run_count, 1) + 1, updated_at = ?
         WHERE id = ?`,
        [cardTitle, descricao, stageId, now, atual.id])
      // limpa as mensagens anteriores para os agentes rodarem de novo em vez de
      // serem pulados como "ja concluido"
      await dbRun('DELETE FROM pipeline_card_messages WHERE run_id = ?', [atual.id])
    }
    // 3. existe e NAO terminou -> nao mexe. Quem chama ja filtrou execucao ativa.
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), card_key: cardKey, provider },
      'pipeline-engine: upsertRun falhou -- execucao do cartao NAO foi criada'
    )
    return null
  }
  return (await dbGet<PipelineCardRun>('SELECT * FROM pipeline_card_runs WHERE workspace_id = ? AND provider = ? AND card_key = ?', [workspaceId, provider, cardKey])) ?? null
}

async function updateRun(id: number, patch: Partial<Pick<PipelineCardRun, 'status' | 'current_stage_id' | 'task_id' | 'last_comment_ts'>>): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [now]
  if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status) }
  if (patch.current_stage_id !== undefined) { sets.push('current_stage_id = ?'); vals.push(patch.current_stage_id) }
  if (patch.task_id !== undefined) { sets.push('task_id = ?'); vals.push(patch.task_id) }
  if (patch.last_comment_ts !== undefined) { sets.push('last_comment_ts = ?'); vals.push(patch.last_comment_ts) }
  vals.push(id)
  await dbRun(`UPDATE pipeline_card_runs SET ${sets.join(', ')} WHERE id = ?`, [...vals])
}

async function logMessage(runId: number, direction: 'agent_to_card' | 'card_to_agent', stageId: string, body: string, externalId?: string): Promise<void> {
  await dbRun(
    `INSERT INTO pipeline_card_messages (run_id, direction, stage_id, body, external_comment_id) VALUES (?, ?, ?, ?, ?)`,
    [runId, direction, stageId, body.slice(0, 10000), externalId ?? null]
  )
}

// ─── Column helpers ───────────────────────────────────────────────────────────

async function getColumnById(columnId: number): Promise<PipelineColumn | null> {
  return (await dbGet<PipelineColumn>('SELECT * FROM pipeline_columns WHERE id = ?', [columnId])) ?? null
}

/** Resolve a column for a run — handles the case where columns were recreated with new IDs. */
async function resolveColumnForRun(run: PipelineCardRun): Promise<PipelineColumn | null> {
  const columnId = parseInt(run.current_stage_id, 10)
  if (isNaN(columnId)) return null

  const direct = await getColumnById(columnId)
  if (direct) return direct

  // Column no longer exists (pipeline was saved and recreated with new IDs).
  // Find which pipeline this run belongs to and fall back to the trigger column.
  const pipelines = await dbGetAll('SELECT DISTINCT pipeline_id FROM pipeline_columns', []) as { pipeline_id: number }[]
  for (const { pipeline_id } of pipelines) {
    const cols = await dbGetAll('SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC', [pipeline_id]) as PipelineColumn[]
    if (!cols.length) continue
    // Check if this pipeline's workspace matches the run's workspace
    const pipeline = await dbGet('SELECT workspace_id FROM work_pipelines WHERE id = ?', [pipeline_id]) as { workspace_id: number } | undefined
    if (!pipeline || pipeline.workspace_id !== run.workspace_id) continue
    // Prefer trigger column, otherwise first column with agents
    const trigger = cols.find(c => c.is_trigger === 1)
    const fallback = cols.find(c => { try { return (JSON.parse(c.assignments_json) as unknown[]).length > 0 } catch { return false } })
    const best = trigger ?? fallback ?? cols[0]
    if (best) {
      // Auto-heal the run so this doesn't repeat every tick
      await dbRun('UPDATE pipeline_card_runs SET current_stage_id = ?, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [String(best.id), run.id])
      console.error(`[pipeline-engine] healed run ${run.id} (${run.card_key}): column ${columnId} → ${best.id} (${best.column_name})`)
      return best
    }
  }
  return null
}

async function getNextColumn(column: PipelineColumn): Promise<PipelineColumn | null> {
  return (await dbGet<PipelineColumn>('SELECT * FROM pipeline_columns WHERE pipeline_id = ? AND column_order > ? ORDER BY column_order ASC LIMIT 1', [column.pipeline_id, column.column_order])) ?? null
}

function parseAssignments(column: PipelineColumn): ColumnAssignment[] {
  try {
    const parsed = JSON.parse(column.assignments_json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function hasAgents(column: PipelineColumn): boolean {
  return parseAssignments(column).length > 0
}

// ─── Agent helpers ────────────────────────────────────────────────────────────

async function getAgentsByIds(ids: number[]): Promise<AgentFullRow[]> {
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = await dbGetAll(`SELECT id, name, role, status, soul_content, instructions, config FROM agents WHERE id IN (${placeholders})`, [...ids]) as any[]
  return rows.map(row => ({ ...row, model: null }) as AgentFullRow)
}

// ─── Parameterized LLM layer ──────────────────────────────────────────────────

interface LLMResult {
  text: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  model: string
}

/**
 * Parse "provider:model" string into provider + model.
 * Priority: assignmentModel (per-agent dropdown) → complexity tier → fallback anthropic.
 */

function classifyCardComplexity(title: string, desc: string): 'simple' | 'medium' | 'complex' {
  const text = (title + ' ' + desc).toLowerCase()
  const complexWords = ['arquitetura', 'architect', 'análise', 'analysis', 'infraestrutura', 'infra', 'migração', 'migration', 'reestrutur', 'design system', 'segurança', 'security', 'performance', 'escalab']
  const simpleWords  = ['bug', 'fix', 'typo', 'texto', 'ajuste', 'correção', 'corrig', 'minor', 'hotfix', 'patch', 'pequen', 'label', 'tradução', 'translation', 'renomear', 'rename']
  if (complexWords.some(w => text.includes(w))) return 'complex'
  if (simpleWords.some(w => text.includes(w)))  return 'simple'
  const wordCount = desc.trim().split(/\s+/).length
  if (wordCount > 200) return 'complex'
  if (wordCount < 30)  return 'simple'
  return 'medium'
}

function parseProviderModel(raw: string): { provider: string; model: string | null } {
  const idx = raw.indexOf(':')
  if (idx < 0) return { provider: raw, model: null }
  return { provider: raw.slice(0, idx), model: raw.slice(idx + 1) }
}

function resolveProviderAndModel(
  cfg: WorkPipelineConfigJson,
  assignmentModel?: string,
  complexity?: 'simple' | 'medium' | 'complex',
): { provider: string; model: string | null } {
  if (assignmentModel?.trim()) return parseProviderModel(assignmentModel.trim())
  const tier = complexity ?? 'medium'
  let raw = ''
  if (tier === 'complex') raw = cfg.llm_complex || cfg.llm_medium || cfg.llm_simple || ''
  else if (tier === 'simple') raw = cfg.llm_simple || cfg.llm_medium || cfg.llm_complex || ''
  else raw = cfg.llm_medium || cfg.llm_simple || cfg.llm_complex || ''
  raw = raw.trim()
  if (!raw) return { provider: 'anthropic', model: null }
  return parseProviderModel(raw)
}

/** Resolve API key for a provider from env → DB integrations settings. */
async function resolveApiKey(provider: string): Promise<string | null> {
  const envKey = `${provider.toUpperCase()}_API_KEY`
  const fromEnv = (process.env[envKey] || '').trim()
  if (fromEnv) return fromEnv
  try {
    for (const k of [`integration.${envKey}`, `${provider.toLowerCase()}.api_key`]) {
      const row = await dbGet('SELECT value FROM settings WHERE `key` = ?', [k]) as { value: string } | undefined
      const v = (row?.value || '').trim()
      if (v) return v
    }
  } catch { /* ignore */ }
  // Legacy: ~/.config/.env
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const { homedir } = require('os') as typeof import('os')
    const content = readFileSync(join(homedir(), '.gateway', '.env'), 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(new RegExp(`^${envKey}\\s*=\\s*(.+)$`))
      if (m) { const v = m[1].trim().replace(/^["']|["']$/g, ''); if (v) return v }
    }
  } catch { /* not found */ }
  return null
}

function agentSystemPrompt(agent: AgentFullRow & { _skills?: string }): string {
  const base = agent.soul_content?.trim() || agent.instructions?.trim() ||
    `You are ${agent.name}, a ${agent.role} agent. Analyze the task and provide a thorough response.`

  let persona: any = null
  try { if (agent.config) persona = JSON.parse(agent.config).persona } catch { /* ignore */ }

  const parts = [base]
  if (persona?.authority_level?.trim()) parts.push(`\n## Nível de autoridade\n${persona.authority_level.trim()}`)
  if (persona?.restrictions?.length) parts.push(`\n## Restrições\n${(persona.restrictions as string[]).map(r => `- ${r}`).join('\n')}`)
  if (persona?.capabilities?.length) parts.push(`\n## Capacidades\n${(persona.capabilities as string[]).map(c => `- ${c}`).join('\n')}`)
  if (persona?.collaborators?.length) parts.push(`\n## Agentes colaboradores\n${(persona.collaborators as string[]).join(', ')}`)
  if (agent._skills?.trim()) parts.push(`\n## Suas skills\n\n${agent._skills.trim()}`)
  return parts.join('\n')
}

async function loadAgentSkills(workspaceId: number): Promise<string> {
  try {
    // Skills are synced from disk to the skills table by skill-sync.ts.
    // The `path` column points to the skill directory; SKILL.md is inside it.
    const rows = await dbGetAll<{ name: string; path: string }>(
      `SELECT name, path FROM skills WHERE path IS NOT NULL ORDER BY name ASC`,
      []
    )
    if (!rows.length) return ''
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync, existsSync } = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path')
    const parts: string[] = []
    for (const row of rows) {
      try {
        const skillDoc = join(row.path, 'SKILL.md')
        if (existsSync(skillDoc)) {
          const content = readFileSync(skillDoc, 'utf-8').trim()
          if (content) parts.push(`### Skill: ${row.name}\n${content}`)
        }
      } catch { /* skip unreadable skill */ }
    }
    return parts.join('\n\n')
  } catch {
    return ''
  }
  void workspaceId // reserved for future per-workspace skill filtering
}

async function callAnthropicLLM(agent: AgentFullRow, prompt: string, apiKey: string, cfgModel: string | null): Promise<LLMResult> {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada — configure em Integrações')
  const model = (agent.model && !agent.model.includes(':')) ? agent.model : cfgModel
  if (!model) throw new Error('Nenhum modelo configurado para Anthropic — configure na tela de Pipeline')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 2048, system: agentSystemPrompt(agent), messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`)

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
    model?: string
  }
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  const usedModel = data.model || model
  return { text, inputTokens, outputTokens, costUsd: calculateTokenCost(usedModel, inputTokens, outputTokens), model: usedModel }
}

async function callGeminiLLM(agent: AgentFullRow, prompt: string, apiKey: string | null, cfgModel: string | null): Promise<LLMResult> {
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada — configure em Integrações')
  const agentModelIsGemini = agent.model && !agent.model.includes(':') && agent.model.toLowerCase().startsWith('gemini')
  const model = agentModelIsGemini ? agent.model : cfgModel
  if (!model) throw new Error('Nenhum modelo configurado para Gemini — configure na tela de Pipeline')

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: agentSystemPrompt(agent) }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(90_000),
    }
  )
  if (!response.ok) throw new Error(`Gemini API error ${response.status}: ${await response.text()}`)

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ?? ''
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0
  return { text, inputTokens, outputTokens, costUsd: 0, model: model ?? '' }
}

const OPENAI_COMPAT_BASES: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  venice:     'https://api.venice.ai/api/v1',
  nvidia:     'https://integrate.api.nvidia.com/v1',
  moonshot:   'https://api.moonshot.cn/v1',
  deepseek:   'https://api.deepseek.com/v1',
  groq:       'https://api.groq.com/openai/v1',
}

async function callOpenAICompatLLM(agent: AgentFullRow, prompt: string, provider: string, apiKey: string | null, cfgModel: string | null): Promise<LLMResult> {
  if (!apiKey) throw new Error(`${provider.toUpperCase()}_API_KEY não configurada — configure em Integrações`)
  const base = OPENAI_COMPAT_BASES[provider] || 'https://api.openai.com/v1'
  // Only use agent.model if it looks native to this provider (no colon, no other-provider prefix)
  const otherProviderPrefixes = ['claude', 'gemini', 'ollama', 'deepseek', 'llama', 'mixtral']
  const agentModelNative = agent.model && !agent.model.includes(':') &&
    !otherProviderPrefixes.some(p => agent.model!.toLowerCase().startsWith(p))
  const model = agentModelNative ? agent.model : cfgModel
  if (!model) throw new Error(`Nenhum modelo configurado para ${provider} — configure na tela de Pipeline`)

  const systemContent = agentSystemPrompt(agent as AgentFullRow & { _skills?: string })

  const buildBody = (useCompletionTokens: boolean, omitSystem: boolean) => {
    const messages: Array<{ role: string; content: string }> = []
    if (omitSystem) {
      messages.push({ role: 'user', content: `${systemContent}\n\n${prompt}` })
    } else {
      messages.push({ role: 'system', content: systemContent })
      messages.push({ role: 'user', content: prompt })
    }
    const body: Record<string, unknown> = { model, messages }
    if (useCompletionTokens) {
      body.max_completion_tokens = 2048
    } else {
      body.max_tokens = 2048
    }
    return body
  }

  const doFetch = (body: Record<string, unknown>) =>
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })

  // First attempt: standard params
  let response = await doFetch(buildBody(false, false))

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    if (response.status === 400 && errText.includes('max_completion_tokens')) {
      logger.info({ model, provider }, 'Model requires max_completion_tokens — retrying')
      response = await doFetch(buildBody(true, false))
      if (!response.ok) {
        const errText2 = await response.text().catch(() => '')
        if (response.status === 400 && (errText2.includes('system') || errText2.includes('unsupported'))) {
          logger.info({ model, provider }, 'Model does not support system role — retrying without it')
          response = await doFetch(buildBody(true, true))
          if (!response.ok) throw new Error(`${provider} API error ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`)
        } else {
          throw new Error(`${provider} API error ${response.status}: ${errText2.slice(0, 300)}`)
        }
      }
    } else if (response.status === 400 && (errText.includes('"system"') || errText.includes('system_prompt'))) {
      logger.info({ model, provider }, 'Model does not support system role — retrying without it')
      response = await doFetch(buildBody(false, true))
      if (!response.ok) throw new Error(`${provider} API error ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`)
    } else {
      throw new Error(`${provider} API error ${response.status}: ${errText.slice(0, 300)}`)
    }
  }
  if (!response.ok) throw new Error(`${provider} API error ${response.status}: ${await response.text()}`)

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    model?: string
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  const usedModel = data.model || model || ''
  return { text, inputTokens, outputTokens, costUsd: calculateTokenCost(usedModel, inputTokens, outputTokens), model: usedModel }
}

async function callOllamaLLM(agent: AgentFullRow, prompt: string, cfg: WorkPipelineConfigJson, cfgModel: string | null): Promise<LLMResult> {
  const ollamaHost = (cfg.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '')
  const model = cfg.ollamaModel || (agent.model && !agent.model.startsWith('claude-') ? agent.model : null) || cfgModel
  if (!model) throw new Error('Nenhum modelo configurado para Ollama — configure na tela de Pipeline')

  const response = await fetch(`${ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false,
      messages: [
        { role: 'system', content: agentSystemPrompt(agent) },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`Ollama API error ${response.status}: ${(await response.text()).slice(0, 300)}`)

  const data = await response.json() as {
    message?: { content?: string }
    prompt_eval_count?: number
    eval_count?: number
  }
  return { text: data.message?.content || '', inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0, costUsd: 0, model }
}

// ─── Multi-repo push helper ───────────────────────────────────────────────────
// Parses FILE blocks from LLM output, routes each file to the correct repo
// by matching the [repo-name]: prefix against the list of known repos.
// Falls back to effectiveRepoId for files without a prefix.
async function pushFilesToRepos(
  llmOutput: string,
  cardKey: string,
  cardTitle: string,
  knownRepos: Array<{ id: number; name: string }>,
  fallbackRepoId: number | null,
): Promise<Array<{ repoId: number; repoName: string; ok: boolean; branch?: string; files?: string[]; message: string }>> {
  const allFiles = extractFilesFromLLMOutput(llmOutput)
  if (allFiles.length === 0) return []

  // Group files by repo
  const byRepo = new Map<number, { repoName: string; files: ExtractedFile[] }>()

  for (const file of allFiles) {
    let repoId: number | null = null
    let repoName = 'repositório'

    if (file.repoName) {
      // Match [repo-name]: prefix against known repos (case-insensitive, partial match)
      const match = knownRepos.find(r =>
        r.name.toLowerCase() === file.repoName!.toLowerCase() ||
        r.name.toLowerCase().includes(file.repoName!.toLowerCase()) ||
        file.repoName!.toLowerCase().includes(r.name.toLowerCase())
      )
      if (match) { repoId = match.id; repoName = match.name }
    }

    // Fallback to effectiveRepoId
    if (!repoId) {
      repoId = fallbackRepoId
      repoName = knownRepos.find(r => r.id === fallbackRepoId)?.name ?? 'repositório'
    }

    if (!repoId) continue

    if (!byRepo.has(repoId)) byRepo.set(repoId, { repoName, files: [] })
    byRepo.get(repoId)!.files.push({ ...file })
  }

  // Push to each repo
  const results: Array<{ repoId: number; repoName: string; ok: boolean; branch?: string; files?: string[]; message: string }> = []

  for (const [repoId, { repoName, files }] of byRepo) {
    // Reconstruct LLM output containing only this repo's files for pushCodeToGitHub
    const fakeOutput = files.map(f =>
      `### FILE: ${f.path}\n\`\`\`\n${f.content}\`\`\``
    ).join('\n') + `\nCOMMIT: feat(${cardKey.toLowerCase()}): implement feature`

    const result = await pushCodeToGitHub(repoId, cardKey, cardTitle, fakeOutput)
    results.push({ repoId, repoName, ...result })
  }

  return results
}

interface ExtractedFile {
  path: string
  content: string
  repoName?: string  // optional repo prefix from [repo-name]: syntax
}

function extractFilesFromLLMOutput(text: string): ExtractedFile[] {
  const files: ExtractedFile[] = []
  // Supports:
  //   ### FILE: [repo-name]: path/to/file.ext   (multi-repo)
  //   ### FILE: path/to/file.ext                (single-repo, legacy)
  //   ### ARQUIVO: ...                          (Portuguese alias)
  const pattern = /###\s*(?:FILE|ARQUIVO):\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].trim()
    const content = match[2]
    if (!raw || content === undefined) continue

    // Check for [repo-name]: prefix
    const repoMatch = raw.match(/^\[([^\]]+)\]:\s*(.+)$/)
    if (repoMatch) {
      files.push({ path: repoMatch[2].trim(), content, repoName: repoMatch[1].trim() })
    } else {
      files.push({ path: raw, content })
    }
  }
  return files
}

function extractCommitMessage(text: string, cardKey: string): string {
  const m = text.match(/COMMIT:\s*(.+)/i)
  return m ? m[1].trim() : `feat(${cardKey.toLowerCase()}): implement feature`
}

function toBranchSlug(cardKey: string, cardTitle: string): string {
  const slug = cardTitle
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return `feat/${cardKey.toLowerCase()}-${slug}`
}

function toConventionalPRTitle(cardKey: string, cardTitle: string): string {
  return `feat(${cardKey.toLowerCase()}): ${cardTitle.charAt(0).toLowerCase()}${cardTitle.slice(1)}`
}

// Publicador de GitLab. A funcao abaixo (pushCodeToGitHub) entende SOMENTE
// github.com: casa a URL do repositorio contra /github\.com\/.../ e conversa com
// api.github.com. O repositorio ligado ao fluxo AURA e GitLab
// (git_repositories.provider = 'gitlab', repo_url em gitlab.interno.*), entao ela
// devolvia "URL do repositorio invalida" ANTES de qualquer chamada de rede -- e o
// motivo nao aparecia em log de erro porque e um `return`, nao um `throw`.
//
// Contrato conferido na documentacao oficial do GitLab (2026-09-08):
//   GET  /projects/:id/repository/branches/:branch   -- a branch existe?
//   POST /projects/:id/repository/branches           -- branch + ref
//   POST /projects/:id/repository/commits            -- branch, commit_message, actions[]
//   actions[].action in create|update|delete|move|chmod; encoding in text|base64
//   autenticacao pelo header PRIVATE-TOKEN (token de ESCRITA e `glpat-`)
// O `:id` aceita id numerico OU o caminho do projeto codificado por URL.
async function pushCodeToBitbucket(
  repo: { repo_url: string; branch: string; access_token: string | null; base_url?: string | null },
  branchName: string,
  commitMsg: string,
  files: ExtractedFile[],
): Promise<{ ok: boolean; branch?: string; files?: string[]; message: string }> {
  const token = repo.access_token
  if (!token) return { ok: false, message: 'Repositório sem token de acesso configurado' }

  const match = repo.repo_url.match(/bitbucket\.org\/([^/]+)\/([^/.]+)/)
  if (!match) return { ok: false, message: `URL do repositório inválida: ${repo.repo_url}` }
  const [, workspace, slug] = match

  const authHeader = token.includes(':')
    ? `Basic ${Buffer.from(token).toString('base64')}`
    : `Bearer ${token}`
  const headers: Record<string, string> = { Authorization: authHeader }

  const apiBase = `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}`
  const baseBranch = (repo.branch || '').trim() || 'main'

  // Bitbucket commits via multipart form POST to /src
  // Each file is a field, branch/message are metadata fields
  const form = new FormData()
  form.append('message', commitMsg)
  form.append('branch', branchName)
  form.append('parents', baseBranch)  // base branch as parent commit

  for (const file of files) {
    form.append(file.path, new Blob([file.content], { type: 'text/plain' }), file.path)
  }

  const commitResp = await fetch(`${apiBase}/src`, {
    method: 'POST',
    headers,
    body: form,
  })

  if (!commitResp.ok) {
    const errText = await commitResp.text().catch(() => '')
    return { ok: false, message: `Bitbucket commit error ${commitResp.status}: ${errText.slice(0, 200)}` }
  }

  return { ok: true, branch: branchName, files: files.map(f => f.path), message: commitMsg }
}

async function pushCodeToGitLab(
  repo: { repo_url: string; branch: string; access_token: string | null; base_url?: string | null },
  branchName: string,
  commitMsg: string,
  files: ExtractedFile[],
): Promise<{ ok: boolean; branch?: string; files?: string[]; message: string }> {
  const token = repo.access_token
  if (!token) return { ok: false, message: 'Repositorio sem token de acesso configurado' }

  let origin: string
  let projectPath: string
  try {
    const u = new URL(repo.repo_url)
    origin = (repo.base_url || u.origin).replace(/\/+$/, '')
    projectPath = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
  } catch {
    return { ok: false, message: `URL do repositorio invalida: ${repo.repo_url}` }
  }
  if (!projectPath) return { ok: false, message: `URL sem caminho de projeto: ${repo.repo_url}` }

  const api = `${origin}/api/v4/projects/${encodeURIComponent(projectPath)}`
  const headers: Record<string, string> = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }
  const enc = (s: string) => encodeURIComponent(s)

  // Branch base: a configurada e, se ela nao existir, a default do projeto.
  // Medido em 2026-09-08: o fluxo AURA tinha `main` configurada num repositorio
  // cuja unica branch e `master` -- a criacao da branch de trabalho reprovaria.
  let baseBranch = (repo.branch || '').trim()
  let baseNota = ''
  const baseResp = baseBranch
    ? await fetch(`${api}/repository/branches/${enc(baseBranch)}`, { headers })
    : null
  if (!baseResp || !baseResp.ok) {
    const projResp = await fetch(api, { headers })
    if (!projResp.ok) {
      return { ok: false, message: `GitLab ${projResp.status} ao ler o projeto ${projectPath}: ${(await projResp.text()).slice(0, 200)}` }
    }
    const proj = await projResp.json() as { default_branch?: string | null }
    if (!proj.default_branch) {
      return { ok: false, message: `Projeto ${projectPath} sem branch default (repositorio vazio?)` }
    }
    baseNota = baseBranch
      ? ` (branch base "${baseBranch}" nao existe; usei a default "${proj.default_branch}")`
      : ''
    baseBranch = proj.default_branch
  }

  const headResp = await fetch(`${api}/repository/branches/${enc(branchName)}`, { headers })
  if (headResp.status === 404) {
    const criada = await fetch(
      `${api}/repository/branches?branch=${enc(branchName)}&ref=${enc(baseBranch)}`,
      { method: 'POST', headers },
    )
    if (!criada.ok) {
      return { ok: false, message: `Erro ao criar branch ${branchName} a partir de ${baseBranch}: ${(await criada.text()).slice(0, 200)}` }
    }
  } else if (!headResp.ok) {
    return { ok: false, message: `GitLab ${headResp.status} ao consultar a branch ${branchName}: ${(await headResp.text()).slice(0, 200)}` }
  }

  // `create` x `update` por arquivo. A doc NAO declara o que `create` faz sobre
  // arquivo que ja existe, entao decido pela existencia em vez de depender de
  // comportamento nao documentado.
  const actions: Array<Record<string, string>> = []
  for (const file of files) {
    const existe = await fetch(`${api}/repository/files/${enc(file.path)}?ref=${enc(branchName)}`, { headers })
    actions.push({
      action: existe.ok ? 'update' : 'create',
      file_path: file.path,
      content: Buffer.from(file.content).toString('base64'),
      encoding: 'base64',
    })
  }

  const commitResp = await fetch(`${api}/repository/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ branch: branchName, commit_message: commitMsg, actions }),
  })
  if (!commitResp.ok) {
    return { ok: false, message: `Erro ao commitar ${actions.length} arquivo(s) em ${branchName}: ${(await commitResp.text()).slice(0, 200)}` }
  }

  return { ok: true, branch: branchName, files: files.map((f) => f.path), message: `${commitMsg}${baseNota}` }
}

async function pushCodeToGitHub(
  repoId: number,
  cardKey: string,
  cardTitle: string,
  llmOutput: string,
): Promise<{ ok: boolean; branch?: string; files?: string[]; message: string }> {
  const repo = await dbGet('SELECT * FROM git_repositories WHERE id = ?', [repoId]) as
    | { repo_url: string; branch: string; access_token: string | null; provider?: string | null; base_url?: string | null }
    | undefined

  if (!repo?.access_token) {
    logger.warn({ repoId, repo_url: repo?.repo_url, has_token: !!repo?.access_token, repo_exists: !!repo }, 'pushCodeToGitHub: repo token check failed')
    return { ok: false, message: 'Repositório sem token de acesso configurado' }
  }

  const files = extractFilesFromLLMOutput(llmOutput)
  if (files.length === 0) {
    return { ok: false, message: 'Nenhum arquivo encontrado no output. Use o formato: `### FILE: caminho/arquivo.ext`' }
  }

  const commitMsg = extractCommitMessage(llmOutput, cardKey)
  const branchName = toBranchSlug(cardKey, cardTitle)

  // Route by provider before URL matching
  if (/bitbucket\.org\//.test(repo.repo_url)) {
    return pushCodeToBitbucket(repo, branchName, commitMsg, files)
  }
  if (!/github\.com\//.test(repo.repo_url)) {
    return pushCodeToGitLab(repo, branchName, commitMsg, files)
  }

  const urlMatch = repo.repo_url.match(/github\.com\/([^/]+)\/([^/.]+)/)
  if (!urlMatch) return { ok: false, message: `URL do repositório inválida: ${repo.repo_url}` }

  const [, owner, repoName] = urlMatch
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${repo.access_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  // Get base branch SHA
  const baseBranch = repo.branch || 'main'
  const refResp = await fetch(`${apiBase}/git/ref/heads/${baseBranch}`, { headers })
  if (!refResp.ok) {
    return { ok: false, message: `Erro ao buscar branch base "${baseBranch}": ${await refResp.text()}` }
  }
  const refData = await refResp.json() as { object: { sha: string } }
  const baseSha = refData.object.sha

  // Create branch if it doesn't exist
  const branchCheck = await fetch(`${apiBase}/git/ref/heads/${branchName}`, { headers })
  if (branchCheck.status === 404) {
    const createBranch = await fetch(`${apiBase}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    })
    if (!createBranch.ok) {
      return { ok: false, message: `Erro ao criar branch ${branchName}: ${await createBranch.text()}` }
    }
  }

  const committed: string[] = []
  for (const file of files) {
    const contentB64 = Buffer.from(file.content).toString('base64')

    // Check if file exists on the branch (to get its SHA for updates)
    let existingSha: string | undefined
    const existingResp = await fetch(`${apiBase}/contents/${file.path}?ref=${branchName}`, { headers })
    if (existingResp.ok) {
      const existing = await existingResp.json() as { sha: string }
      existingSha = existing.sha
    }

    const body: Record<string, unknown> = { message: commitMsg, content: contentB64, branch: branchName }
    if (existingSha) body.sha = existingSha

    const putResp = await fetch(`${apiBase}/contents/${file.path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

    if (!putResp.ok) {
      logger.warn({ file: file.path, status: putResp.status }, 'pipeline-engine: GitHub file push failed')
      continue
    }
    committed.push(file.path)
  }

  if (committed.length === 0) return { ok: false, message: 'Nenhum arquivo foi commitado com sucesso' }
  return { ok: true, branch: branchName, files: committed, message: commitMsg }
}

async function openPullRequest(
  repoId: number,
  cardKey: string,
  cardTitle: string,
  reviewBody: string,
): Promise<{ ok: boolean; url?: string; prNumber?: number; message: string }> {
  const repo = await dbGet('SELECT * FROM git_repositories WHERE id = ?', [repoId]) as
    | { repo_url: string; branch: string; access_token: string | null }
    | undefined

  if (!repo?.access_token) return { ok: false, message: 'Repositório sem token configurado' }

  const urlMatch = repo.repo_url.match(/github\.com\/([^/]+)\/([^/.]+)/)
  if (!urlMatch) return { ok: false, message: 'URL do repositório inválida' }

  const [, owner, repoName] = urlMatch
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${repo.access_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  const branchName = toBranchSlug(cardKey, cardTitle)
  const baseBranch = repo.branch || 'main'

  // Check that the feature branch exists
  const branchCheck = await fetch(`${apiBase}/git/ref/heads/${branchName}`, { headers })
  if (!branchCheck.ok) {
    return { ok: false, message: `Branch ${branchName} não encontrada — o desenvolvedor ainda não commitou código` }
  }

  // Check if PR already exists
  const existingResp = await fetch(`${apiBase}/pulls?head=${owner}:${branchName}&state=open`, { headers })
  if (existingResp.ok) {
    const existing = await existingResp.json() as Array<{ html_url: string; number: number }>
    if (existing.length > 0) {
      return { ok: true, url: existing[0].html_url, prNumber: existing[0].number, message: `PR já existia: #${existing[0].number}` }
    }
  }

  const prTitle = toConventionalPRTitle(cardKey, cardTitle)

  const prBody = [
    `## ${cardKey} — ${cardTitle}`,
    ``,
    `### Code Review`,
    reviewBody.substring(0, 3000),
    ``,
    `---`,
    `*PR aberto automaticamente pela esteira de agentes após code review do arquiteto.*`,
  ].join('\n')

  const prResp = await fetch(`${apiBase}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: baseBranch,
    }),
  })

  if (!prResp.ok) {
    const err = await prResp.text()
    return { ok: false, message: `Erro ao abrir PR: ${err}` }
  }

  const pr = await prResp.json() as { html_url: string; number: number }
  return { ok: true, url: pr.html_url, prNumber: pr.number, message: `PR #${pr.number} aberto com sucesso` }
}

async function mergeToMain(
  repoId: number,
  cardKey: string,
  cardTitle: string,
): Promise<{ ok: boolean; sha?: string; message: string }> {
  const repo = await dbGet('SELECT * FROM git_repositories WHERE id = ?', [repoId]) as
    | { repo_url: string; branch: string; access_token: string | null }
    | undefined

  if (!repo?.access_token) return { ok: false, message: 'Repositório sem token configurado' }

  const urlMatch = repo.repo_url.match(/github\.com\/([^/]+)\/([^/.]+)/)
  if (!urlMatch) return { ok: false, message: 'URL do repositório inválida' }

  const [, owner, repoName] = urlMatch
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${repo.access_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  const branchName = toBranchSlug(cardKey, cardTitle)
  const baseBranch = repo.branch || 'main'

  const branchCheck = await fetch(`${apiBase}/git/ref/heads/${branchName}`, { headers })
  if (!branchCheck.ok) {
    return { ok: false, message: `Branch ${branchName} não encontrada — o desenvolvedor ainda não commitou código` }
  }

  const mergeResp = await fetch(`${apiBase}/merges`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base: baseBranch,
      head: branchName,
      commit_message: `feat(${cardKey.toLowerCase()}): merge ${branchName} → ${baseBranch} [pipeline]`,
    }),
  })

  if (mergeResp.status === 204) {
    return { ok: true, message: 'Branch já estava integrada na main (sem diferenças)' }
  }

  if (!mergeResp.ok) {
    const err = await mergeResp.text()
    return { ok: false, message: `Erro no merge: ${err}` }
  }

  const merged = await mergeResp.json() as { sha: string }
  return { ok: true, sha: merged.sha, message: `Merge de ${branchName} → ${baseBranch} realizado` }
}

// ─── GitHub CI verification ───────────────────────────────────────────────────

interface PRCheckInfo {
  repoId: number
  owner: string
  repo: string
  prNumber: number
  stageId: string
  ci_fix_count?: number
}

async function checkGitHubCIStatus(
  info: Omit<PRCheckInfo, 'repoId' | 'stageId' | 'ci_fix_count'> & { token: string }
): Promise<{ status: 'pending' | 'passed' | 'failed'; summary: string; failureDetails?: string }> {
  const apiBase = `https://api.github.com/repos/${info.owner}/${info.repo}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${info.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const prResp = await fetch(`${apiBase}/pulls/${info.prNumber}`, { headers, signal: AbortSignal.timeout(15_000) })
  // 5xx = transient GitHub error — retry on next tick
  if (!prResp.ok) {
    if (prResp.status >= 500) return { status: 'pending', summary: `GitHub indisponível (HTTP ${prResp.status}), tentando novamente...` }
    return { status: 'failed', summary: `Erro ao verificar PR: HTTP ${prResp.status}` }
  }

  const pr = await prResp.json() as { head: { sha: string }; state: string; merged: boolean }
  if (pr.merged) return { status: 'passed', summary: 'PR já mergeado' }
  if (pr.state === 'closed') return { status: 'failed', summary: 'PR fechado sem merge' }

  const checksResp = await fetch(`${apiBase}/commits/${pr.head.sha}/check-runs?per_page=100`, { headers, signal: AbortSignal.timeout(15_000) })
  if (!checksResp.ok) return { status: 'pending', summary: 'Aguardando GitHub Actions...' }

  const checksData = await checksResp.json() as {
    total_count: number
    check_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string; output?: { summary?: string; text?: string } }>
  }

  if (checksData.total_count === 0) return { status: 'pending', summary: 'Aguardando GitHub Actions iniciar...' }

  const runs = checksData.check_runs
  const failed = runs.filter(r => r.status === 'completed' && ['failure', 'cancelled', 'timed_out', 'action_required'].includes(r.conclusion ?? ''))
  const pending = runs.filter(r => r.status !== 'completed')

  if (failed.length > 0) {
    // Fetch output details for each failed check to give context to the dev agent
    const details: string[] = []
    for (const failedRun of failed.slice(0, 3)) {
      try {
        const runResp = await fetch(`${apiBase}/check-runs/${failedRun.id}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (runResp.ok) {
          const runData = await runResp.json() as { output?: { summary?: string; text?: string } }
          const summary = runData.output?.summary?.slice(0, 600) ?? ''
          const text = runData.output?.text?.slice(0, 800) ?? ''
          if (summary || text) details.push(`### ${failedRun.name}\n${summary}\n${text}`.trim())
        }
      } catch { /* best-effort */ }
    }
    return {
      status: 'failed',
      summary: `CI falhou: ${failed.map(r => r.name).join(', ')}`,
      failureDetails: details.join('\n\n') || undefined,
    }
  }
  if (pending.length > 0) {
    return { status: 'pending', summary: `Em andamento: ${pending.map(r => r.name).join(', ')}` }
  }
  return { status: 'passed', summary: `CI passou: ${runs.map(r => r.name).join(', ')}` }
}

const MAX_CI_FIX_ATTEMPTS = 3

async function checkAndAdvancePRCI(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
): Promise<void> {
  if (!run.pr_check_json) return

  let prInfo: PRCheckInfo
  try {
    prInfo = JSON.parse(run.pr_check_json)
  } catch {
    return
  }
  const repoRow = await dbGet('SELECT access_token FROM git_repositories WHERE id = ?', [prInfo.repoId]) as { access_token: string | null } | undefined
  if (!repoRow?.access_token) return

  let ciResult: { status: 'pending' | 'passed' | 'failed'; summary: string; failureDetails?: string }
  try {
    ciResult = await checkGitHubCIStatus({ owner: prInfo.owner, repo: prInfo.repo, prNumber: prInfo.prNumber, token: repoRow.access_token })
  } catch (err) {
    logger.warn({ err, run_id: run.id }, 'pipeline-engine: CI status check failed')
    return
  }

  if (ciResult.status === 'pending') return

  if (ciResult.status === 'passed') {
    await dbRun('UPDATE pipeline_card_runs SET pr_check_json = NULL, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
    const passMsg = [
      `✅ **CI passou** — PR #${prInfo.prNumber}`,
      ``,
      ciResult.summary,
      ``,
      `▶️ Avançando para a próxima etapa...`,
    ].join('\n')
    await postCardComment(run.provider, cfg, secrets, run.card_key, passMsg)
    try {
      db_helpers.logActivity(
        'pipeline.ci_passed', 'pipeline_card', run.id, 'pipeline',
        `CI passou — PR #${prInfo.prNumber} (${run.card_key})`,
        { card_key: run.card_key, card_title: run.card_title, pr_number: prInfo.prNumber, summary: ciResult.summary },
        run.workspace_id
      )
    } catch { /* non-critical */ }
    const stageColumn = (await getColumnById(parseInt(prInfo.stageId, 10))) ?? column
    await advanceToNextColumn({ ...run, status: 'running' }, stageColumn, cfg, secrets, '')
    return
  }

  // CI failed — try auto-fix via developer agent
  const fixCount = prInfo.ci_fix_count ?? 0

  try {
    db_helpers.logActivity(
      'pipeline.ci_failed', 'pipeline_card', run.id, 'pipeline',
      `CI falhou — PR #${prInfo.prNumber} (${run.card_key}): ${ciResult.summary}`,
      { card_key: run.card_key, card_title: run.card_title, pr_number: prInfo.prNumber, summary: ciResult.summary, fix_attempt: fixCount + 1 },
      run.workspace_id
    )
  } catch { /* non-critical */ }

  if (fixCount >= MAX_CI_FIX_ATTEMPTS) {
    // Give up — escalate to team lead, do NOT ask the user to manually fix
    await dbRun('UPDATE pipeline_card_runs SET pr_check_json = NULL, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
    const giveUpMsg = [
      `❌ **CI falhou após ${MAX_CI_FIX_ATTEMPTS} tentativas de correção automática** — PR #${prInfo.prNumber}`,
      ``,
      ciResult.summary,
      ciResult.failureDetails ? `\n${ciResult.failureDetails}` : '',
      ``,
      `⚠️ Limite de tentativas automáticas atingido. O time de engenharia será notificado para investigar.`,
    ].filter(Boolean).join('\n')
    await postCardComment(run.provider, cfg, secrets, run.card_key, giveUpMsg)
    await updateRun(run.id, { status: 'waiting_input' })
    return
  }

  // Find the developer agent from any column in this pipeline
  const allColumns = await dbGetAll('SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC', [column.pipeline_id]) as PipelineColumn[]

  let devAgent: AgentFullRow | null = null
  let devAssignment: ColumnAssignment | null = null
  for (const col of allColumns) {
    const assignments = parseAssignments(col)
    const devAssign = assignments.find(a => a.role === 'developer')
    if (devAssign) {
      const agents = await getAgentsByIds([devAssign.agent_id])
      if (agents[0]) {
        devAgent = agents[0]
        devAssignment = devAssign
        break
      }
    }
  }

  if (!devAgent || !devAssignment) {
    // No developer agent found — log and pause, do NOT ask user to manually fix
    await dbRun('UPDATE pipeline_card_runs SET pr_check_json = NULL, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
    const noDevMsg = [
      `❌ **CI falhou** — PR #${prInfo.prNumber}`,
      ``,
      ciResult.summary,
      ``,
      `⚠️ Nenhum agente desenvolvedor encontrado neste pipeline para correção automática. Verifique a configuração da esteira.`,
    ].join('\n')
    await postCardComment(run.provider, cfg, secrets, run.card_key, noDevMsg)
    await updateRun(run.id, { status: 'waiting_input' })
    return
  }

  // Gather full card history to give the developer full context
  const allMessages = (await dbGetAll(`SELECT direction, body FROM pipeline_card_messages WHERE run_id = ? ORDER BY created_at ASC`, [run.id]) as Array<{ direction: string; body: string }>)
    .map(m => m.body)
    .join('\n---\n')

  // Fetch repo context so the developer sees the real codebase when fixing CI errors
  const ciRepoContext = await fetchRepoContext(prInfo.repoId)

  const fixPrompt = [
    `# Correção de CI — ${run.card_key}: ${run.card_title}`,
    ``,
    `## Erros do CI (tentativa ${fixCount + 1}/${MAX_CI_FIX_ATTEMPTS})`,
    ``,
    ciResult.summary,
    ciResult.failureDetails ? `\n**Detalhes:**\n${ciResult.failureDetails}` : '',
    ``,
    ciRepoContext || '',
    ``,
    `## Histórico completo do card`,
    ``,
    allMessages || '(sem histórico anterior)',
  ].filter(s => s !== undefined).join('\n')

  const notifyMsg = [
    `🔧 **CI falhou — agente ${devAgent.name} corrigindo automaticamente** (tentativa ${fixCount + 1}/${MAX_CI_FIX_ATTEMPTS})`,
    ``,
    `**Erros:** ${ciResult.summary}`,
    ciResult.failureDetails ? `\n${ciResult.failureDetails}` : '',
  ].filter(Boolean).join('\n')
  await postCardComment(run.provider, cfg, secrets, run.card_key, notifyMsg)

  try {
    const llmResult = await callAgentLLM(devAgent, fixPrompt, cfg, devAssignment.llm_model, classifyCardComplexity(run.card_title, run.card_description))
    const nowDone = Math.floor(Date.now() / 1000)

    // Log token usage
    try {
      await dbRun(`INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, cost_usd, agent_name, task_id, created_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [llmResult.model, `pipeline-cifix-${run.id}-${devAgent.id}`, llmResult.inputTokens, llmResult.outputTokens, llmResult.costUsd, devAgent.name, null, nowDone, run.workspace_id])
      await dbRun(`UPDATE pipeline_card_runs SET cost_usd = COALESCE(cost_usd, 0) + ?, updated_at = ? WHERE id = ?`, [llmResult.costUsd, nowDone, run.id])
    } catch { /* non-critical */ }

    // Push the fix to GitHub
    const pushResult = await pushCodeToGitHub(prInfo.repoId, run.card_key, run.card_title, llmResult.text)
    if (!pushResult.ok) {
      const pushFailMsg = [
        `⚠️ **${devAgent.name} gerou correção mas falhou ao fazer push**: ${pushResult.message}`,
        ``,
        llmResult.text.slice(0, 1000),
      ].join('\n')
      await postCardComment(run.provider, cfg, secrets, run.card_key, pushFailMsg)
      await logMessage(run.id, 'agent_to_card', prInfo.stageId, pushFailMsg)
      // Still increment counter so we don't loop forever
    } else {
      const fixMsg = [
        `🤖 **${devAgent.name}** corrigiu e fez push na branch \`${pushResult.branch}\``,
        ``,
        `📁 Arquivos: ${pushResult.files?.join(', ')}`,
        `📝 Commit: ${pushResult.message}`,
        ``,
        `⏳ Aguardando CI verificar as correções...`,
      ].join('\n')
      await postCardComment(run.provider, cfg, secrets, run.card_key, fixMsg)
      await logMessage(run.id, 'agent_to_card', prInfo.stageId, fixMsg)
    }

    // Re-arm CI polling with incremented fix count
    const newPrCheckInfo: PRCheckInfo = { ...prInfo, ci_fix_count: fixCount + 1 }
    await dbRun('UPDATE pipeline_card_runs SET pr_check_json = ?, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [JSON.stringify(newPrCheckInfo), run.id])
    await updateRun(run.id, { status: 'waiting_input' })

    try {
      db_helpers.logActivity(
        'pipeline.ci_fix_attempt', 'pipeline_card', run.id, devAgent.name,
        `${devAgent.name} corrigiu CI (tentativa ${fixCount + 1}) — ${run.card_key}`,
        { card_key: run.card_key, card_title: run.card_title, pr_number: prInfo.prNumber, fix_attempt: fixCount + 1, pushed: pushResult.ok },
        run.workspace_id
      )
    } catch { /* non-critical */ }

  } catch (err) {
    logger.error({ err, run_id: run.id }, 'pipeline-engine: CI auto-fix LLM call failed')
    // Re-arm with same count so it retries the fix call next tick
    await dbRun('UPDATE pipeline_card_runs SET pr_check_json = ?, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [JSON.stringify(prInfo), run.id])
    await updateRun(run.id, { status: 'waiting_input' })
  }
}

// ─── LLM caller ───────────────────────────────────────────────────────────────

async function dispatchLLM(agent: AgentFullRow, prompt: string, cfg: WorkPipelineConfigJson, provider: string, model: string | null): Promise<LLMResult> {
  const apiKey = await resolveApiKey(provider)
  switch (provider) {
    case 'gemini':    return callGeminiLLM(agent, prompt, apiKey, model)
    case 'ollama':    return callOllamaLLM(agent, prompt, cfg, model)
    case 'openai':
    case 'openrouter':
    case 'venice':
    case 'nvidia':
    case 'moonshot':
    case 'deepseek':
    case 'groq':      return callOpenAICompatLLM(agent, prompt, provider, apiKey, model)
    default:          return callAnthropicLLM(agent, prompt, apiKey ?? '', model)
  }
}

async function callAgentLLM(
  agent: AgentFullRow,
  prompt: string,
  cfg: WorkPipelineConfigJson,
  assignmentModel?: string,
  complexity?: 'simple' | 'medium' | 'complex',
): Promise<LLMResult> {
  const primary = resolveProviderAndModel(cfg, assignmentModel, complexity)

  try {
    return await dispatchLLM(agent, prompt, cfg, primary.provider, primary.model)
  } catch (primaryErr: any) {
    const fallbackMode = (cfg.llm_fallback_mode || 'none').trim()
    if (fallbackMode === 'none') throw primaryErr

    // Build ordered list of fallback model strings to try
    const fallbackCandidates: string[] = []
    if (fallbackMode === 'fixed') {
      const fb = (cfg.llm_fallback_model || '').trim()
      if (fb) fallbackCandidates.push(fb)
    } else if (fallbackMode === 'cascade') {
      // Try remaining configured tiers in order: complex → medium → simple
      const cascade = [cfg.llm_complex, cfg.llm_medium, cfg.llm_simple].filter(Boolean) as string[]
      const usedRaw = assignmentModel?.trim() || (primary.model ? `${primary.provider}:${primary.model}` : primary.provider)
      for (const m of cascade) {
        if (m.trim() !== usedRaw) fallbackCandidates.push(m.trim())
      }
    }

    const maxAttempts = Math.max(1, Number(cfg.llm_fallback_max_attempts ?? 2))
    let lastErr: any = primaryErr
    for (const fb of fallbackCandidates.slice(0, maxAttempts)) {
      try {
        const { provider: fbProv, model: fbModel } = parseProviderModel(fb)
        logger.warn({ primary: primary.provider, fallback: fb }, 'pipeline-engine: primary LLM failed, trying fallback')
        return await dispatchLLM(agent, prompt, cfg, fbProv, fbModel)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }
}

// Directories and files that should never be sent as context
const REPO_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.next', '.nuxt',
  '__pycache__', 'vendor', '.gradle', 'out', 'coverage', '.nyc_output',
  'venv', '.venv', 'env', '.env', '.idea', '.vscode', 'bin', 'obj',
  'Pods', 'DerivedData', '.dart_tool', '.pub-cache',
])

// Source file extensions by language family
const SOURCE_EXTS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  java:       ['.java'],
  kotlin:     ['.kt', '.kts'],
  python:     ['.py'],
  go:         ['.go'],
  rust:       ['.rs'],
  csharp:     ['.cs'],
  ruby:       ['.rb'],
  php:        ['.php'],
  swift:      ['.swift'],
  dart:       ['.dart'],
  scala:      ['.scala'],
  cpp:        ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
  c:          ['.c', '.h'],
}

// Root-level manifest files that reveal project type
const MANIFEST_HINTS: Record<string, string[]> = {
  'package.json':      ['typescript', 'javascript'],
  'pom.xml':           ['java'],
  'build.gradle':      ['java', 'kotlin'],
  'build.gradle.kts':  ['kotlin'],
  'pyproject.toml':    ['python'],
  'requirements.txt':  ['python'],
  'setup.py':          ['python'],
  'go.mod':            ['go'],
  'Cargo.toml':        ['rust'],
  'pubspec.yaml':      ['dart'],
  'Package.swift':     ['swift'],
}

// Config/architecture files worth reading regardless of language
const ARCH_FILES = [
  'README.md', 'README.mdx', 'ARCHITECTURE.md', 'docs/ARCHITECTURE.md',
  'package.json', 'tsconfig.json', 'next.config.ts', 'next.config.js',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'src/main/resources/application.properties',
  'src/main/resources/application.yml',
  '.env.example', 'prisma/schema.prisma',
]

const MAX_TOTAL_CHARS = 160_000  // ~40K tokens — enough for most repos, leaves room for the prompt
const MAX_FILE_CHARS  =  30_000  // truncate very large individual files

async function fetchRepoContext(repoId: number): Promise<string> {
  const repo = await dbGet('SELECT repo_url, access_token, branch, provider, base_url FROM git_repositories WHERE id = ?', [repoId]) as
    | { repo_url: string; access_token: string | null; branch: string; provider: string | null; base_url: string | null }
    | undefined
  if (!repo?.access_token) return ''

  // Narrow access_token to string after the null guard above
  const repoWithToken = repo as typeof repo & { access_token: string }

  // Route to the correct provider API based on the configured URL
  const isGitHub = /github\.com\//.test(repo.repo_url)
  const isBitbucket = /bitbucket\.org\//.test(repo.repo_url)
  if (isGitHub) {
    return fetchRepoContextGitHub(repoWithToken)
  } else if (isBitbucket) {
    return fetchRepoContextBitbucket(repoWithToken)
  } else {
    return fetchRepoContextGitLab(repoWithToken)
  }
}

async function fetchRepoContextGitLab(
  repo: { repo_url: string; access_token: string; branch: string; base_url?: string | null }
): Promise<string> {
  try {
    const u = new URL(repo.repo_url)
    const origin = (repo.base_url || u.origin).replace(/\/+$/, '')
    const projectPath = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
    if (!projectPath) return ''

    const api = `${origin}/api/v4/projects/${encodeURIComponent(projectPath)}`
    const headers: Record<string, string> = { 'PRIVATE-TOKEN': repo.access_token }
    const ref = (repo.branch || '').trim() || 'main'

    // Get default branch if configured one doesn't exist
    let baseBranch = ref
    const branchCheck = await fetch(`${api}/repository/branches/${encodeURIComponent(baseBranch)}`, { headers, signal: AbortSignal.timeout(10_000) })
    if (!branchCheck.ok) {
      const proj = await fetch(api, { headers, signal: AbortSignal.timeout(10_000) })
      if (!proj.ok) return ''
      const projData = await proj.json() as { default_branch?: string }
      baseBranch = projData.default_branch || 'main'
    }

    // Get file tree via GitLab API
    const treeResp = await fetch(`${api}/repository/tree?recursive=true&ref=${encodeURIComponent(baseBranch)}&per_page=500`, { headers, signal: AbortSignal.timeout(30_000) })
    if (!treeResp.ok) return ''
    const treeData = await treeResp.json() as Array<{ path: string; type: string; name: string }>

    const readFile = async (path: string): Promise<string | null> => {
      try {
        const res = await fetch(`${api}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(baseBranch)}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return null
        return await res.text()
      } catch { return null }
    }

    return buildRepoContextFromTree(
      treeData.map(i => ({ path: i.path, type: i.type === 'tree' ? 'tree' : 'blob' as 'blob' | 'tree' })),
      readFile,
      repo.repo_url,
      baseBranch,
    )
  } catch { return '' }
}

async function fetchRepoContextBitbucket(
  repo: { repo_url: string; access_token: string; branch: string }
): Promise<string> {
  try {
    // URL format: https://bitbucket.org/{workspace}/{slug}
    const match = repo.repo_url.match(/bitbucket\.org\/([^/]+)\/([^/.]+)/)
    if (!match) return ''
    const [, workspace, slug] = match
    const ref = (repo.branch || 'main').trim()
    const apiBase = `https://api.bitbucket.org/2.0/repositories/${workspace}/${slug}`

    // Bitbucket uses Basic auth: "username:app_password" or Bearer token
    const authHeader = repo.access_token.includes(':')
      ? `Basic ${Buffer.from(repo.access_token).toString('base64')}`
      : `Bearer ${repo.access_token}`
    const headers: Record<string, string> = { Authorization: authHeader }

    const readFile = async (path: string): Promise<string | null> => {
      try {
        const res = await fetch(`${apiBase}/src/${encodeURIComponent(ref)}/${path}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return null
        return await res.text()
      } catch { return null }
    }

    // Bitbucket src API with format=meta returns file tree entries
    // Use pagination to get up to 500 entries
    const treeItems: Array<{ path: string; type: 'blob' | 'tree' }> = []
    let nextUrl: string | null = `${apiBase}/src/${encodeURIComponent(ref)}/?format=meta&pagelen=100&fields=values.path,values.type,next`
    let pages = 0
    while (nextUrl && pages < 5) {
      try {
        const res = await fetch(nextUrl, { headers, signal: AbortSignal.timeout(15_000) })
        if (!res.ok) break
        const data = await res.json() as { values: Array<{ path: string; type: string }>; next?: string }
        for (const item of data.values ?? []) {
          treeItems.push({ path: item.path, type: item.type === 'commit_directory' ? 'tree' : 'blob' })
        }
        nextUrl = data.next ?? null
        pages++
      } catch { break }
    }

    return buildRepoContextFromTree(treeItems, readFile, repo.repo_url, ref)
  } catch { return '' }
}

async function fetchRepoContextGitHub(
  repo: { repo_url: string; access_token: string; branch: string }
): Promise<string> {
  const urlMatch = repo.repo_url.match(/github\.com\/([^/]+)\/([^/.]+)/)
  if (!urlMatch) return ''
  const [, owner, repoName] = urlMatch
  const ref = repo.branch || 'main'
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${repo.access_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const readFile = async (path: string): Promise<string | null> => {
    try {
      const res = await fetch(`${apiBase}/contents/${path}?ref=${ref}`, { headers, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return null
      const f = await res.json() as { content?: string; size?: number }
      if ((f.size ?? 0) > 500_000) return '[arquivo omitido — muito grande]'
      return f.content ? Buffer.from(f.content, 'base64').toString('utf-8') : null
    } catch { return null }
  }

  // Get full tree via GitHub API
  async function getFullTree(): Promise<Array<{ path: string; type: 'blob' | 'tree'; size?: number }>> {
    try {
      const refResp = await fetch(`${apiBase}/git/ref/heads/${ref}`, { headers, signal: AbortSignal.timeout(10_000) })
      if (!refResp.ok) return []
      const refData = await refResp.json() as { object: { sha: string } }
      const commitResp = await fetch(`${apiBase}/git/commits/${refData.object.sha}`, { headers, signal: AbortSignal.timeout(10_000) })
      if (!commitResp.ok) return []
      const commitData = await commitResp.json() as { tree: { sha: string } }
      const treeResp = await fetch(`${apiBase}/git/trees/${commitData.tree.sha}?recursive=1`, { headers, signal: AbortSignal.timeout(30_000) })
      if (!treeResp.ok) return []
      const treeData = await treeResp.json() as { tree: Array<{ path: string; type: string; size?: number }> }
      return (treeData.tree || []) as Array<{ path: string; type: 'blob' | 'tree'; size?: number }>
    } catch { return [] }
  }

  const rawTree = await getFullTree()
  return buildRepoContextFromTree(rawTree, readFile, repo.repo_url, ref)
}

async function buildRepoContextFromTree(
  rawTree: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>,
  readFile: (path: string) => Promise<string | null>,
  repoUrl: string,
  ref: string,
): Promise<string> {
  if (rawTree.length === 0) return ''

  // Filter out ignored dirs
  const tree = rawTree.filter(item => {
    const segments = item.path.split('/')
    return !segments.some(s => REPO_IGNORE_DIRS.has(s))
  })

  const rootFileNames = new Set(
    tree.filter(i => i.type === 'blob' && !i.path.includes('/')).map(i => i.path)
  )

  // ── Detect project languages from manifest files ──────────────────────────────

  const detectedLangs = new Set<string>()
  for (const [manifest, langs] of Object.entries(MANIFEST_HINTS)) {
    if (rootFileNames.has(manifest)) langs.forEach(l => detectedLangs.add(l))
  }
  // Also detect by file extensions present if manifests gave no hints
  if (detectedLangs.size === 0) {
    for (const item of tree) {
      if (item.type !== 'blob') continue
      const ext = item.path.includes('.') ? item.path.slice(item.path.lastIndexOf('.')) : ''
      for (const [lang, exts] of Object.entries(SOURCE_EXTS)) {
        if (exts.includes(ext)) { detectedLangs.add(lang); break }
      }
    }
  }

  const validExts = new Set([...detectedLangs].flatMap(l => SOURCE_EXTS[l] ?? []))

  // ── Build architecture tree string ────────────────────────────────────────────

  function buildTreeDisplay(): string {
    const dirs = new Set(tree.filter(i => i.type === 'tree').map(i => i.path))
    const lines: string[] = []

    // Top-level entries
    const top = tree.filter(i => !i.path.includes('/'))
    for (const item of top) {
      const icon = item.type === 'tree' ? '📁' : '📄'
      lines.push(`${icon} ${item.path}`)
    }

    // First-level subdirectories with their contents
    for (const dir of [...dirs].filter(d => !d.includes('/')).sort()) {
      const children = tree
        .filter(i => i.path.startsWith(dir + '/') && i.path.split('/').length === 2)
        .map(i => `  ${i.type === 'tree' ? '📁' : '📄'} ${i.path.slice(dir.length + 1)}`)
      if (children.length) lines.push(...children)

      // Second level (show structure depth without reading every file)
      const subdirs = tree.filter(i => i.type === 'tree' && i.path.startsWith(dir + '/') && i.path.split('/').length === 2)
      for (const sub of subdirs) {
        const grandchildren = tree
          .filter(i => i.path.startsWith(sub.path + '/') && i.path.split('/').length === 3)
          .map(i => `    ${i.type === 'tree' ? '📁' : '📄'} ${i.path.slice(sub.path.length + 1)}`)
        if (grandchildren.length) lines.push(...grandchildren.slice(0, 20))
        if (grandchildren.length > 20) lines.push(`    ... +${grandchildren.length - 20} arquivos`)
      }
    }

    return lines.slice(0, 300).join('\n')
  }

  // ── Source files to read — sorted by priority ─────────────────────────────────
  // Priority: src/ > lib/ > app/ > main > tests
  function fileScore(path: string): number {
    if (/\.(test|spec)\.[a-z]+$/.test(path)) return 2    // tests last
    if (/\/(test|tests|__tests__|spec|specs)\//.test(path)) return 2
    if (/\/(src|lib|app|main|source|core)\//i.test(path)) return 0  // source first
    return 1
  }

  const sourceFiles = tree
    .filter(i => {
      if (i.type !== 'blob') return false
      if ((i.size ?? 0) > 300_000) return false
      const ext = i.path.includes('.') ? i.path.slice(i.path.lastIndexOf('.')) : ''
      return validExts.has(ext)
    })
    .sort((a, b) => fileScore(a.path) - fileScore(b.path) || a.path.localeCompare(b.path))

  // ── Assemble context ──────────────────────────────────────────────────────────

  const parts: string[] = []
  let totalChars = 0

  const langs = [...detectedLangs].join(', ') || 'desconhecida'
  const repoLabel = repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/')
  parts.push([
    `## ⚠️ CONTEXTO OBRIGATÓRIO DO REPOSITÓRIO \`${repoLabel}\` — leia TUDO antes de gerar qualquer código`,
    ``,
    `> Linguagem(s) detectada(s): **${langs}**`,
    `> Você DEVE seguir EXATAMENTE a arquitetura, módulos, classes e padrões abaixo.`,
    `> NÃO crie arquivos, classes ou funções que contradijam a estrutura existente.`,
    `> NÃO invente imports. Use APENAS o que está listado neste contexto.`,
    `> Ao gerar código novo, use o formato: \`### FILE: caminho/do/arquivo.ext\` seguido do bloco de código.`,
  ].join('\n'))
  totalChars += parts[0].length

  // Directory tree
  const treeDisplay = buildTreeDisplay()
  const treeSection = `\n### Estrutura do projeto\n\`\`\`\n${treeDisplay}\n\`\`\``
  parts.push(treeSection)
  totalChars += treeSection.length

  // Architecture/config files
  for (const archFile of ARCH_FILES) {
    if (!tree.some(i => i.type === 'blob' && i.path === archFile)) continue
    const content = await readFile(archFile)
    if (!content) continue
    const ext = archFile.includes('.') ? archFile.slice(archFile.lastIndexOf('.') + 1) : ''
    const langHint = ['json','xml','yaml','yml','toml','md','mdx','prisma'].includes(ext) ? ext : ''
    const section = `\n### ${archFile}\n\`\`\`${langHint}\n${content.slice(0, 8_000)}\n\`\`\``
    parts.push(section)
    totalChars += section.length
  }

  // All source files within budget
  if (sourceFiles.length > 0) {
    parts.push(`\n### Código-fonte (${sourceFiles.length} arquivo${sourceFiles.length > 1 ? 's' : ''} — USE esta estrutura exata)`)
  }

  for (const file of sourceFiles) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      parts.push(`\n> ⚠️ Orçamento de contexto atingido — ${sourceFiles.length - sourceFiles.indexOf(file)} arquivo(s) omitido(s). Os arquivos mais relevantes já foram incluídos acima.`)
      break
    }
    const content = await readFile(file.path)
    if (!content) continue
    const ext = file.path.includes('.') ? file.path.slice(file.path.lastIndexOf('.') + 1) : ''
    const body = content.length > MAX_FILE_CHARS
      ? content.slice(0, MAX_FILE_CHARS) + `\n// ... [${file.path} truncado — ${content.length - MAX_FILE_CHARS} chars omitidos]`
      : content
    const section = `\n#### 📄 ${file.path}\n\`\`\`${ext}\n${body}\n\`\`\``
    parts.push(section)
    totalChars += section.length
  }

  return parts.join('\n')
}

function buildPrompt(
  card: { card_key: string; card_title: string; card_description: string; card_url: string },
  column: PipelineColumn,
  previousMessages: string,
  agentName?: string,
  agentRole?: string,
  repoContexts?: Array<{ name: string; context: string }> | string,  // multi-repo or legacy single string
  hasRepo?: boolean
): string {
  const hasInstructions = !!column.instructions?.trim()

  // Normalise repoContexts to array format
  const repos: Array<{ name: string; context: string }> =
    Array.isArray(repoContexts)
      ? repoContexts
      : repoContexts
        ? [{ name: 'repositório', context: repoContexts }]
        : []

  const multiRepo = repos.length > 1

  const repoContextBlock = repos.length > 0
    ? repos.map(r => r.context ? `${r.context}` : '').filter(Boolean).join('\n\n')
    : ''

  const commitInstructions = hasRepo ? [
    '',
    '## Formato de entrega de código',
    '',
    multiRepo
      ? [
          'Este card envolve **múltiplos repositórios**. Ao gerar ou modificar arquivos, indique OBRIGATORIAMENTE o repositório de destino usando o prefixo entre colchetes:',
          '',
          '```',
          `### FILE: [nome-do-repositorio]: caminho/relativo/do/arquivo.ext`,
          '```linguagem',
          '// conteúdo completo do arquivo aqui',
          '```',
          'COMMIT: tipo(escopo): descrição curta do que foi feito',
          '```',
          '',
          'Repositórios disponíveis neste card:',
          ...repos.map(r => `- **[${r.name}]**`),
          '',
          'Exemplo:',
          '```',
          `### FILE: [${repos[0].name}]: src/services/UserService.java`,
          '```java',
          'public class UserService { ... }',
          '```',
          `### FILE: [${repos[1]?.name ?? repos[0].name}]: src/components/Login.tsx`,
          '```tsx',
          'export function Login() { ... }',
          '```',
          'COMMIT: feat(auth): implement login feature',
          '```',
        ].join('\n')
      : [
          'Quando produzir ou modificar arquivos, use OBRIGATORIAMENTE este formato para cada arquivo:',
          '',
          '```',
          '### FILE: caminho/relativo/do/arquivo.ext',
          '```linguagem',
          '// conteúdo completo do arquivo aqui',
          '```',
          'COMMIT: tipo(escopo): descrição curta do que foi feito',
          '```',
          '',
          'Inclua o conteúdo COMPLETO de cada arquivo, não trechos parciais.',
        ].join('\n'),
  ].join('\n') : ''

  const parts = [
    `# Card: ${card.card_key} — ${card.card_title}`,
    `URL: ${card.card_url}`,
    '',
    '## Descrição do card',
    card.card_description || '(sem descrição)',
    '',
    agentName ? `Você é **${agentName}**${agentRole ? `, ${agentRole}` : ''}.` : '',
    '',
    previousMessages ? `## Contexto dos agentes anteriores nesta mesma etapa\n${previousMessages}\n` : '',
    repoContextBlock,
    commitInstructions,
    hasInstructions
      ? `## Suas instruções\n\nSiga EXATAMENTE as instruções abaixo. Elas têm prioridade absoluta sobre qualquer outra orientação.\n\n${column.instructions}`
      : `## Estágio atual: ${column.column_name}\n\nAnalise o card e produza uma entrega relevante para sua função.`,
  ]
  return parts.filter(Boolean).join('\n')
}

async function getLastAgentMessages(runId: number, limit = 3): Promise<string> {
  const rows = await dbGetAll<{ body: string; stage_id: string }>(
    `SELECT body, stage_id FROM pipeline_card_messages WHERE run_id = ? AND direction = 'agent_to_card' ORDER BY created_at DESC LIMIT ?`,
    [runId, limit]
  )
  return rows
    .reverse()
    .map((r) => `[stage ${r.stage_id}]: ${r.body}`)
    .join('\n---\n')
}

async function createAgentTask(
  run: PipelineCardRun,
  column: PipelineColumn,
  agent: AgentRow,
  description: string,
  isUserReply = false,
  llmModel?: string,
): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000)
  const title = isUserReply
    ? `[Reply] ${run.card_key}: ${column.column_name}`
    : `${run.card_key}: ${column.column_name}`

  const metadata = JSON.stringify({
    pipeline_run_id: run.id,
    stage_id: String(column.id),
    card_key: run.card_key,
    provider: run.provider,
    is_user_reply: isUserReply,
    ...(llmModel ? { llm_model: llmModel } : {}),
  })

  try {
    const result = await dbRun(
      `INSERT INTO tasks (title, description, status, priority, assigned_to, created_by, created_at, updated_at, metadata, workspace_id) VALUES (?, ?, 'assigned', 'high', ?, 'pipeline-engine', ?, ?, ?, ?)`,
      [title, description, agent.name, now, now, metadata, run.workspace_id]
    )
    return result.insertId
  } catch (err) {
    logger.warn({ err }, 'pipeline-engine: failed to create task')
    return null
  }
}

// ─── Card operations (provider-agnostic) ─────────────────────────────────────

async function postCardComment(
  provider: string,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  body: string
): Promise<string | null> {
  try {
    if (provider === 'jira') {
      const r = await postJiraComment(cfg, secrets, cardKey, body)
      return r.commentId
    }
    if (provider === 'azure_devops') {
      const r = await postAzureComment(cfg, secrets, cardKey, body)
      return r.commentId
    }
  } catch (err) {
    logger.warn({ err, cardKey }, 'pipeline-engine: failed to post card comment')
  }
  return null
}

async function fetchNewCardComments(
  provider: string,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  afterMs: number
): Promise<Array<{ id: string; author: string; body: string; createdMs: number }>> {
  try {
    if (provider === 'jira') {
      const comments = await getJiraCommentsSince(cfg, secrets, cardKey, afterMs)
      return comments.map((c) => ({ id: c.id, author: c.authorDisplayName, body: c.body, createdMs: c.createdMs }))
    }
    if (provider === 'azure_devops') {
      const comments = await getAzureCommentsSince(cfg, secrets, cardKey, afterMs)
      return comments.map((c) => ({ id: c.id, author: c.authorDisplayName, body: c.body, createdMs: c.createdMs }))
    }
  } catch (err) {
    logger.warn({ err, cardKey }, 'pipeline-engine: failed to fetch card comments')
  }
  return []
}

async function moveCard(
  provider: string,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  targetStatus: string
): Promise<void> {
  try {
    if (provider === 'jira') {
      await transitionJiraIssue(cfg, secrets, cardKey, targetStatus)
    } else if (provider === 'azure_devops') {
      await moveAzureWorkItem(cfg, secrets, cardKey, targetStatus)
    }
  } catch (err) {
    logger.warn({ err, cardKey, targetStatus }, 'pipeline-engine: failed to move card')
  }
}

// ─── Stage lifecycle ──────────────────────────────────────────────────────────

async function startColumn(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
): Promise<void> {
  // Guard: if this run has been reprocessed too many times, give up to avoid infinite loops
  const MAX_RUN_ATTEMPTS = 10
  if ((run.run_count ?? 1) > MAX_RUN_ATTEMPTS) {
    const msg = `🛑 **${run.card_key}** — execução cancelada após ${run.run_count} tentativas sem sucesso.`
    logger.error({ run_id: run.id, card_key: run.card_key, run_count: run.run_count }, 'pipeline-engine: run exceeded max attempts, cancelling')
    await postCardComment(run.provider, cfg, secrets, run.card_key, msg).catch(() => {})
    await updateRun(run.id, { status: 'failed' })
    return
  }

  const assignments = parseAssignments(column).sort((a, b) => a.order - b.order)
  const agentMap = new Map((await getAgentsByIds(assignments.map(a => a.agent_id))).map((ag: AgentFullRow) => [ag.id, ag] as [number, AgentFullRow]))
  const stageId = String(column.id)

  if (!agentMap.size) {
    const noAgentMsg = `⏸️ **${column.column_name}** — aguardando atribuição de agente.`
    const cid = await postCardComment(run.provider, cfg, secrets, run.card_key, noAgentMsg)
    await logMessage(run.id, 'agent_to_card', stageId, noAgentMsg, cid ?? undefined)
    await updateRun(run.id, { status: 'waiting_input', current_stage_id: stageId })
    return
  }

  const agents = assignments.map(a => agentMap.get(a.agent_id)).filter(Boolean) as AgentFullRow[]

  if (!agents.length) {
    const noAgentMsg = `⏸️ **${column.column_name}** — todos os agentes atribuídos são inválidos ou nulos.`
    const cid = await postCardComment(run.provider, cfg, secrets, run.card_key, noAgentMsg)
    await logMessage(run.id, 'agent_to_card', stageId, noAgentMsg, cid ?? undefined)
    await updateRun(run.id, { status: 'waiting_input', current_stage_id: stageId })
    return
  }
  // Determine which agents already completed this stage (to resume from failure point)
  const completedAgentIds = new Set<number>(
    (await dbGetAll(`SELECT DISTINCT body FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND body LIKE '🤖 **%'`, [run.id, stageId]) as { body: string }[])
      .map(row => {
        const match = row.body.match(/^🤖 \*\*(.+?)\*\*/)
        if (!match) return null
        const name = match[1]
        const found = agents.find(a => a.name === name)
        return found ? found.id : null
      })
      .filter((id): id is number => id !== null)
  )

  const pendingAgents = agents.filter(a => !completedAgentIds.has(a.id))

  // If all agents already completed, just advance (idempotent retry)
  if (pendingAgents.length === 0) {
    await advanceToNextColumn(run, column, cfg, secrets, '')
    return
  }

  // Only post "stage starting" on first agent of this stage
  if (completedAgentIds.size === 0) {
    const agentList = agents.map((a, i) => `${i + 1}. **${a.name}** *(${a.role})*${a.instructions ? ` — ${a.instructions.split('\n')[0].slice(0, 120)}` : ''}`).join('\n')
    const startMsg = [
      `🚀 **Etapa iniciada: ${column.column_name}**`,
      '',
      column.instructions ? `📌 *${column.instructions.split('\n')[0].slice(0, 200)}*\n` : '',
      `**Agente${agents.length > 1 ? 's' : ''} em execução:**`,
      agentList,
      '',
      `⏳ Processando ${run.card_key}...`,
    ].filter(l => l !== undefined).join('\n')
    const startCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, startMsg)
    await logMessage(run.id, 'agent_to_card', stageId, startMsg, startCommentId ?? undefined)
  } else {
    const resumeMsg = `🔄 **Retomando ${column.column_name}** a partir de **${pendingAgents[0].name}** (${completedAgentIds.size}/${agents.length} agentes já concluídos)`
    const resumeId = await postCardComment(run.provider, cfg, secrets, run.card_key, resumeMsg)
    await logMessage(run.id, 'agent_to_card', stageId, resumeMsg, resumeId ?? undefined)
  }

  await updateRun(run.id, { current_stage_id: stageId, status: 'running' })
  eventBus.broadcast('pipeline.stage_started', { run_id: run.id, card_key: run.card_key, stage: column.column_name, agent: pendingAgents[0].name })

  // Carry forward output from already-completed agents as context
  const outputParts: string[] = (await dbGetAll(`SELECT body FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND body LIKE '🤖 **%' ORDER BY created_at ASC`, [run.id, stageId]) as { body: string }[]).map(r => r.body)

  // Resolve the active repository for this stage.
  // Priority: assignment dropdown > linkedRepoIds (first valid with token) > any workspace repo with token
  // IDs in linkedRepoIds that no longer exist or have no token are silently skipped.
  async function resolveActiveRepo(workspaceId: number): Promise<number | null> {
    // 1. Per-agent dropdown
    const fromAssignment = assignments.find(a => a.repo_id)?.repo_id
    logger.info({ run_id: run.id, workspaceId, fromAssignment, linkedRepoIds_raw: (cfg as any).linkedRepoIds }, 'resolveActiveRepo: starting')

    if (fromAssignment) {
      const r = await dbGet<{ id: number }>('SELECT id FROM git_repositories WHERE id = ? AND is_active = 1', [fromAssignment])
      logger.info({ run_id: run.id, fromAssignment, found: !!r?.id }, 'resolveActiveRepo: assignment check')
      if (r?.id) return r.id
    }

    // 2. Repos linked in "Repositórios do sistema" — skip deleted or token-less ones
    const linkedIds: number[] = Array.isArray((cfg as any).linkedRepoIds) ? (cfg as any).linkedRepoIds as number[] : []
    logger.info({ run_id: run.id, workspaceId, linkedIds }, 'resolveActiveRepo: checking linkedRepoIds')
    for (const rid of linkedIds) {
      const r = await dbGet<{ id: number; access_token: string | null }>(
        'SELECT id, access_token FROM git_repositories WHERE id = ? AND workspace_id = ? AND is_active = 1',
        [rid, workspaceId]
      )
      logger.info({ run_id: run.id, rid, found: !!r?.id, has_token: !!(r?.access_token?.trim()) }, 'resolveActiveRepo: linkedId check')
      if (r?.id && r.access_token && r.access_token.trim()) return r.id
    }

    // 3. Any active repo in the workspace with a token — most recently created first
    const allRepos = await dbGetAll<{ id: number; name: string; access_token: string | null; workspace_id: number; is_active: number }>(
      'SELECT id, name, access_token, workspace_id, is_active FROM git_repositories WHERE workspace_id = ? ORDER BY created_at DESC',
      [workspaceId]
    )
    logger.info({ run_id: run.id, workspaceId, total_repos: allRepos.length, repos: allRepos.map(r => ({ id: r.id, name: r.name, is_active: r.is_active, has_token: !!(r.access_token?.trim()) })) }, 'resolveActiveRepo: all repos in workspace')

    const r = allRepos.find(repo => repo.is_active && repo.access_token && repo.access_token.trim())
    if (r?.id) {
      logger.info({ run_id: run.id, workspaceId, repoId: r.id, repoName: r.name }, 'pipeline-engine: using workspace fallback repo')
      return r.id
    }
    logger.warn({ run_id: run.id, workspaceId }, 'resolveActiveRepo: NO valid repo found in workspace')
    return null
  }

  const stageRepoId = await resolveActiveRepo(run.workspace_id)
  logger.info({ run_id: run.id, stageRepoId, workspace_id: run.workspace_id }, 'pipeline-engine: stageRepoId resolved')
  // Load context for ALL linked repos so the agent understands the full codebase
  const linkedRepoIds: number[] = Array.isArray((cfg as any).linkedRepoIds)
    ? (cfg as any).linkedRepoIds as number[]
    : stageRepoId ? [stageRepoId] : []

  // Validate IDs exist and build repo info list
  const stageRepos: Array<{ id: number; name: string; context: string }> = []
  for (const rid of linkedRepoIds.length > 0 ? linkedRepoIds : (stageRepoId ? [stageRepoId] : [])) {
    const repoRow = await dbGet<{ id: number; name: string; repo_url: string; access_token: string | null }>(
      `SELECT id, name, repo_url, access_token FROM git_repositories
       WHERE id = ? AND workspace_id = ? AND is_active = 1
         AND access_token IS NOT NULL AND access_token != ''`,
      [rid, run.workspace_id]
    )
    if (!repoRow) continue
    const ctx = await fetchRepoContext(repoRow.id)
    stageRepos.push({ id: repoRow.id, name: repoRow.name, context: ctx })
  }

  // Fallback: if no linked repos resolved, try workspace default
  if (stageRepos.length === 0 && stageRepoId) {
    const ctx = await fetchRepoContext(stageRepoId)
    const repoRow = await dbGet<{ name: string }>(
      'SELECT name FROM git_repositories WHERE id = ?', [stageRepoId]
    )
    stageRepos.push({ id: stageRepoId, name: repoRow?.name ?? 'repositório', context: ctx })
  }

  const hasRepo = stageRepos.length > 0

  for (const assignment of assignments) {
    const agent = agentMap.get(assignment.agent_id)
    if (!agent) continue
    // Skip agents that already completed this stage
    if (completedAgentIds.has(agent.id)) continue

    const nowBusy = Math.floor(Date.now() / 1000)
    await dbRun(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE id = ?`, [`Pipeline: ${run.card_key} — ${column.column_name}`, nowBusy, nowBusy, agent.id])

    const previousMessages = await getLastAgentMessages(run.id)
    const contextSoFar = outputParts.length ? `## Outputs anteriores nesta etapa\n${outputParts.join('\n---\n')}\n\n` : ''
    const agentSkills = await loadAgentSkills(run.workspace_id)
    // Use the agent's own repo_id, or fall back to the stage-level repo (pipeline default)
    const effectiveRepoId = assignment.repo_id ?? stageRepoId ?? null
    logger.info({ run_id: run.id, agent: agent.name, assignment_repo_id: assignment.repo_id, stageRepoId, effectiveRepoId }, 'pipeline-engine: effectiveRepoId for agent')
    const prompt = contextSoFar + buildPrompt(run, column, previousMessages, agent.name, agent.role, stageRepos, hasRepo)
    const taskId = await createAgentTask(run, column, agent, prompt, false, assignment.llm_model)
    await updateRun(run.id, { task_id: taskId ?? undefined })

    try {
      const agentWithSkills = { ...agent, _skills: agentSkills }
      const llmResult = await callAgentLLM(agentWithSkills as AgentFullRow, prompt, cfg, assignment.llm_model, classifyCardComplexity(run.card_title, run.card_description))
      const nowDone = Math.floor(Date.now() / 1000)

      try {
        await dbRun(`INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, cost_usd, agent_name, task_id, created_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [llmResult.model, `pipeline-${run.id}-${column.id}-${agent.id}`, llmResult.inputTokens, llmResult.outputTokens, llmResult.costUsd, agent.name, taskId ?? null, nowDone, run.workspace_id])
        await dbRun(`UPDATE pipeline_card_runs SET cost_usd = COALESCE(cost_usd, 0) + ?, updated_at = ? WHERE id = ?`, [llmResult.costUsd, nowDone, run.id])
        const cur = (await dbGet('SELECT llm_models FROM pipeline_card_runs WHERE id = ?', [run.id]) as { llm_models: string } | null)?.llm_models ?? ''
        const modelSet = new Set(cur ? cur.split(',') : [])
        modelSet.add(llmResult.model)
        await dbRun('UPDATE pipeline_card_runs SET llm_models = ? WHERE id = ?', [[...modelSet].join(','), run.id])
      } catch (tokenErr) {
        logger.warn({ tokenErr }, 'pipeline-engine: failed to log token usage')
      }

      if (taskId) {
        await dbRun(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?`, [nowDone, taskId])
        await dbRun(`INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`, [taskId, agent.name, llmResult.text, nowDone, run.workspace_id])
      }
      await dbRun(`UPDATE agents SET status = 'idle', last_activity = ?, updated_at = ? WHERE id = ?`, [`Concluiu ${run.card_key} — ${column.column_name}`, nowDone, agent.id])

      // Post each agent's structured output as a separate Jira comment immediately
      const agentComment = [
        `🤖 **${agent.name}** *(${agent.role})* — **${column.column_name}**`,
        '',
        llmResult.text,
        '',
        `---`,
        `*Modelo: ${llmResult.model} | Tokens: ${llmResult.inputTokens} in / ${llmResult.outputTokens} out${llmResult.costUsd > 0 ? ` | Custo: $${llmResult.costUsd.toFixed(4)}` : ''}*`,
      ].join('\n')
      const agentCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, agentComment)
      await logMessage(run.id, 'agent_to_card', stageId, agentComment, agentCommentId ?? undefined)

      try {
        db_helpers.logActivity(
          'pipeline.agent_completed',
          'task',
          taskId ?? 0,
          agent.name,
          `${agent.name} concluiu "${column.column_name}" — ${run.card_key}`,
          { card_key: run.card_key, card_title: run.card_title, stage: column.column_name, role: agent.role, model: llmResult.model, tokens: llmResult.inputTokens + llmResult.outputTokens, cost_usd: llmResult.costUsd },
          run.workspace_id
        )
      } catch { /* non-critical */ }

      // If this is a software architect with a linked repo, push any fixes then merge to main
      if (assignment.role === 'software architect' && effectiveRepoId) {
        try {
          // If the architect generated FILE/ARQUIVO blocks (corrections), push them before merging
          if (/###\s*(?:FILE|ARQUIVO):/i.test(llmResult.text)) {
            const pushResults = await pushFilesToRepos(llmResult.text, run.card_key, run.card_title, stageRepos, effectiveRepoId)
            for (const pr of pushResults) {
              if (pr.ok) {
                const archFixMsg = [`🔧 **${agent.name} aplicou correções** → \`${pr.repoName}\``, ``, `🌿 Branch: \`${pr.branch}\``, `📁 Arquivos: ${pr.files?.join(', ')}`, `📝 Commit: ${pr.message}`].join('\n')
                const archFixId = await postCardComment(run.provider, cfg, secrets, run.card_key, archFixMsg)
                await logMessage(run.id, 'agent_to_card', stageId, archFixMsg, archFixId ?? undefined)
              } else {
                const archErrMsg = `⚠️ **Push do arquiteto falhou** [${pr.repoName}]: ${pr.message}`
                logger.error({ run_id: run.id, agent: agent.name, result: pr }, 'pipeline-engine: architect push failed')
                const archErrId = await postCardComment(run.provider, cfg, secrets, run.card_key, archErrMsg)
                await logMessage(run.id, 'agent_to_card', stageId, archErrMsg, archErrId ?? undefined)
              }
            }
          }
          const mergeResult = await mergeToMain(effectiveRepoId, run.card_key, run.card_title)
          const mergeMsg = mergeResult.ok
            ? [`✅ **Merge realizado na main**`, ``, mergeResult.message].join('\n')
            : `⚠️ **Merge não realizado**: ${mergeResult.message}`
          if (!mergeResult.ok) logger.error({ run_id: run.id, agent: agent.name, result: mergeResult }, 'pipeline-engine: merge to main failed')
          const mergeCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, mergeMsg)
          await logMessage(run.id, 'agent_to_card', stageId, mergeMsg, mergeCommentId ?? undefined)
        } catch (mergeErr: any) {
          const mergeErrMsg = `❌ **Erro no merge**: ${mergeErr?.message ?? String(mergeErr)}`
          logger.error({ mergeErr, run_id: run.id, agent: agent.name }, 'pipeline-engine: merge to main exception')
          const mergeErrId = await postCardComment(run.provider, cfg, secrets, run.card_key, mergeErrMsg).catch(() => null)
          if (mergeErrId) await logMessage(run.id, 'agent_to_card', stageId, mergeErrMsg, mergeErrId)
        }
      }

      // Push code for any role with a repo when FILE/ARQUIVO blocks are present
      // (software architect handled above — skip to avoid double push)
      if (effectiveRepoId
        && assignment.role !== 'software architect'
        && /###\s*(?:FILE|ARQUIVO):/i.test(llmResult.text)) {
        try {
          const pushResults = await pushFilesToRepos(llmResult.text, run.card_key, run.card_title, stageRepos, effectiveRepoId)
          for (const pushResult of pushResults) {
            let pushMsg: string
            if (pushResult.ok) {
              const repoRow = await dbGet<{ repo_url: string }>('SELECT repo_url FROM git_repositories WHERE id = ?', [pushResult.repoId])
              const repoUrlRaw = (repoRow?.repo_url ?? '').replace(/\.git$/, '').replace(/\/+$/, '')
              const linkArvore = repoUrlRaw
                ? (/github\.com\//.test(repoUrlRaw)
                    ? `${repoUrlRaw}/tree/${pushResult.branch}`
                    : `${repoUrlRaw}/-/tree/${pushResult.branch}`)
                : ''
              pushMsg = [
                `✅ **Código commitado** → \`${pushResult.repoName}\``,
                ``,
                `🌿 Branch: \`${pushResult.branch}\``,
                `📝 Commit: ${pushResult.message}`,
                `📁 Arquivos: ${pushResult.files?.join(', ')}`,
                linkArvore ? `🔗 ${linkArvore}` : '',
              ].filter(Boolean).join('\n')
            } else {
              logger.error({ run_id: run.id, agent: agent.name, repo: pushResult.repoName, result: pushResult }, 'pipeline-engine: code push failed')
              pushMsg = `❌ **Push não realizado** [${pushResult.repoName}]: ${pushResult.message}`
            }
            const pushCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, pushMsg)
            await logMessage(run.id, 'agent_to_card', stageId, pushMsg, pushCommentId ?? undefined)
          }
        } catch (pushErr: any) {
          const pushErrMsg = `❌ **Erro ao commitar código**: ${pushErr?.message ?? String(pushErr)}`
          logger.error({ pushErr, run_id: run.id, agent: agent.name }, 'pipeline-engine: code push exception')
          const pushErrId = await postCardComment(run.provider, cfg, secrets, run.card_key, pushErrMsg).catch(() => null)
          if (pushErrId) await logMessage(run.id, 'agent_to_card', stageId, pushErrMsg, pushErrId)
        }
      }

      outputParts.push(`### ${agent.name} (${agent.role})\n${llmResult.text}`)
    } catch (err) {
      const nowFail = Math.floor(Date.now() / 1000)
      await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowFail, agent.id])
      logger.error({ err, run_id: run.id, column_id: column.id, agent_id: agent.id }, 'pipeline-engine: LLM call failed')
      await updateRun(run.id, { status: 'failed' })
      const errMsg = err instanceof Error ? err.message : String(err)
      await postCardComment(run.provider, cfg, secrets, run.card_key, `❌ Falha no agente "${agent.name}" — estágio "${column.column_name}": ${errMsg}`)
      try {
        db_helpers.logActivity(
          'pipeline.card_failed',
          'pipeline_card',
          run.id,
          agent.name,
          `Falha em ${run.card_key} — "${column.column_name}" (${agent.name}): ${errMsg.slice(0, 120)}`,
          { card_key: run.card_key, card_title: run.card_title, stage: column.column_name, role: agent.role, error: errMsg },
          run.workspace_id
        )
      } catch { /* non-critical */ }
      return
    }
  }

  // Guard: only advance if at least one agent produced output in this stage
  const totalCompleted = (await dbGet(`SELECT COUNT(*) as n FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND body LIKE '🤖 **%'`, [run.id, stageId]) as { n: number }).n

  if (totalCompleted === 0) {
    const msg = `⚠️ **${column.column_name}** — nenhum agente produziu saída. Estágio não avançado.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, msg)
    await logMessage(run.id, 'agent_to_card', stageId, msg)
    await updateRun(run.id, { status: 'failed' })
    try {
      db_helpers.logActivity(
        'pipeline.card_failed',
        'pipeline_card',
        run.id,
        'pipeline',
        `${run.card_key} — "${column.column_name}": nenhum agente produziu saída`,
        { card_key: run.card_key, card_title: run.card_title, stage: column.column_name },
        run.workspace_id
      )
    } catch { /* non-critical */ }
    return
  }

  // If a PR was opened and CI check is pending, pause and let the next tick poll CI
  const freshRun = await dbGet('SELECT pr_check_json FROM pipeline_card_runs WHERE id = ?', [run.id]) as { pr_check_json: string | null } | null
  if (freshRun?.pr_check_json) {
    await updateRun(run.id, { status: 'waiting_input' })
    return
  }

  // QA gate: if this stage has a QA agent and output contains REPROVADO, send back to developer
  const hasQAAgent = assignments.some(a => a.role === 'qa engineer')
  if (hasQAAgent && /REPROVADO/i.test(outputParts.join('\n'))) {
    const allPipelineCols = await dbGetAll('SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC', [column.pipeline_id]) as PipelineColumn[]

    const devColumn = allPipelineCols.find(col =>
      parseAssignments(col).some(a => a.role === 'developer')
    )

    if (devColumn) {
      // Clear dev stage messages so it runs fresh with the QA feedback as context
      await dbRun('DELETE FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ?', [run.id, String(devColumn.id)])

      const backMsg = [
        `🔄 **QA reprovado — retornando para desenvolvimento**`,
        ``,
        `O QA identificou problemas que precisam ser corrigidos antes do code review.`,
        `O card foi retornado para a etapa **${devColumn.column_name}**.`,
      ].join('\n')
      const backId = await postCardComment(run.provider, cfg, secrets, run.card_key, backMsg)
      await logMessage(run.id, 'agent_to_card', stageId, backMsg, backId ?? undefined)

      await moveCard(run.provider, cfg, secrets, run.card_key, devColumn.column_name)
      const reworkRun: PipelineCardRun = { ...run, current_stage_id: String(devColumn.id), task_id: null, status: 'running' }
      await updateRun(run.id, { current_stage_id: String(devColumn.id), task_id: null, status: 'running' })
      await startColumn(reworkRun, devColumn, cfg, secrets)
      return
    }
  }

  await advanceToNextColumn(run, column, cfg, secrets, outputParts.join('\n\n---\n\n'))
}

async function advanceToNextColumn(
  run: PipelineCardRun,
  currentColumn: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  _agentOutput: string  // output already posted per-agent in startColumn; kept for reply/manual advance path
): Promise<void> {
  const nextColumn = await getNextColumn(currentColumn)

  if (!nextColumn) {
    await updateRun(run.id, { status: 'done', task_id: null })
    const doneMsg = `✅ **Esteira concluída** — todos os estágios de _${run.card_key}_ foram processados com sucesso.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, doneMsg)
    eventBus.broadcast('pipeline.run_completed', { run_id: run.id, card_key: run.card_key })
    try {
      db_helpers.logActivity(
        'pipeline.card_done',
        'pipeline_card',
        run.id,
        'pipeline',
        `${run.card_key} concluído — ${run.card_title}`,
        { card_key: run.card_key, card_title: run.card_title, run_count: run.run_count, cost_usd: run.cost_usd },
        run.workspace_id
      )
    } catch { /* non-critical */ }
    return
  }

  // Move card to the next column in JIRA/Azure
  await moveCard(run.provider, cfg, secrets, run.card_key, nextColumn.column_name)

  const updatedRun: PipelineCardRun = { ...run, current_stage_id: String(nextColumn.id), task_id: null, status: 'running' }
  await updateRun(run.id, { current_stage_id: String(nextColumn.id), task_id: null, status: 'running' })

  if (hasAgents(nextColumn)) {
    await startColumn(updatedRun, nextColumn, cfg, secrets)
  } else if (!(await getNextColumn(nextColumn))) {
    // Last column with no agents — auto-complete the run
    await updateRun(run.id, { status: 'done', task_id: null })
    const doneMsg = `✅ **Esteira concluída** — todos os estágios de _${run.card_key}_ foram processados com sucesso.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, doneMsg)
    eventBus.broadcast('pipeline.run_completed', { run_id: run.id, card_key: run.card_key })
    try {
      db_helpers.logActivity(
        'pipeline.card_done',
        'pipeline_card',
        run.id,
        'pipeline',
        `${run.card_key} concluído — ${run.card_title}`,
        { card_key: run.card_key, card_title: run.card_title, run_count: run.run_count, cost_usd: run.cost_usd },
        run.workspace_id
      )
    } catch { /* non-critical */ }
  } else {
    // Pass-through column (no agents assigned) in the middle of the pipeline — wait for user input
    const waitMsg = `⏸️ **${nextColumn.column_name}** — aguardando ação manual. Responda com \`avançar\` para continuar ou \`cancelar\` para encerrar.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, waitMsg)
    await updateRun(run.id, { status: 'waiting_input' })
  }
}

// ─── Poll active runs ─────────────────────────────────────────────────────────

async function checkRunningRuns(
  workspaceId: number,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  provider: string
): Promise<void> {
  const runs = await getActiveRuns(workspaceId)

  await Promise.allSettled(runs.map(async (run) => {
    try {
      const column = await resolveColumnForRun(run)
      if (!column) return

      // Auto-retry: reset failed runs so startColumn can run again (max 3 attempts per stage)
      if (run.status === 'failed') {
        const stageId = run.current_stage_id
        // Count errors only for the current stage so failures in earlier stages don't block retries here
        const errorCount = (await dbGet(`SELECT COUNT(*) as n FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND body LIKE '❌%'`, [run.id, stageId]) as { n: number }).n
        if (errorCount >= 3) return
        await updateRun(run.id, { status: 'running', task_id: null })
        await startColumn({ ...run, status: 'running', task_id: null }, column, cfg, secrets)
        return
      }

      // Poll GitHub CI if a PR was opened and we're waiting for it to pass
      if (run.status === 'waiting_input' && run.pr_check_json) {
        await checkAndAdvancePRCI(run, column, cfg, secrets)
        return
      }

      if (run.status === 'running' && run.task_id) {
        const task = await dbGet('SELECT status FROM tasks WHERE id = ?', [run.task_id]) as { status: string } | undefined
        if (!task) {
          await updateRun(run.id, { status: 'waiting_input', task_id: null })
          return
        }

        if (task.status === 'done' || task.status === 'quality_review') {
          const comment = await dbGet<{ content: string }>(`SELECT content FROM comments WHERE task_id = ? AND author != 'system' AND author != 'pipeline-engine' ORDER BY created_at DESC LIMIT 1`, [run.task_id])
          await advanceToNextColumn(run, column, cfg, secrets, comment?.content || '✅ Estágio concluído.')
        } else if (task.status === 'failed') {
          await updateRun(run.id, { status: 'failed' })
          await postCardComment(provider, cfg, secrets, run.card_key, '❌ O agente reportou falha neste estágio.')
        }
      }

      await processInboundComments(run, column, cfg, secrets)
    } catch (err) {
      logger.warn({ err, run_id: run.id }, 'pipeline-engine: error processing run')
    }
  }))
}

async function executeMentionInstruction(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  userInstruction: string,
): Promise<void> {
  const assignments = parseAssignments(column).sort((a, b) => a.order - b.order)
  const agentMap = new Map((await getAgentsByIds(assignments.map(a => a.agent_id))).map((ag: AgentFullRow) => [ag.id, ag] as [number, AgentFullRow]))
  const agents = assignments.map(a => agentMap.get(a.agent_id)).filter(Boolean) as AgentFullRow[]

  if (!agents.length) {
    await postCardComment(run.provider, cfg, secrets, run.card_key,
      `⚠️ Nenhum agente atribuído na etapa "${column.column_name}" para executar a instrução.`)
    return
  }

  const ackMsg = [
    `🤖 **Instrução recebida** via menção na etapa "${column.column_name}"`,
    '',
    `> ${userInstruction}`,
    '',
    `⏳ Processando...`,
  ].join('\n')
  await postCardComment(run.provider, cfg, secrets, run.card_key, ackMsg)
  await updateRun(run.id, { status: 'running', task_id: null })

  for (const assignment of assignments) {
    const agent = agentMap.get(assignment.agent_id)
    if (!agent) continue

    const nowBusy = Math.floor(Date.now() / 1000)
    await dbRun(`UPDATE agents SET status = 'busy', last_activity = ?, last_seen = ?, updated_at = ? WHERE id = ?`, [`Pipeline mention: ${run.card_key}`, nowBusy, nowBusy, agent.id])

    const previousMessages = await getLastAgentMessages(run.id)
    const prompt = [
      `# Instrução do usuário via @menção`,
      ``,
      `O usuário enviou a seguinte instrução diretamente para você no card ${run.card_key}:`,
      ``,
      `> **${userInstruction}**`,
      ``,
      `Responda **especificamente** a esta instrução, usando o contexto do card abaixo.`,
      ``,
      buildPrompt(run, column, previousMessages, agent.name, agent.role),
    ].join('\n')

    const taskId = await createAgentTask(run, column, agent, prompt, true, assignment.llm_model)
    await updateRun(run.id, { task_id: taskId ?? undefined })

    try {
      const llmResult = await callAgentLLM(agent, prompt, cfg, assignment.llm_model, classifyCardComplexity(run.card_title, run.card_description))
      const nowDone = Math.floor(Date.now() / 1000)

      try {
        await dbRun(`INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, cost_usd, agent_name, task_id, created_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [llmResult.model, `pipeline-mention-${run.id}-${agent.id}`, llmResult.inputTokens, llmResult.outputTokens, llmResult.costUsd, agent.name, taskId ?? null, nowDone, run.workspace_id])
        await dbRun(`UPDATE pipeline_card_runs SET cost_usd = COALESCE(cost_usd, 0) + ?, updated_at = ? WHERE id = ?`, [llmResult.costUsd, nowDone, run.id])
        const cur2 = (await dbGet('SELECT llm_models FROM pipeline_card_runs WHERE id = ?', [run.id]) as { llm_models: string } | null)?.llm_models ?? ''
        const modelSet2 = new Set(cur2 ? cur2.split(',') : [])
        modelSet2.add(llmResult.model)
        await dbRun('UPDATE pipeline_card_runs SET llm_models = ? WHERE id = ?', [[...modelSet2].join(','), run.id])
      } catch { /* ignore token log errors */ }

      if (taskId) {
        await dbRun(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?`, [nowDone, taskId])
        await dbRun(`INSERT INTO comments (task_id, author, content, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`, [taskId, agent.name, llmResult.text, nowDone, run.workspace_id])
      }
      await dbRun(`UPDATE agents SET status = 'idle', last_activity = ?, updated_at = ? WHERE id = ?`, [`Respondeu menção em ${run.card_key}`, nowDone, agent.id])

      const resultComment = [
        `🤖 **${agent.name}** *(${agent.role})* — resposta à instrução`,
        '',
        llmResult.text,
        '',
        `---`,
        `*${llmResult.model} | ${llmResult.inputTokens} in / ${llmResult.outputTokens} out${llmResult.costUsd > 0 ? ` | $${llmResult.costUsd.toFixed(4)}` : ''}*`,
      ].join('\n')
      const stageId = String(column.id)
      const cid = await postCardComment(run.provider, cfg, secrets, run.card_key, resultComment)
      await logMessage(run.id, 'agent_to_card', stageId, resultComment, cid ?? undefined)

    } catch (err) {
      const nowFail = Math.floor(Date.now() / 1000)
      await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowFail, agent.id])
      logger.error({ err, run_id: run.id, agent_id: agent.id }, 'pipeline-engine: mention instruction LLM failed')
      await postCardComment(run.provider, cfg, secrets, run.card_key,
        `❌ Falha ao executar instrução via "${agent.name}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Restore previous status after handling the mention
  await updateRun(run.id, { status: run.status === 'running' ? 'running' : run.status, task_id: null })
}

async function processInboundComments(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
): Promise<void> {
  // `last_comment_ts` e coluna INT e guarda SEGUNDOS -- mesma unidade de
  // created_at/updated_at nesta tabela. Gravar epoch em MILISSEGUNDOS estourava o
  // INT e o MySQL, com sql_mode vazio, clampava em 2147483647 sem recusar. Lido de
  // volta, isso valia 25/01/1970: a janela nunca avancava e o motor relia todos os
  // comentarios do cartao a cada tick. Medido em 2026-09-08: 4.364 linhas
  // `card_to_agent` para apenas 5 comentarios distintos.
  const afterMs = run.last_comment_ts > 0 ? run.last_comment_ts * 1000 : run.created_at * 1000
  const newComments = await fetchNewCardComments(run.provider, cfg, secrets, run.card_key, afterMs)
  if (!newComments.length) return

  let latestMs = run.last_comment_ts * 1000

  // Persistencia em segundos. O piso pode devolver ate 1s a menos, o que no pior
  // caso relê o comentario da fronteira UMA vez -- e o filtro por id logo abaixo
  // absorve isso. Arredondar para cima, ao contrario, PULARIA um comentario.
  const emSegundos = (ms: number) => Math.floor(ms / 1000)
  for (const comment of newComments) {
    if (comment.createdMs > latestMs) latestMs = comment.createdMs

    // Skip bot-generated comments to avoid feedback loops
    const BOT_PREFIXES = ['\u26A0\uFE0F', '\uD83D\uDD27', '🤖', '✅', '❌', '🚀', '⏸️', '🛑', '🔄', '⏳']
    if (BOT_PREFIXES.some(p => comment.body.startsWith(p))) continue

    // Filtro por id, que nao depende de prefixo: comentario postado por NOS esta
    // gravado em pipeline_card_messages com o id que o provedor devolveu. Medido
    // em 2026-09-08: a mensagem de falha de push comeca com um emoji que NAO
    // estava em BOT_PREFIXES, e o motor releu o proprio comentario 504 vezes como
    // `card_to_agent`, cada releitura alimentando outro ciclo pago.
    const ecoProprio = await dbGet(
      `SELECT 1 AS existe FROM pipeline_card_messages
        WHERE external_comment_id = ? AND direction = 'agent_to_card' LIMIT 1`,
      [comment.id],
    ) as { existe: number } | undefined
    if (ecoProprio) continue

    await logMessage(run.id, 'card_to_agent', String(column.id), comment.body, comment.id)

    const lower = comment.body.toLowerCase().trim()
    const botMention = (cfg.botMention || '@pipeline').toLowerCase().trim()
    const mentionIdx = lower.indexOf(botMention)
    const hasMention = mentionIdx >= 0

    // Extract the instruction after the @mention (or the full comment if no mention)
    const instruction = hasMention
      ? comment.body.slice(mentionIdx + botMention.length).trim()
      : comment.body.trim()
    const instructionLower = instruction.toLowerCase().trim()

    // ── Normaliza comando: pega a primeira palavra da instrução ──────────────
    const firstWord = instructionLower.split(/\s+/)[0] ?? ''
    const isCancelCmd    = ['cancelar', 'cancele', 'cancel'].includes(firstWord)
    const isAdvanceCmd   = ['avançar', 'avancar', 'avance', 'advance'].includes(firstWord)
    const isReprocessAll = ['reprocessar', 'reprocesse', 'reprocess'].includes(firstWord) &&
                           instructionLower.includes('tudo')
    const isReprocessCmd = !isReprocessAll && ['reprocessar', 'reprocesse', 'reprocess'].includes(firstWord)

    // ── Comandos (com ou sem @menção) ─────────────────────────────────────────
    if (isCancelCmd) {
      await updateRun(run.id, { status: 'cancelled', last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, '🛑 Esteira cancelada a pedido do usuário.')
      return
    }

    if (isAdvanceCmd) {
      if (run.status === 'waiting_input' || hasMention) {
        await advanceToNextColumn(run, column, cfg, secrets, '')
        await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
        return
      }
    }

    if (isReprocessCmd) {
      await updateRun(run.id, { status: 'running', task_id: null, last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, `🔄 **Reprocessando etapa "${column.column_name}"** a pedido do usuário.`)
      await startColumn({ ...run, status: 'running', task_id: null }, column, cfg, secrets)
      return
    }

    if (isReprocessAll) {
      const allCols = await dbGetAll<PipelineColumn>('SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC', [column.pipeline_id])
      const firstCol = allCols.find(c => hasAgents(c)) ?? column
      await updateRun(run.id, { status: 'running', task_id: null, current_stage_id: String(firstCol.id), last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, `🔄 **Reiniciando esteira completa** a partir de "${firstCol.column_name}".`)
      await startColumn({ ...run, status: 'running', task_id: null, current_stage_id: String(firstCol.id) }, firstCol, cfg, secrets)
      return
    }

    // ── @menção com instrução livre → executa LLM com contexto do usuário ─────
    if (hasMention && instruction.length > 0) {
      await executeMentionInstruction(run, column, cfg, secrets, instruction)
      await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
      return
    }

    // ── Resposta comum sem @menção → encaminha como contexto ao agente ────────
    if (!hasMention && hasAgents(column)) {
      const assignments = parseAssignments(column)
      const agents = await getAgentsByIds(assignments.map(a => a.agent_id))
      const agent = agents[0]
      if (agent) {
        const prevMsgs = await getLastAgentMessages(run.id)
        const replyDesc = `O usuário respondeu no card ${run.card_key}:\n\n"${comment.body}"\n\n${buildPrompt(run, column, prevMsgs, agent.name, agent.role)}`
        await createAgentTask(run, column, agent, replyDesc, true, assignments[0]?.llm_model)
      }
    }
  }

  await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
}

// ─── Discover new cards ───────────────────────────────────────────────────────

async function discoverNewCards(pipeline: ActivePipelineEntry): Promise<void> {
  const { workspaceId, provider, cfg, secrets, columns } = pipeline

  // Trigger column = is_trigger = 1; fallback to first column with agents
  const triggerColumn = columns.find(c => c.is_trigger === 1) ?? columns.find(c => hasAgents(c)) ?? null
  if (!triggerColumn) return

  let cards: Array<{ externalId: string; title: string; description: string; url: string }> = []
  try {
    if (provider === 'jira') {
      cards = await fetchJiraIssuesByStatus(cfg, secrets, triggerColumn.column_name)
    } else if (provider === 'azure_devops') {
      cards = await fetchAzureWorkItemsByState(cfg, secrets, triggerColumn.column_name)
    }
    logger.info(
      { column: triggerColumn.column_name, count: cards.length, keys: cards.map(c => c.externalId) },
      'pipeline-engine: trigger column polled'
    )
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), column: triggerColumn.column_name },
      'pipeline-engine: JIRA/Azure query failed — verifique credenciais e nome da coluna trigger'
    )
    return
  }
  const toStart: Array<{ run: PipelineCardRun; col: PipelineColumn }> = []

  for (const card of cards) {
    const existing = await dbGet<{ id: number; status: string }>(
      `SELECT id, status FROM pipeline_card_runs WHERE workspace_id = ? AND provider = ? AND card_key = ? AND status NOT IN ('done','cancelled','failed','waiting_input')`,
      [workspaceId, provider, card.externalId]
    )

    if (existing) {
      logger.debug({ card_key: card.externalId, status: existing.status }, 'pipeline-engine: card already has active run, skipping')
      continue
    }

    const run = await upsertRun(workspaceId, provider, card.externalId, card.title, card.description, card.url, String(triggerColumn.id))
    if (!run || run.status !== 'running') {
      // era um `continue` sem log: o cartao era descartado em silencio a cada tick
      logger.warn(
        { card_key: card.externalId, run_status: run ? run.status : '(sem run)' },
        'pipeline-engine: cartao detectado mas a execucao nao foi criada -- pulando este tick'
      )
      continue
    }

    // Trigger column may have no agents (pure discovery column) — skip to first worker column
    let startCol: PipelineColumn = triggerColumn
    if (!hasAgents(triggerColumn)) {
      const workerCol = columns.find(c => c.column_order > triggerColumn.column_order && hasAgents(c)) ?? null
      if (workerCol) {
        await updateRun(run.id, { current_stage_id: String(workerCol.id) })
        startCol = workerCol
      }
    }

    logger.info({ card_key: card.externalId, column: startCol.column_name }, 'pipeline-engine: new card detected, starting pipeline')
    toStart.push({ run: { ...run, current_stage_id: String(startCol.id) }, col: startCol })
  }

  // Process all new cards in parallel — no card blocks another
  await Promise.allSettled(toStart.map(({ run, col }) => startColumn(run, col, cfg, secrets)))
}

// ─── Main tick ────────────────────────────────────────────────────────────────

let _running = false

function normalizeJiraHost(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`
  } catch {
    return raw
  }
}

async function getActivePipelines(): Promise<ActivePipelineEntry[]> {
  const entries: ActivePipelineEntry[] = []

  // New table: work_pipelines (created via Fluxos UI)
  try {
    const rows = await dbGetAll<{ id: number; workspace_id: number; provider: string; config_json: string; secret_blob: string | null }>(
      `SELECT id, workspace_id, provider, config_json, secret_blob FROM work_pipelines WHERE enabled = 1 AND provider != 'none'`,
      []
    )

    for (const row of rows) {
      let cfg: WorkPipelineConfigJson = {}
      try { cfg = JSON.parse(row.config_json) } catch { /* ignore */ }
      if (cfg.jiraHost) cfg = { ...cfg, jiraHost: normalizeJiraHost(cfg.jiraHost) }
      const secrets = decryptPipelineSecrets(row.secret_blob)

      const columns = await dbGetAll<PipelineColumn>(
        'SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC',
        [row.id]
      )

      if (columns.length === 0) continue

      entries.push({
        pipelineId: row.id,
        workspaceId: row.workspace_id,
        provider: row.provider,
        cfg,
        secrets,
        columns,
      })
    }
  } catch { /* table may not exist yet */ }

  // Legacy table: work_pipeline_configs (backward compat — only if no new-style pipeline exists for this workspace)
  try {
    const rows = await dbGetAll<{ workspace_id: number }>(
      `SELECT DISTINCT workspace_id FROM work_pipeline_configs WHERE enabled = 1 AND provider != 'none'`,
      []
    )

    for (const row of rows) {
      if (entries.some(e => e.workspaceId === row.workspace_id)) continue // covered by new table

      const pipelineRow = await getWorkPipelineRow(row.workspace_id)
      if (!pipelineRow || !pipelineRow.enabled || pipelineRow.provider === 'none') continue

      // Legacy pipelines without pipeline_columns use delivery_flows — not supported in new engine
      logger.warn({ workspace_id: row.workspace_id }, 'pipeline-engine: legacy pipeline without pipeline_columns — configure via Fluxos UI to enable')
    }
  } catch { /* ignore */ }

  return entries
}

export async function tickPipelineEngine(): Promise<{ ok: boolean; message: string }> {
  // Cancel runs stuck in 'running' for more than 2 hours — prevents stale runs
  // from blocking new executions and consuming resources indefinitely
  try {
    const staleThreshold = Math.floor(Date.now() / 1000) - 2 * 60 * 60
    const staleResult = await dbRun(
      `UPDATE pipeline_card_runs SET status = 'failed', updated_at = UNIX_TIMESTAMP()
       WHERE status = 'running' AND updated_at < ?`,
      [staleThreshold]
    )
    if (staleResult.affectedRows > 0) {
      logger.info({ count: staleResult.affectedRows }, 'pipeline-engine: cancelled stale running runs')
    }
  } catch (err) {
    logger.warn({ err }, 'pipeline-engine: stale run cleanup failed')
  }

  const pipelines = await getActivePipelines()

  if (pipelines.length === 0) {
    return { ok: true, message: 'pipeline engine: no active pipelines with configured columns' }
  }

  // Always run card discovery — new cards must be picked up even while a previous stage is running
  for (const pipeline of pipelines) {
    try {
      await discoverNewCards(pipeline)
    } catch (err) {
      logger.warn({ err, workspace_id: pipeline.workspaceId }, 'pipeline-engine: discoverNewCards failed')
    }
  }

  // Skip processing of running stages only if a long LLM call is still in progress
  if (_running) return { ok: true, message: 'pipeline engine: stage processing in progress, new cards discovered' }
  _running = true
  try {

    // Ensure pipeline-assigned agents show as idle (not offline) while pipelines are active
    const allAgentIds = new Set<number>()
    for (const p of pipelines) {
      for (const col of p.columns) {
        for (const a of parseAssignments(col)) allAgentIds.add(a.agent_id)
      }
    }
    if (allAgentIds.size > 0) {
      const placeholders = Array.from(allAgentIds).map(() => '?').join(',')
      await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id IN (${placeholders}) AND status = 'offline'`, [Math.floor(Date.now() / 1000), ...Array.from(allAgentIds)])
    }

    let total = 0
    for (const pipeline of pipelines) {
      try {
        await checkRunningRuns(pipeline.workspaceId, pipeline.cfg, pipeline.secrets, pipeline.provider)
        total++
      } catch (err) {
        logger.warn({ err, workspace_id: pipeline.workspaceId }, 'pipeline-engine: workspace poll failed')
      }
    }

    return { ok: true, message: `pipeline engine: polled ${total} pipeline(s)` }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err }, 'pipeline-engine: tick failed')
    return { ok: false, message: `pipeline engine error: ${msg}` }
  } finally {
    _running = false
  }
}

// ─── Manual controls (for API routes) ────────────────────────────────────────

export async function listCardRuns(workspaceId: number, limit = 50): Promise<PipelineCardRun[]> {
  return dbGetAll<PipelineCardRun>('SELECT * FROM pipeline_card_runs WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?', [workspaceId, limit])
}

export async function cancelCardRun(runId: number): Promise<boolean> {
  const r = await dbRun(
    `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP() WHERE id = ? AND status NOT IN ('done','cancelled','failed')`,
    [runId]
  )
  return r.affectedRows > 0
}

export async function getCardMessages(runId: number): Promise<Array<{ direction: string; stage_id: string; body: string; created_at: number }>> {
  return dbGetAll('SELECT direction, stage_id, body, created_at FROM pipeline_card_messages WHERE run_id = ? ORDER BY created_at ASC', [runId])
}

export async function reprocessCardRun(runId: number): Promise<{ ok: boolean; message: string }> {
  if (_running) return { ok: false, message: 'Engine busy — tente novamente em instantes' }
  _running = true
  try {
    const run = await dbGet('SELECT * FROM pipeline_card_runs WHERE id = ?', [runId]) as PipelineCardRun | undefined
    if (!run) return { ok: false, message: `Run ${runId} não encontrado` }
    if (run.status === 'done' || run.status === 'cancelled')
      return { ok: false, message: 'Run já concluído ou cancelado' }

    const pipelines = await getActivePipelines()
    const pipeline = pipelines.find((p) => p.workspaceId === run.workspace_id)
    if (!pipeline) return { ok: false, message: 'Nenhum pipeline ativo encontrado para este workspace' }

    const column = await resolveColumnForRun(run)
    if (!column) return { ok: false, message: 'Não foi possível resolver a etapa atual — verifique a configuração das colunas' }

    await updateRun(run.id, { status: 'running', task_id: null })
    await postCardComment(run.provider, pipeline.cfg, pipeline.secrets, run.card_key,
      `🔄 **Reprocessando etapa "${column.column_name}"** a pedido do usuário (via interface).`)
    await startColumn({ ...run, status: 'running', task_id: null }, column, pipeline.cfg, pipeline.secrets)

    return { ok: true, message: `Reprocessamento iniciado para ${run.card_key}` }
  } catch (err) {
    logger.error({ err, run_id: runId }, 'pipeline-engine: reprocess failed')
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    _running = false
  }
}
