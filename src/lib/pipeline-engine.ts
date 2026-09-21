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
import { validateAgentOutput, formatHarnessRejection } from '@/lib/agent-harness'
import { buildKnowledgeContext, parseKnowledgeSources } from '@/lib/knowledge-context'
import { searchKnowledge, addKnowledge, formatKnowledgeContext, inferDomain } from '@/lib/second-brain-client'
import { calculateTokenCost } from '@/lib/token-pricing'
import { fetchJiraIssuesByStatus, postJiraComment, getJiraCommentsSince, transitionJiraIssue, fetchJiraAttachments, downloadJiraAttachment } from '@/lib/work-pipeline-jira'
import { fetchAzureWorkItemsByState, postAzureComment, getAzureCommentsSince, moveAzureWorkItem, fetchAzureAttachments, downloadAzureAttachment } from '@/lib/work-pipeline-azure'
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
  /** JSON com info de PR aberto para polling de revisão humana (comentários de rejeição) */
  pr_review_json: string | null
  /** Resumo acumulado das decisões de cada etapa — injetado no início de cada prompt */
  context_summary_json: string | null
  /** Snapshots do estado antes de cada etapa para replay/rollback */
  stage_snapshots_json: string | null
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
  /** Se 1, o pipeline pausa ao chegar nesta coluna e aguarda aprovação humana antes de executar os agentes */
  requires_human_approval: number
  /** Nome da transição no Jira. Se preenchido, usa este ao mover o card. Se vazio, usa column_name. */
  jira_status: string | null
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
  const ESTADOS_TERMINAIS = ['done', 'failed', 'cancelled']

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

async function updateRun(id: number, patch: Partial<Pick<PipelineCardRun, 'status' | 'current_stage_id' | 'task_id' | 'last_comment_ts' | 'context_summary_json' | 'stage_snapshots_json'>>): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const sets: string[] = ['updated_at = ?']
  const vals: unknown[] = [now]
  if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status) }
  if (patch.current_stage_id !== undefined) { sets.push('current_stage_id = ?'); vals.push(patch.current_stage_id) }
  if (patch.task_id !== undefined) { sets.push('task_id = ?'); vals.push(patch.task_id) }
  if (patch.last_comment_ts !== undefined) { sets.push('last_comment_ts = ?'); vals.push(patch.last_comment_ts) }
  if (patch.context_summary_json !== undefined) { sets.push('context_summary_json = ?'); vals.push(patch.context_summary_json) }
  if (patch.stage_snapshots_json !== undefined) { sets.push('stage_snapshots_json = ?'); vals.push(patch.stage_snapshots_json) }
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

// ── Skills cache — evita readFileSync síncrono a cada agente ─────────────────
let _skillsCache: { result: string; cachedAt: number } | null = null
const SKILLS_CACHE_TTL_MS = 30_000

/** Mapa de nome-de-skill → path — usado para resolver skillPath no harness */
let _skillPathCache: { map: Map<string, string>; cachedAt: number } | null = null

async function loadSkillPathMap(): Promise<Map<string, string>> {
  const now = Date.now()
  if (_skillPathCache && (now - _skillPathCache.cachedAt) < SKILLS_CACHE_TTL_MS) {
    return _skillPathCache.map
  }
  try {
    const rows = await dbGetAll<{ name: string; path: string }>(
      `SELECT name, path FROM skills WHERE path IS NOT NULL ORDER BY name ASC`, []
    )
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(row.name.toLowerCase(), row.path)
    }
    _skillPathCache = { map, cachedAt: now }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Resolve o skillPath para um agente pelo seu role.
 * Busca a skill cujo nome contém o role ou vice-versa.
 * Ex: role "business analyst" → skills/swe-business-analysis
 */
async function resolveSkillPathForRole(role: string): Promise<string | null> {
  const map = await loadSkillPathMap()
  const roleLower = role.toLowerCase().trim()

  // Mapeamento direto role → nome de skill
  const ROLE_TO_SKILL: Record<string, string> = {
    'business analyst':    'swe-business-analysis',
    'software architect':  'swe-software-architecture',
    'developer':           'swe-implementation-practices',
    'qa engineer':         'swe-quality-gates',
    'security auditor':    'swe-security-review',
    'data engineer':       'swe-data-engineering',
    'product manager':     'swe-product-management',
    'product owner':       'swe-backlog-prioritization',
    'ux designer':         'swe-ux-research',
    'scrum master':        'swe-flow-management',
    'devops engineer':     'swe-release-operations',
    'orchestrator':        'swe-orchestration-coordination',
    'coordinator':         'swe-orchestration-coordination',
    'discovery':           'swe-discovery-practices',
  }

  const skillName = ROLE_TO_SKILL[roleLower]
  if (skillName && map.has(skillName)) {
    return map.get(skillName) ?? null
  }

  // Fallback: busca por match parcial no nome da skill
  for (const [name, path] of map.entries()) {
    if (name.includes(roleLower.replace(/\s+/g, '-')) || roleLower.includes(name.replace(/-/g, ' '))) {
      return path
    }
  }

  return null
}

async function loadAgentSkills(workspaceId: number): Promise<string> {
  const now = Date.now()
  if (_skillsCache && (now - _skillsCache.cachedAt) < SKILLS_CACHE_TTL_MS) {
    return _skillsCache.result
  }
  try {
    // Skills are synced from disk to the skills table by skill-sync.ts.
    // The `path` column points to the skill directory; SKILL.md is inside it.
    const rows = await dbGetAll<{ name: string; path: string }>(
      `SELECT name, path FROM skills WHERE path IS NOT NULL ORDER BY name ASC`,
      []
    )
    if (!rows.length) {
      _skillsCache = { result: '', cachedAt: now }
      return ''
    }
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
    const result = parts.join('\n\n')
    _skillsCache = { result, cachedAt: now }
    return result
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
  if (!response.ok) {
    const errBody = (await response.text().catch(() => '')).slice(0, 120)
    throw new Error(`Anthropic API error ${response.status}${errBody ? ': ' + errBody : ''}`)
  }

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
  if (!response.ok) {
    const errBody = (await response.text().catch(() => '')).slice(0, 120)
    throw new Error(`Gemini API error ${response.status}${errBody ? ': ' + errBody : ''}`)
  }

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
      if (!response.ok) throw new Error(`${provider} API error ${response.status}: ${(await response.text().catch(() => '')).slice(0, 120)}`)
    } else {
      throw new Error(`${provider} API error ${response.status}: ${errText.slice(0, 120)}`)
    }
  }
  if (!response.ok) {
    const errBody = (await response.text().catch(() => '')).slice(0, 120)
    throw new Error(`${provider} API error ${response.status}${errBody ? ': ' + errBody : ''}`)
  }

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
  if (!response.ok) {
    const errBody = (await response.text().catch(() => '')).slice(0, 120)
    throw new Error(`Ollama API error ${response.status}${errBody ? ': ' + errBody : ''}`)
  }

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

async function openMergeRequestGitLab(
  repo: { repo_url: string; branch: string; access_token: string | null; base_url?: string | null },
  cardKey: string,
  cardTitle: string,
  reviewBody: string,
): Promise<{ ok: boolean; url?: string; prNumber?: number; message: string }> {
  const token = repo.access_token
  if (!token) return { ok: false, message: 'Repositório sem token configurado' }

  let origin: string
  let projectPath: string
  try {
    const u = new URL(repo.repo_url)
    origin = (repo.base_url || u.origin).replace(/\/+$/, '')
    projectPath = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
  } catch {
    return { ok: false, message: `URL do repositório inválida: ${repo.repo_url}` }
  }

  const api = `${origin}/api/v4/projects/${encodeURIComponent(projectPath)}`
  const headers: Record<string, string> = { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }

  const branchName = toBranchSlug(cardKey, cardTitle)
  const baseBranch = (repo.branch || 'main').trim()

  // Check if branch exists
  const branchCheck = await fetch(`${api}/repository/branches/${encodeURIComponent(branchName)}`, { headers })
  if (!branchCheck.ok) {
    return { ok: false, message: `Branch ${branchName} não encontrada — commit o código primeiro` }
  }

  // Check if MR already exists
  const existingResp = await fetch(`${api}/merge_requests?state=opened&source_branch=${encodeURIComponent(branchName)}`, { headers })
  if (existingResp.ok) {
    const existing = await existingResp.json() as Array<{ web_url: string; iid: number }>
    if (existing.length > 0) {
      return { ok: true, url: existing[0].web_url, prNumber: existing[0].iid, message: `MR já existia: !${existing[0].iid}` }
    }
  }

  const mrTitle = toConventionalPRTitle(cardKey, cardTitle)
  const mrBody = [
    `## ${cardKey} — ${cardTitle}`,
    ``,
    `### Code Review`,
    reviewBody.substring(0, 3000),
    ``,
    `---`,
    `*MR aberto automaticamente pela esteira de agentes após code review.*`,
  ].join('\n')

  const mrResp = await fetch(`${api}/merge_requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: mrTitle,
      description: mrBody,
      source_branch: branchName,
      target_branch: baseBranch,
      remove_source_branch: false,
    }),
  })

  if (!mrResp.ok) {
    const err = await mrResp.text().catch(() => '')
    return { ok: false, message: `Erro ao abrir MR: ${err.slice(0, 200)}` }
  }

  const mr = await mrResp.json() as { web_url: string; iid: number }
  return { ok: true, url: mr.web_url, prNumber: mr.iid, message: `MR !${mr.iid} aberto com sucesso` }
}

async function openPRForRepo(
  repoId: number,
  cardKey: string,
  cardTitle: string,
  reviewBody: string,
): Promise<{ ok: boolean; url?: string; prNumber?: number; message: string }> {
  const repo = await dbGet('SELECT * FROM git_repositories WHERE id = ?', [repoId]) as
    | { repo_url: string; branch: string; access_token: string | null; base_url?: string | null }
    | undefined

  if (!repo?.access_token) return { ok: false, message: 'Repositório sem token configurado' }

  // Route by provider
  if (/bitbucket\.org\//.test(repo.repo_url)) {
    return { ok: false, message: 'Abertura de PR automática no Bitbucket não implementada' }
  }
  if (!/github\.com\//.test(repo.repo_url)) {
    return openMergeRequestGitLab(repo, cardKey, cardTitle, reviewBody)
  }
  return openPullRequest(repoId, cardKey, cardTitle, reviewBody)
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
    // Fetch output details for each failed check — annotations + job logs para dar contexto real ao agente
    const details: string[] = []
    for (const failedRun of failed.slice(0, 3)) {
      try {
        // 1. Annotations (mensagens de erro estruturadas)
        const runResp = await fetch(`${apiBase}/check-runs/${failedRun.id}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (runResp.ok) {
          const runData = await runResp.json() as {
            output?: { summary?: string; text?: string }
            app?: { slug?: string }
          }
          const summary = runData.output?.summary?.slice(0, 400) ?? ''
          const text = runData.output?.text?.slice(0, 400) ?? ''

          // 2. Job logs via Actions API (stdout/stderr real dos steps) — só para GitHub Actions
          let jobLog = ''
          if (runData.app?.slug === 'github-actions') {
            try {
              // Busca o job correspondente ao check run
              const jobsResp = await fetch(
                `${apiBase}/actions/runs?head_sha=${pr.head.sha}&per_page=10`,
                { headers, signal: AbortSignal.timeout(10_000) }
              )
              if (jobsResp.ok) {
                const jobsData = await jobsResp.json() as { workflow_runs?: Array<{ id: number; conclusion: string | null }> }
                const failedWorkflow = jobsData.workflow_runs?.find(r => r.conclusion === 'failure')
                if (failedWorkflow) {
                  const stepsResp = await fetch(
                    `${apiBase}/actions/runs/${failedWorkflow.id}/jobs`,
                    { headers, signal: AbortSignal.timeout(10_000) }
                  )
                  if (stepsResp.ok) {
                    const stepsData = await stepsResp.json() as {
                      jobs?: Array<{ id: number; name: string; conclusion: string | null; steps?: Array<{ name: string; conclusion: string | null; number: number }> }>
                    }
                    const failedJob = stepsData.jobs?.find(j => j.conclusion === 'failure')
                    if (failedJob) {
                      // Busca o log do job (retorna text/plain com o stdout completo)
                      const logResp = await fetch(
                        `${apiBase}/actions/jobs/${failedJob.id}/logs`,
                        { headers, signal: AbortSignal.timeout(15_000) }
                      )
                      if (logResp.ok) {
                        const logText = await logResp.text()
                        // Pega as últimas 2KB do log — onde geralmente está o erro
                        const logSlice = logText.length > 2048
                          ? '...(log truncado)...\n' + logText.slice(-2048)
                          : logText
                        jobLog = `**Log do job "${failedJob.name}":**\n\`\`\`\n${logSlice}\n\`\`\``
                      }
                    }
                  }
                }
              }
            } catch { /* best-effort — job logs are optional */ }
          }

          const parts = [
            summary || text ? `### ${failedRun.name}\n${summary}\n${text}`.trim() : '',
            jobLog,
          ].filter(Boolean)
          if (parts.length) details.push(parts.join('\n\n'))
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

  // If the stored repoId no longer has a token (deleted/recreated), find the current active repo
  let effectivePrRepoId = prInfo.repoId
  let prRepoToken = repoRow?.access_token
  if (!prRepoToken) {
    const fallback = await dbGet<{ id: number; access_token: string }>(
      `SELECT id, access_token FROM git_repositories
       WHERE workspace_id = ? AND is_active = 1 AND access_token IS NOT NULL AND TRIM(access_token) != ''
       ORDER BY created_at DESC LIMIT 1`,
      [run.workspace_id]
    )
    if (fallback?.id) {
      logger.info({ run_id: run.id, old_repo_id: prInfo.repoId, new_repo_id: fallback.id }, 'checkAndAdvancePRCI: stored repoId has no token, using active workspace repo')
      effectivePrRepoId = fallback.id
      prRepoToken = fallback.access_token
      // Update pr_check_json so future ticks use the correct repo
      const updatedPrInfo = { ...prInfo, repoId: fallback.id }
      await dbRun('UPDATE pipeline_card_runs SET pr_check_json = ? WHERE id = ?', [JSON.stringify(updatedPrInfo), run.id])
    }
  }

  if (!prRepoToken) return

  let ciResult: { status: 'pending' | 'passed' | 'failed'; summary: string; failureDetails?: string }
  try {
    ciResult = await checkGitHubCIStatus({ owner: prInfo.owner, repo: prInfo.repo, prNumber: prInfo.prNumber, token: prRepoToken! })
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
  const ciRepoContext = await fetchRepoContext(effectivePrRepoId)

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
    const pushResult = await pushCodeToGitHub(effectivePrRepoId, run.card_key, run.card_title, llmResult.text)
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

// ─── PR Review feedback loop ──────────────────────────────────────────────────
//
// Quando um PR é aberto e o agente não faz CI polling (GitLab, ou repos sem token CI),
// ainda assim queremos detectar rejeições humanas no PR (comentários com LGTM/APPROVED
// vs CHANGES REQUESTED / "not approved" / "precisa corrigir") e devolver ao developer.
//

interface PRReviewInfo {
  repoId: number
  stageId: string
  prNumber: number
  prUrl: string
  owner?: string
  repo?: string
  checkedAt: number
}

const PR_REVIEW_REJECTION_PATTERNS = [
  /CHANGES[_\s]REQUESTED/i,
  /request(?:ing|ed)?\s+changes/i,
  /não\s+aprovo/i,
  /precisa\s+corrig/i,
  /refazer/i,
  /não\s+está\s+pronto/i,
  /bloqueado/i,
  /blocked/i,
  /REJECTED/i,
  /reprovado/i,
]

const PR_REVIEW_APPROVAL_PATTERNS = [
  /\bLGTM\b/,
  /\bAPPROVED\b/i,
  /looks?\s+good/i,
  /aprovado/i,
  /pode\s+merge/i,
  /can\s+merge/i,
]

async function checkPRReviewFeedback(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
): Promise<void> {
  if (!run.pr_review_json) return

  let prInfo: PRReviewInfo
  try {
    prInfo = JSON.parse(run.pr_review_json)
  } catch {
    return
  }

  // Só verifica uma vez por tick (evita polling excessivo)
  const now = Math.floor(Date.now() / 1000)
  if (now - prInfo.checkedAt < 60) return

  // Atualiza timestamp para não verificar novamente até o próximo tick
  const updatedInfo: PRReviewInfo = { ...prInfo, checkedAt: now }
  await dbRun('UPDATE pipeline_card_runs SET pr_review_json = ? WHERE id = ?', [JSON.stringify(updatedInfo), run.id])

  // Busca comentários novos no PR via GitHub API (se disponível) ou via card Jira
  let prComments: string[] = []
  if (prInfo.owner && prInfo.repo && prInfo.prNumber) {
    try {
      const repoRow = await dbGet<{ access_token: string | null }>(
        'SELECT access_token FROM git_repositories WHERE id = ?', [prInfo.repoId]
      )
      if (repoRow?.access_token) {
        const response = await fetch(
          `https://api.github.com/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.prNumber}/reviews`,
          { headers: { Authorization: `token ${repoRow.access_token}`, Accept: 'application/vnd.github.v3+json' } }
        )
        if (response.ok) {
          const reviews = await response.json() as Array<{ state: string; body: string }>
          prComments = reviews.map(r => r.state + ' ' + (r.body ?? ''))
        }
      }
    } catch (err) {
      logger.warn({ err, run_id: run.id }, 'pipeline-engine: PR review check failed')
      return
    }
  }

  if (!prComments.length) return

  const allText = prComments.join('\n')

  // Verificar aprovação explícita
  const isApproved = PR_REVIEW_APPROVAL_PATTERNS.some(p => p.test(allText))
  if (isApproved) {
    // PR aprovado — limpa pr_review_json e avança
    await dbRun('UPDATE pipeline_card_runs SET pr_review_json = NULL, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
    const approvedMsg = `✅ **PR aprovado por revisão humana** — avançando para a próxima etapa.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, approvedMsg)
    // ── Métrica: PR aprovado ──
    dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_num, stage_name, created_at)
           VALUES (?, ?, ?, 'pr_approved', 1, ?, UNIX_TIMESTAMP())`,
      [run.workspace_id, run.id, run.card_key, column.column_name]
    ).catch(() => {})
    await advanceToNextColumn({ ...run, status: 'running' }, column, cfg, secrets, '')
    return
  }

  // Verificar rejeição
  const isRejected = PR_REVIEW_REJECTION_PATTERNS.some(p => p.test(allText))
  if (!isRejected) return

  // PR rejeitado — fechar o PR e notificar no card. NÃO re-executar o developer automaticamente.
  // O humano decidiu rejeitar — a decisão do próximo passo é dele.
  logger.info({ run_id: run.id, card_key: run.card_key }, 'pipeline-engine: PR rejected by human reviewer — closing PR and notifying')

  await dbRun('UPDATE pipeline_card_runs SET pr_review_json = NULL, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])

  const rejectionContext = prComments.slice(-5).join('\n---\n')

  // Tenta fechar o PR no GitHub (estado: closed)
  if (prInfo.owner && prInfo.repo && prInfo.prNumber) {
    try {
      const repoRow = await dbGet<{ access_token: string | null }>(
        'SELECT access_token FROM git_repositories WHERE id = ?', [prInfo.repoId]
      )
      if (repoRow?.access_token) {
        await fetch(
          `https://api.github.com/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.prNumber}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `token ${repoRow.access_token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state: 'closed' }),
          }
        )
        logger.info({ run_id: run.id, pr: prInfo.prNumber }, 'pipeline-engine: PR closed after rejection')
      }
    } catch (closeErr) {
      logger.warn({ closeErr, run_id: run.id }, 'pipeline-engine: failed to close rejected PR')
    }
  }

  const rejectionMsg = [
    `🚫 **PR #${prInfo.prNumber} rejeitado e fechado**`,
    ``,
    `**Feedback do revisor:**`,
    rejectionContext.slice(0, 800),
    ``,
    `⏸️ Esteira pausada. Responda com \`reprocessar\` para corrigir e reabrir, ou \`cancelar\` para encerrar.`,
  ].join('\n')
  await postCardComment(run.provider, cfg, secrets, run.card_key, rejectionMsg)
  await updateRun(run.id, { status: 'waiting_input' })

  try {
    db_helpers.logActivity(
      'pipeline.pr_review_rejected',
      'pipeline_card',
      run.id,
      'pipeline',
      `PR #${prInfo.prNumber} rejeitado — ${run.card_key} pausado aguardando decisão humana`,
      { card_key: run.card_key, card_title: run.card_title, pr_number: prInfo.prNumber },
      run.workspace_id
    )
  } catch { /* non-critical */ }
}

// ─── Estimativa automática de story points ────────────────────────────────────
//
// Chamada de forma não-bloqueante após o arquiteto concluir.
// Usa o LLM do pipeline para estimar story points e posta no card como comentário
// informativo. O pipeline continua sem esperar.
//

async function generateEstimate(
  run: PipelineCardRun,
  column: PipelineColumn,
  cfg: WorkPipelineConfigJson,
  architect: AgentFullRow,
  architectOutput: string,
  repos: Array<{ id: number; name: string; context: string }>,
): Promise<void> {
  const estimatePrompt = [
    `# Estimativa de esforço — ${run.card_key}: ${run.card_title}`,
    ``,
    `## Descrição do card`,
    run.card_description?.slice(0, 1000) || '(sem descrição)',
    ``,
    `## Decisão arquitetural`,
    architectOutput.slice(0, 3000),
    ``,
    `## Repositórios envolvidos`,
    repos.map(r => `- ${r.name}`).join('\n') || '(nenhum)',
    ``,
    `## Sua tarefa`,
    `Você é um estimador técnico especializado em story points (escala Fibonacci: 1, 2, 3, 5, 8, 13).`,
    ``,
    `Analise o card e a decisão arquitetural acima e produza uma estimativa objetiva no seguinte formato EXATO:`,
    ``,
    `ESTIMATIVA: <número fibonacci>`,
    `CONFIANÇA: <Alta|Média|Baixa>`,
    ``,
    `JUSTIFICATIVA:`,
    `- Complexidade técnica: <1 linha>`,
    `- Repositórios afetados: <número e nomes>`,
    `- Tipo de mudança: <ex: novo endpoint, refatoração, migration, UI nova>`,
    `- Riscos identificados: <1-2 linhas ou "Nenhum">`,
    `- Premissas: <o que precisa ser verdade para esta estimativa ser válida>`,
    ``,
    `Seja direto e objetivo. Não invente informações que não estejam no card ou na decisão arquitetural.`,
  ].join('\n')

  const estimateAgent: AgentFullRow = {
    ...architect,
    name: 'Estimador',
    role: 'estimator',
    soul_content: 'Você é um estimador técnico imparcial. Estime story points com base em evidências concretas, não em suposições.',
    instructions: null,
    config: null,
    _skills: undefined,
  } as AgentFullRow & { _skills?: string }

  const result = await callAgentLLM(estimateAgent as AgentFullRow, estimatePrompt, cfg, undefined, 'simple')

  // Extrai a estimativa do output
  const pontsMatch = result.text.match(/ESTIMATIVA:\s*(\d+)/)
  const confMatch = result.text.match(/CONFIANÇA:\s*(Alta|Média|Baixa)/i)
  const points = pontsMatch?.[1] ?? '?'
  const confidence = confMatch?.[1] ?? '?'

  const estimateComment = [
    `📊 **Estimativa automática — ${run.card_key}**`,
    ``,
    `| Story Points | Confiança |`,
    `|---|---|`,
    `| **${points}** | ${confidence} |`,
    ``,
    result.text
      .replace(/ESTIMATIVA:.*\n?/, '')
      .replace(/CONFIANÇA:.*\n?/, '')
      .trim()
      .slice(0, 1200),
    ``,
    `*Estimativa gerada automaticamente após análise arquitetural — revise se necessário.*`,
  ].join('\n')

  const commentId = await postCardComment(run.provider, cfg, {}, run.card_key, estimateComment).catch(() => null)
  if (commentId) {
    await logMessage(run.id, 'agent_to_card', String(column.id), estimateComment, commentId)
  }

  // Registra métricas
  try {
    await dbRun(
      `INSERT OR IGNORE INTO pipeline_quality_metrics
        (workspace_id, run_id, card_key, metric_type, value_num, value_text, stage_name, agent_name, created_at)
       VALUES (?, ?, ?, 'story_points_estimate', ?, ?, ?, ?, UNIX_TIMESTAMP())`,
      [run.workspace_id, run.id, run.card_key, Number(points) || null, result.text.slice(0, 2000), column.column_name, architect.name]
    )
  } catch { /* non-critical */ }

  logger.info({ run_id: run.id, card_key: run.card_key, points, confidence }, 'pipeline-engine: estimate posted')
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
  // Design system and agent instructions — read first so agents know the UI contract
  'AGENTS.md', 'docs/AGENTS.md',
  'design-system.md', 'DESIGN-SYSTEM.md', 'docs/design-system.md',
  'design-tokens.md', 'DESIGN-TOKENS.md', 'docs/design-tokens.md',
  'design-tokens.json', 'tokens.json', 'src/tokens.json',
  'src/design-tokens.ts', 'src/design-tokens.js',
  'src/styles/tokens.ts', 'src/styles/tokens.js', 'src/styles/tokens.css',
  'src/styles/globals.css', 'src/app/globals.css',
  'tailwind.config.ts', 'tailwind.config.js',
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

// ─── Screenshot-to-code: busca e descreve imagens do card ────────────────────
//
// Quando o card do Jira/Azure tem screenshots ou wireframes como attachments,
// o LLM de visão os descreve em texto estruturado. Essa descrição é injetada
// no prompt do Developer e do BA como especificação visual da tela.
//

/**
 * Baixa até MAX_VISION_IMAGES imagens do card e usa o LLM configurado no pipeline
 * (mesmo provider/modelo do agente que está executando) para descrever cada uma.
 * Retorna um bloco markdown pronto para injetar no prompt.
 *
 * Nenhum provider ou modelo é hardcoded — tudo vem de cfg + assignmentModel,
 * exatamente como qualquer chamada de agente no pipeline.
 */
const MAX_VISION_IMAGES = 3  // limite para não explodir o contexto

async function describeAttachmentImages(
  cardProvider: string,       // 'jira' | 'azure_devops' — provedor do card (Jira/Azure)
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  agent: AgentFullRow,        // agente executor — define o LLM a usar
  assignmentModel?: string,   // modelo configurado no dropdown da coluna
): Promise<string> {
  // 1. Busca attachments do provedor do card
  type Att = { id: string; filename: string; mimeType: string; contentUrl: string; size: number }
  let attachments: Att[] = []
  try {
    if (cardProvider === 'jira') {
      attachments = await fetchJiraAttachments(cfg, secrets, cardKey)
    } else if (cardProvider === 'azure_devops') {
      attachments = await fetchAzureAttachments(cfg, secrets, cardKey)
    }
  } catch (err) {
    logger.warn({ err, cardKey }, 'pipeline-engine: failed to fetch card attachments')
    return ''
  }

  if (!attachments.length) return ''

  // 2. Resolve provider/modelo via configuração do pipeline — sem hardcode
  const { provider: llmProvider, model: llmModel } = resolveProviderAndModel(cfg, assignmentModel, 'simple')
  const apiKey = await resolveApiKey(llmProvider).catch(() => null)

  if (!apiKey && llmProvider !== 'ollama') {
    // Sem chave configurada: lista os arquivos para o agente acessar manualmente
    return [
      `## 🖼️ Imagens/wireframes anexados ao card`,
      ``,
      `> ⚠️ Nenhuma chave de API configurada para o provider **${llmProvider}** — as imagens não puderam ser descritas automaticamente.`,
      `> Acesse o card e analise manualmente os seguintes anexos antes de implementar:`,
      ``,
      ...attachments.map(a => `- **${a.filename}** (${(a.size / 1024).toFixed(0)} KB)`),
    ].join('\n')
  }

  const toDescribe = attachments.slice(0, MAX_VISION_IMAGES)
  const descriptions: string[] = []

  for (const att of toDescribe) {
    // 3. Baixa a imagem como base64
    let base64: string | null = null
    try {
      if (cardProvider === 'jira') {
        base64 = await downloadJiraAttachment(cfg, secrets, att.contentUrl)
      } else if (cardProvider === 'azure_devops') {
        base64 = await downloadAzureAttachment(cfg, secrets, att.contentUrl)
      }
    } catch (err) {
      logger.warn({ err, filename: att.filename }, 'pipeline-engine: failed to download attachment')
      continue
    }
    if (!base64) continue

    // 4. Monta o agente de visão com system prompt especializado
    //    Usa o mesmo agente executor mas com instruções de visão UI
    const visionSystemPrompt = `Você é um especialista em UI/UX que descreve telas e wireframes para desenvolvedores.
Ao analisar uma imagem de UI, descreva:
1. Layout geral (header, sidebar, main content, footer)
2. Componentes presentes (botões, inputs, tabelas, cards, modais)
3. Hierarquia visual e agrupamento
4. Textos e labels visíveis
5. Estados (loading, vazio, erro, sucesso) se visíveis
6. Cores predominantes e padrão visual
Seja específico e objetivo. Use linguagem técnica de frontend.`

    const visionAgent: AgentFullRow = {
      ...agent,
      soul_content: visionSystemPrompt,
      instructions: null,
      config: null,
    }

    // 5. Monta o prompt com a imagem no formato que o provider aceita
    //    Providers que suportam visão nativamente: anthropic, openai, google/gemini
    //    Para os demais: envia só o texto com nome do arquivo
    const visionTextPrompt = `Descreva esta imagem de UI/wireframe (arquivo: ${att.filename}) para um desenvolvedor frontend implementar a tela. Seja detalhado e preciso.`

    // Verifica se o provider suporta visão (imagem em base64)
    const supportsVision = ['anthropic', 'openai', 'openrouter', 'gemini'].includes(llmProvider)

    try {
      let description = ''

      if (supportsVision) {
        // Chama direto a API para enviar imagem — dispatchLLM só aceita texto
        // Usamos a mesma chave/base já resolvida
        if (llmProvider === 'anthropic') {
          const model = llmModel || 'claude-3-5-sonnet-20241022'
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model,
              max_tokens: 1024,
              system: visionSystemPrompt,
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: att.mimeType, data: base64 } },
                  { type: 'text', text: visionTextPrompt },
                ],
              }],
            }),
            signal: AbortSignal.timeout(30_000),
          })
          if (res.ok) {
            const data = await res.json() as { content: Array<{ type: string; text: string }> }
            description = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
          }
        } else if (['openai', 'openrouter'].includes(llmProvider)) {
          const base = llmProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'
          const model = llmModel || 'gpt-4o'
          const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              max_tokens: 1024,
              messages: [
                { role: 'system', content: visionSystemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${base64}` } },
                    { type: 'text', text: visionTextPrompt },
                  ],
                },
              ],
            }),
            signal: AbortSignal.timeout(30_000),
          })
          if (res.ok) {
            const data = await res.json() as { choices: Array<{ message: { content: string } }> }
            description = data.choices?.[0]?.message?.content ?? ''
          }
        } else if (llmProvider === 'gemini') {
          const model = llmModel || 'gemini-1.5-flash'
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey! },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: visionSystemPrompt }] },
                contents: [{
                  role: 'user',
                  parts: [
                    { inline_data: { mime_type: att.mimeType, data: base64 } },
                    { text: visionTextPrompt },
                  ],
                }],
              }),
              signal: AbortSignal.timeout(30_000),
            }
          )
          if (res.ok) {
            const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
            description = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
          }
        }
      } else {
        // Provider sem suporte a visão (ollama, deepseek, etc.) —
        // envia o nome do arquivo como contexto textual
        const result = await dispatchLLM(
          visionAgent,
          `${visionTextPrompt}\n\n[Nota: a imagem "${att.filename}" está anexada ao card mas o modelo atual não suporta visão. Informe ao Developer que ele deve analisar a imagem manualmente antes de implementar.]`,
          cfg,
          llmProvider,
          llmModel
        )
        description = result.text
      }

      if (description.trim()) {
        descriptions.push(`### 🖼️ ${att.filename}\n\n${description.trim()}`)
      }
    } catch (err) {
      logger.warn({ err, filename: att.filename, provider: llmProvider }, 'pipeline-engine: vision description failed')
    }
  }

  if (!descriptions.length) return ''

  const omitted = attachments.length - toDescribe.length
  return [
    `## 🖼️ Contexto visual — imagens do card (${toDescribe.length} de ${attachments.length})`,
    ``,
    `> As imagens abaixo foram analisadas automaticamente com o modelo **${llmProvider}${llmModel ? ':' + llmModel : ''}**.`,
    `> Use-as como especificação visual da tela a implementar.`,
    `> Siga o \`design-system.md\` do repositório ao escolher componentes e tokens de cor.`,
    ``,
    descriptions.join('\n\n---\n\n'),
    omitted > 0 ? `\n> ⚠️ ${omitted} imagem(ns) adicional(is) não descritas (limite de ${MAX_VISION_IMAGES} por execução).` : '',
  ].filter(Boolean).join('\n')
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
          '',
          'Para solicitar abertura de Pull Request / Merge Request após o commit, inclua na sua resposta:',
          'OPEN_PR: true',
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

class CardNotFoundError extends Error {
  constructor(cardKey: string) {
    super(`Card ${cardKey} not found (404) — cancelled run`)
    this.name = 'CardNotFoundError'
  }
}

async function postCardComment(
  provider: string,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  body: string,
  runId?: number
): Promise<string | null> {
  try {
    if (provider === 'jira') {
      const r = await postJiraComment(cfg, secrets, cardKey, body)
      // Auto-registra o ID no banco para que o filtro ecoProprio funcione corretamente.
      // Sem esse registro, o motor pode reler o próprio comentário na próxima rodada e
      // entrar em loop. Qualquer comentário postado pelo AURA precisa ter seu ID salvo.
      if (r.commentId && runId) {
        dbRun(
          `INSERT IGNORE INTO pipeline_card_messages (run_id, direction, stage_id, body, external_comment_id, created_at)
           VALUES (?, 'agent_to_card', '0', ?, ?, UNIX_TIMESTAMP())`,
          [runId, body.slice(0, 10000), r.commentId]
        ).catch(() => {})
      }
      return r.commentId
    }
    if (provider === 'azure_devops') {
      const r = await postAzureComment(cfg, secrets, cardKey, body)
      if (r.commentId && runId) {
        dbRun(
          `INSERT IGNORE INTO pipeline_card_messages (run_id, direction, stage_id, body, external_comment_id, created_at)
           VALUES (?, 'agent_to_card', '0', ?, ?, UNIX_TIMESTAMP())`,
          [runId, body.slice(0, 10000), r.commentId]
        ).catch(() => {})
      }
      return r.commentId
    }
  } catch (err: any) {
    const is404 = err?.message?.includes('404')
    if (is404 && runId) {
      logger.warn({ runId, cardKey }, 'pipeline-engine: card deleted from Jira/Azure — cancelling run')
      await dbRun(
        `UPDATE pipeline_card_runs SET status = 'cancelled', updated_at = UNIX_TIMESTAMP() WHERE id = ? AND status NOT IN ('done','cancelled')`,
        [runId]
      ).catch(() => {})
      throw new CardNotFoundError(cardKey)
    }
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
): Promise<{ moved: boolean; reason?: string }> {
  try {
    if (provider === 'jira') {
      await transitionJiraIssue(cfg, secrets, cardKey, targetStatus)
    } else if (provider === 'azure_devops') {
      await moveAzureWorkItem(cfg, secrets, cardKey, targetStatus)
    }
    return { moved: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ err, cardKey, targetStatus }, 'pipeline-engine: failed to move card')
    return { moved: false, reason: msg }
  }
}

// ─── Context summary (memória de execução por run) ───────────────────────────

interface ContextEntry {
  stage: string
  agent: string
  role: string
  decision: string // primeira linha não-vazia do output — resume a decisão
  gate: string | null // ex: ANALYSIS: READY, ARCHITECTURE: APPROVED
  timestamp: number
}

/** Acumula a decisão de um agente no context_summary_json do run */
async function appendContextSummary(
  runId: number,
  stageName: string,
  agentName: string,
  agentRole: string,
  output: string,
): Promise<void> {
  try {
    const existing = (await dbGet<{ context_summary_json: string | null }>(
      'SELECT context_summary_json FROM pipeline_card_runs WHERE id = ?', [runId]
    ))?.context_summary_json

    const entries: ContextEntry[] = existing ? JSON.parse(existing) : []

    // Extrai gate do output — cobre todos os papéis do pipeline
    const gateMatch = output.match(/\b(ANALYSIS|ARCHITECTURE|ARCHITECTURE_REVIEW|IMPLEMENTATION|VERDICT|QA|SECURITY|DATA|UX|PRODUCT|PRIORITY|FLOW|RELEASE|DISCOVERY|COORDINATION):\s*(\w+)/i)
    const gate = gateMatch ? `${gateMatch[1].toUpperCase()}: ${gateMatch[2].toUpperCase()}` : null

    // Primeira linha significativa do output como resumo
    const decision = output.split('\n').map(l => l.trim()).find(l => l.length > 20 && !l.startsWith('#')) ?? output.slice(0, 120)

    entries.push({ stage: stageName, agent: agentName, role: agentRole, decision: decision.slice(0, 200), gate, timestamp: Math.floor(Date.now() / 1000) })

    // Mantém apenas as últimas 20 entradas para não explodir o contexto
    const trimmed = entries.slice(-20)
    await updateRun(runId, { context_summary_json: JSON.stringify(trimmed) })
  } catch { /* non-critical */ }
}

/** Formata o context_summary_json como bloco de texto para injetar no prompt */
function formatContextSummary(summaryJson: string | null): string {
  if (!summaryJson) return ''
  try {
    const entries: ContextEntry[] = JSON.parse(summaryJson)
    if (!entries.length) return ''
    const lines = entries.map(e =>
      `- **${e.stage}** (${e.agent}, ${e.role})${e.gate ? ` → ${e.gate}` : ''}: ${e.decision}`
    )
    return `## Histórico de decisões deste card\n\n${lines.join('\n')}\n`
  } catch { return '' }
}

// ─── Stage snapshots (replay/rollback) ───────────────────────────────────────

interface StageSnapshot {
  stage_id: string
  stage_name: string
  card_key: string
  card_title: string
  card_description: string
  status_before: string
  messages_count: number
  timestamp: number
}

/** Salva snapshot do estado antes de iniciar uma etapa */
async function saveStageSnapshot(run: PipelineCardRun, column: PipelineColumn): Promise<void> {
  try {
    const existing = (await dbGet<{ stage_snapshots_json: string | null }>(
      'SELECT stage_snapshots_json FROM pipeline_card_runs WHERE id = ?', [run.id]
    ))?.stage_snapshots_json

    const snapshots: StageSnapshot[] = existing ? JSON.parse(existing) : []

    const msgCount = (await dbGet<{ n: number }>(
      'SELECT COUNT(*) as n FROM pipeline_card_messages WHERE run_id = ?', [run.id]
    ))?.n ?? 0

    snapshots.push({
      stage_id: String(column.id),
      stage_name: column.column_name,
      card_key: run.card_key,
      card_title: run.card_title,
      card_description: run.card_description?.slice(0, 500) ?? '',
      status_before: run.status,
      messages_count: msgCount,
      timestamp: Math.floor(Date.now() / 1000),
    })

    // Mantém os últimos 10 snapshots
    const trimmed = snapshots.slice(-10)
    await updateRun(run.id, { stage_snapshots_json: JSON.stringify(trimmed) })
  } catch { /* non-critical */ }
}

/** Retorna os snapshots de um run para a API de replay */
export async function getRunSnapshots(runId: number): Promise<StageSnapshot[]> {
  try {
    const raw = (await dbGet<{ stage_snapshots_json: string | null }>(
      'SELECT stage_snapshots_json FROM pipeline_card_runs WHERE id = ?', [runId]
    ))?.stage_snapshots_json
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// ─── Loop detection (detecção de loop semântico) ─────────────────────────────

const LOOP_STAGE_THRESHOLD = 3   // mesma etapa N vezes = suspeita de loop
const LOOP_SIMILARITY_CHARS = 100 // primeiros N chars do output para comparar

/** Detecta se o run está em loop semântico na etapa atual */
async function detectSemanticLoop(
  runId: number,
  stageId: string,
  currentOutput: string,
): Promise<boolean> {
  try {
    // Conta quantas vezes já executou esta etapa
    const { n: stageCount } = (await dbGet<{ n: number }>(
      `SELECT COUNT(*) as n FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND direction = 'agent_to_card' AND body LIKE '🤖 **%'`,
      [runId, stageId]
    )) ?? { n: 0 }

    if (stageCount < LOOP_STAGE_THRESHOLD) return false

    // Pega os últimos outputs desta etapa
    const lastOutputs = await dbGetAll<{ body: string }>(
      `SELECT body FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND direction = 'agent_to_card' AND body LIKE '🤖 **%' ORDER BY created_at DESC LIMIT 3`,
      [runId, stageId]
    )

    // Compara os primeiros chars de cada output — se forem muito similares, é loop
    const currentPrefix = currentOutput.slice(0, LOOP_SIMILARITY_CHARS).toLowerCase().trim()
    const similarCount = lastOutputs.filter(r =>
      r.body.slice(0, LOOP_SIMILARITY_CHARS + 50).toLowerCase().includes(currentPrefix.slice(0, 50))
    ).length

    return similarCount >= 2
  } catch { return false }
}

// ─── Sandbox Docker (execução de testes antes do PR) ─────────────────────────

import { extractTestCommand, detectSandboxImage, runInSandbox, cloneRepoToTemp, isSandboxAvailable } from './sandbox-runner'

/**
 * Executa os testes do repositório num container Docker efêmero.
 * Chamado após push de código e antes de abrir o PR.
 * Retorna mensagem formatada para postar no card.
 */
async function runSandboxTests(
  agentOutput: string,
  repoId: number,
  repoContext: string,
  cardKey: string,
): Promise<{ passed: boolean; message: string } | null> {
  // Verifica se o sandbox está disponível
  if (!(await isSandboxAvailable())) {
    logger.info({ cardKey }, 'sandbox-runner: Docker not available, skipping tests')
    return null
  }

  // Extrai comando do output do agente
  const testCmd = extractTestCommand(agentOutput)
  if (!testCmd) return null

  const repo = await dbGet<{ repo_url: string; access_token: string | null; branch: string }>(
    'SELECT repo_url, access_token, branch FROM git_repositories WHERE id = ?', [repoId]
  )
  if (!repo?.access_token) return null

  const image = detectSandboxImage(repoContext, agentOutput)
  let cloned: { path: string; cleanup: () => Promise<void> } | null = null

  try {
    cloned = await cloneRepoToTemp(repo.repo_url, repo.access_token, repo.branch || 'main')
    const result = await runInSandbox(testCmd, cloned.path, image)

    const icon = result.ok ? '✅' : '❌'
    const status = result.ok ? 'passaram' : 'falharam'
    const duration = (result.durationMs / 1000).toFixed(1)

    const message = [
      `${icon} **Testes ${status}** — \`${testCmd}\` (${duration}s, imagem: \`${image}\`)`,
      ``,
      result.stdout ? `**Output:**\n\`\`\`\n${result.stdout.slice(0, 2000)}\n\`\`\`` : '',
      result.stderr && !result.ok ? `**Erros:**\n\`\`\`\n${result.stderr.slice(0, 1000)}\n\`\`\`` : '',
    ].filter(Boolean).join('\n')

    return { passed: result.ok, message }
  } catch (err: any) {
    logger.warn({ err, cardKey }, 'sandbox-runner: test execution failed')
    return {
      passed: false,
      message: `⚠️ **Falha ao executar sandbox de testes**: ${err.message ?? String(err)}`,
    }
  } finally {
    await cloned?.cleanup()
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
  const stageStartedAt = Math.floor(Date.now() / 1000) // para calcular duração da etapa
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
    const cid = await postCardComment(run.provider, cfg, secrets, run.card_key, noAgentMsg, run.id)
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
    const startCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, startMsg, run.id)
    await logMessage(run.id, 'agent_to_card', stageId, startMsg, startCommentId ?? undefined)
  } else {
    const resumeMsg = `🔄 **Retomando ${column.column_name}** a partir de **${pendingAgents[0].name}** (${completedAgentIds.size}/${agents.length} agentes já concluídos)`
    const resumeId = await postCardComment(run.provider, cfg, secrets, run.card_key, resumeMsg, run.id)
    await logMessage(run.id, 'agent_to_card', stageId, resumeMsg, resumeId ?? undefined)
  }

  await updateRun(run.id, { current_stage_id: stageId, status: 'running' })
  eventBus.broadcast('pipeline.stage_started', { run_id: run.id, card_key: run.card_key, stage: column.column_name, agent: pendingAgents[0].name })

  // Snapshot do estado antes de iniciar (para replay/rollback)
  await saveStageSnapshot(run, column)

  // Carry forward output from already-completed agents as context
  const outputParts: string[] = (await dbGetAll(`SELECT body FROM pipeline_card_messages WHERE run_id = ? AND stage_id = ? AND body LIKE '🤖 **%' ORDER BY created_at ASC`, [run.id, stageId]) as { body: string }[]).map(r => r.body)

  // Resolve the active repository for this stage.
  // Priority: assignment dropdown > linkedRepoIds (first valid with token) > any workspace repo with token
  // IDs in linkedRepoIds that no longer exist or have no token are silently skipped.
  async function resolveActiveRepo(workspaceId: number): Promise<number | null> {
    // 1. Per-agent dropdown — validated below per-agent, skip here
    // 2. Repos linked in "Repositórios do sistema" — skip deleted or token-less ones
    const linkedIds: number[] = Array.isArray((cfg as any).linkedRepoIds) ? (cfg as any).linkedRepoIds as number[] : []
    for (const rid of linkedIds) {
      const r = await dbGet<{ id: number; access_token: string | null }>(
        'SELECT id, access_token FROM git_repositories WHERE id = ? AND workspace_id = ? AND is_active = 1',
        [rid, workspaceId]
      )
      if (r?.id && r.access_token && r.access_token.trim()) return r.id
    }

    // 3. Any active repo in the workspace with a token — most recently created first
    const r = await dbGet<{ id: number }>(
      `SELECT id FROM git_repositories
       WHERE workspace_id = ? AND is_active = 1 AND access_token IS NOT NULL AND access_token != ''
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    )
    if (r?.id) return r.id

    // 4. Last resort: any repo in the system with a token (handles workspace_id mismatch)
    const any = await dbGet<{ id: number; workspace_id: number }>(
      `SELECT id, workspace_id FROM git_repositories
       WHERE is_active = 1 AND access_token IS NOT NULL AND access_token != ''
       ORDER BY created_at DESC LIMIT 1`,
      []
    )
    if (any?.id) {
      logger.warn({ run_workspace: workspaceId, repo_workspace: any.workspace_id, repoId: any.id }, 'pipeline-engine: using cross-workspace repo as last resort')
      return any.id
    }

    logger.error({ workspaceId, linkedIds }, 'pipeline-engine: no active repo with token found')
    return null
  }

  const stageRepoId = await resolveActiveRepo(run.workspace_id)
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
    const ctx = await Promise.race([
      fetchRepoContext(repoRow.id),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 5 * 60 * 1000)),
    ])
    stageRepos.push({ id: repoRow.id, name: repoRow.name, context: ctx })
  }

  // Fallback: if no linked repos resolved, try workspace default
  if (stageRepos.length === 0 && stageRepoId) {
    const ctx = await Promise.race([
      fetchRepoContext(stageRepoId),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 5 * 60 * 1000)),
    ])
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

    // ── Contexto corretivo: injeta motivo da última rejeição pelo harness nesta etapa ──
    // Permite que o agente saiba exatamente por que foi bloqueado e corrija no retry.
    let correctionContext = ''
    try {
      const lastRejection = await dbGet<{ value_text: string; agent_name: string; created_at: number }>(
        `SELECT value_text, agent_name, created_at
         FROM pipeline_quality_metrics
         WHERE run_id = ? AND stage_name = ? AND metric_type = 'gate_rejected' AND agent_name = ?
         ORDER BY created_at DESC LIMIT 1`,
        [run.id, column.column_name, agent.name]
      )
      if (lastRejection?.value_text) {
        correctionContext = [
          `## ⚠️ Contexto de rejeição anterior`,
          ``,
          `Na tentativa anterior, o harness de qualidade bloqueou sua resposta pelo seguinte motivo:`,
          ``,
          `> ${lastRejection.value_text}`,
          ``,
          `Corrija este problema específico na sua próxima resposta.`,
          ``,
        ].join('\n')
        logger.info({ run_id: run.id, agent: agent.name, stage: column.column_name }, 'pipeline-engine: correction context injected from previous harness rejection')
      }
    } catch { /* non-critical — não bloqueia execução */ }

    const agentSkills = await loadAgentSkills(run.workspace_id)

    // Inject Second Brain context for BA and PM agents
    const sbRoles = ['business analyst', 'product manager', 'product owner']
    let secondBrainContext = ''
    if (sbRoles.some(r => agent.role.toLowerCase().includes(r))) {
      const domain = inferDomain(run.card_title, run.card_description)
      const sbEntries = await searchKnowledge(run.card_title + ' ' + run.card_description, domain, 5)
      if (sbEntries.length > 0) {
        secondBrainContext = formatKnowledgeContext(sbEntries, domain)
        logger.info({ run_id: run.id, agent: agent.name, domain, entries: sbEntries.length }, 'second-brain: context injected')
      }
    }

    // Inject Knowledge Context — fontes externas configuradas na skill do agente
    // (Jira histórico, Miro, Confluence, SharePoint)
    // Ativado para BA, PM, PO, Arquiteto e UX — papéis que precisam de contexto de negócio/produto
    const knowledgeRoles = ['business analyst', 'product manager', 'product owner', 'software architect', 'ux designer', 'discovery']
    let knowledgeContext = ''
    if (knowledgeRoles.some(r => agent.role.toLowerCase().includes(r))) {
      try {
        // Lê a skill do agente para encontrar as fontes configuradas
        const agentSkillContent = agentSkills  // já carregado acima
        const sources = parseKnowledgeSources(agentSkillContent)
        if (sources.length > 0) {
          knowledgeContext = await buildKnowledgeContext(
            agentSkillContent,
            cfg,
            secrets,
            run.card_key,
            run.card_title,
            run.card_description ?? '',
          )
          if (knowledgeContext) {
            logger.info(
              { run_id: run.id, agent: agent.name, sources: sources.map(s => s.type) },
              'knowledge-context: external context injected'
            )
          }
        }
      } catch (err) {
        logger.warn({ err, run_id: run.id, agent: agent.name }, 'knowledge-context: failed (non-critical)')
      }
    }

    // Inject visual context (screenshots/wireframes from card attachments) for Developer and BA
    // Only roles that implement UI or write requirements benefit from visual context
    const visualRoles = ['developer', 'business analyst', 'frontend', 'fullstack', 'ui', 'ux']
    let visualContext = ''
    if (visualRoles.some(r => agent.role.toLowerCase().includes(r))) {
      try {
        visualContext = await describeAttachmentImages(
          run.provider,
          cfg,
          secrets,
          run.card_key,
          agent,
          assignment.llm_model,
        )
        if (visualContext) {
          logger.info({ run_id: run.id, agent: agent.name }, 'pipeline-engine: visual context injected from card attachments')
        }
      } catch (err) {
        logger.warn({ err, run_id: run.id }, 'pipeline-engine: visual context injection failed (non-critical)')
      }
    }
    // Use the agent's own repo_id if valid and has token, otherwise fall back to stageRepoId
    // (assignment.repo_id may reference a deleted repo — always validate against the DB)
    let effectiveRepoId: number | null = null
    if (assignment.repo_id) {
      const valid = await dbGet<{ id: number }>(
        `SELECT id FROM git_repositories WHERE id = ? AND is_active = 1 AND access_token IS NOT NULL AND TRIM(access_token) != ''`,
        [assignment.repo_id]
      )
      effectiveRepoId = valid?.id ?? null
    }
    if (!effectiveRepoId) effectiveRepoId = stageRepoId ?? null
    const contextSummary = formatContextSummary(run.context_summary_json)
    const prompt = contextSoFar
      + (contextSummary ? contextSummary + '\n\n' : '')
      + (correctionContext ? correctionContext + '\n\n' : '')
      + (secondBrainContext ? secondBrainContext + '\n\n' : '')
      + (knowledgeContext ? knowledgeContext + '\n\n' : '')
      + (visualContext ? visualContext + '\n\n' : '')
      + buildPrompt(run, column, previousMessages, agent.name, agent.role, stageRepos, hasRepo)
    const taskId = await createAgentTask(run, column, agent, prompt, false, assignment.llm_model)
    await updateRun(run.id, { task_id: taskId ?? undefined })

    try {
      const agentWithSkills = { ...agent, _skills: agentSkills }
      const llmResult = await callAgentLLM(agentWithSkills as AgentFullRow, prompt, cfg, assignment.llm_model, classifyCardComplexity(run.card_title, run.card_description))
      const nowDone = Math.floor(Date.now() / 1000)

      // ── Harness validation ──────────────────────────────────────────────────
      const skillPath = await resolveSkillPathForRole(agent.role)
      const harnessResult = validateAgentOutput(llmResult.text, {
        agentRole: agent.role,
        cardKey: run.card_key,
        hasRepo: hasRepo,
        columnInstructions: column.instructions,
        skillPath,
      })
      if (!harnessResult.ok) {
        const rejectionMsg = formatHarnessRejection(harnessResult.reason!, agent.name, run.card_key)
        logger.warn({ run_id: run.id, agent: agent.name, role: agent.role, reason: harnessResult.reason }, 'pipeline-engine: harness rejected agent output')
        await postCardComment(run.provider, cfg, secrets, run.card_key, rejectionMsg, run.id)
        // Atualiza last_comment_ts para NOW para não reler o comentário que causou o loop
        await updateRun(run.id, {
          status: 'waiting_input',
          task_id: null,
          last_comment_ts: Math.floor(Date.now() / 1000),
        })
        await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowDone, agent.id])
        // ── Métrica: gate rejeitado ──
        dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_text, stage_name, agent_name, created_at)
               VALUES (?, ?, ?, 'gate_rejected', ?, ?, ?, UNIX_TIMESTAMP())`,
          [run.workspace_id, run.id, run.card_key, harnessResult.reason ?? 'unknown', column.column_name, agent.name]
        ).catch(() => {})
        return // stop processing this stage — wait for human intervention
      }
      // ── Métrica: gate aprovado ──
      dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_text, stage_name, agent_name, created_at)
             VALUES (?, ?, ?, 'gate_passed', ?, ?, ?, UNIX_TIMESTAMP())`,
        [run.workspace_id, run.id, run.card_key, 'ok', column.column_name, agent.name]
      ).catch(() => {})
      // ── End harness ──────────────────────────────────────────────────────────

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
      // Jira has a ~32KB limit per comment — truncate at 30K to be safe
      const MAX_COMMENT_CHARS = 30_000
      const outputForComment = llmResult.text.length > MAX_COMMENT_CHARS
        ? llmResult.text.slice(0, MAX_COMMENT_CHARS) + `\n\n[...output truncado — ${llmResult.text.length - MAX_COMMENT_CHARS} chars omitidos. Veja o histórico completo no AURA.]`
        : llmResult.text
      const agentComment = [
        `🤖 **${agent.name}** *(${agent.role})* — **${column.column_name}**`,
        '',
        outputForComment,
        '',
        `---`,
        `*Modelo: ${llmResult.model} | Tokens: ${llmResult.inputTokens} in / ${llmResult.outputTokens} out${llmResult.costUsd > 0 ? ` | Custo: $${llmResult.costUsd.toFixed(4)}` : ''}*`,
      ].join('\n')
      const agentCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, agentComment)
      await logMessage(run.id, 'agent_to_card', stageId, agentComment, agentCommentId ?? undefined)

      // Detecta loop semântico — se o run está ciclando na mesma etapa com outputs similares
      const isLoop = await detectSemanticLoop(run.id, stageId, llmResult.text)
      if (isLoop) {
        const loopMsg = [
          `🔄 **Loop detectado em "${column.column_name}"**`,
          ``,
          `Esta etapa foi executada ${LOOP_STAGE_THRESHOLD}+ vezes com outputs similares.`,
          `O pipeline foi pausado para evitar ciclo infinito. Intervenção humana necessária.`,
          ``,
          `Responda com \`reprocessar\` para tentar novamente ou \`cancelar\` para encerrar.`,
        ].join('\n')
        await postCardComment(run.provider, cfg, secrets, run.card_key, loopMsg)
        await updateRun(run.id, { status: 'waiting_input', task_id: null })
        await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowDone, agent.id])
        db_helpers.logActivity(
          'pipeline.loop_detected', 'pipeline_card', run.id, agent.name,
          `Loop semântico detectado em "${column.column_name}" — ${run.card_key}`,
          { card_key: run.card_key, stage: column.column_name, agent: agent.name },
          run.workspace_id
        )
        return
      }

      // Acumula decisão no context summary para etapas seguintes
      await appendContextSummary(run.id, column.column_name, agent.name, agent.role, llmResult.text)

      // Broadcast SSE para observabilidade em tempo real
      eventBus.broadcast('pipeline.agent_output', {
        run_id: run.id,
        card_key: run.card_key,
        stage: column.column_name,
        agent: agent.name,
        role: agent.role,
        output_preview: llmResult.text.slice(0, 300),
        tokens_in: llmResult.inputTokens,
        tokens_out: llmResult.outputTokens,
        model: llmResult.model,
        workspace_id: run.workspace_id,
      })

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

      // If this is a software architect with a linked repo and generated FILE blocks, push them
      // (arquiteto pode commitar specs, decisões arquiteturais ou correções pontuais)
      // Merge para main é responsabilidade exclusiva do DevOps — nunca do arquiteto
      if (assignment.role === 'software architect' && effectiveRepoId) {
        if (/###\s*(?:FILE|ARQUIVO):/i.test(llmResult.text)) {
          try {
            const pushResults = await pushFilesToRepos(llmResult.text, run.card_key, run.card_title, stageRepos, effectiveRepoId)
            for (const pr of pushResults) {
              if (pr.ok) {
                const archFixMsg = [`🔧 **${agent.name} commitou arquivos** → \`${pr.repoName}\``, ``, `🌿 Branch: \`${pr.branch}\``, `📁 Arquivos: ${pr.files?.join(', ')}`, `📝 Commit: ${pr.message}`].join('\n')
                const archFixId = await postCardComment(run.provider, cfg, secrets, run.card_key, archFixMsg, run.id)
                await logMessage(run.id, 'agent_to_card', stageId, archFixMsg, archFixId ?? undefined)
              } else {
                const archErrMsg = `⚠️ **Push do arquiteto falhou** [${pr.repoName}]: ${pr.message}`
                logger.error({ run_id: run.id, agent: agent.name, result: pr }, 'pipeline-engine: architect push failed')
                const archErrId = await postCardComment(run.provider, cfg, secrets, run.card_key, archErrMsg, run.id)
                await logMessage(run.id, 'agent_to_card', stageId, archErrMsg, archErrId ?? undefined)
              }
            }
          } catch (pushErr: any) {
            logger.warn({ pushErr, run_id: run.id, agent: agent.name }, 'pipeline-engine: architect push failed (non-critical)')
          }
        }

        // ── Estimativa automática — posta story points após o arquiteto, sem bloquear ──
        generateEstimate(run, column, cfg, agent, llmResult.text, stageRepos).catch(err =>
          logger.warn({ err, run_id: run.id }, 'pipeline-engine: estimate generation failed (non-critical)')
        )
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

      // Sandbox: roda testes antes de abrir PR (se TEST_CMD presente no output)
      if (effectiveRepoId && extractTestCommand(llmResult.text)) {
        try {
          const repoCtx = stageRepos.find(r => r.id === effectiveRepoId)?.context ?? ''
          const sandboxResult = await runSandboxTests(llmResult.text, effectiveRepoId, repoCtx, run.card_key)
          if (sandboxResult) {
            const sandboxCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, sandboxResult.message)
            if (sandboxCommentId) await logMessage(run.id, 'agent_to_card', stageId, sandboxResult.message, sandboxCommentId)
            if (!sandboxResult.passed) {
              // Testes falharam — não abre PR, pausa para o agente corrigir
              await updateRun(run.id, { status: 'waiting_input', task_id: null })
              await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowDone, agent.id])
              db_helpers.logActivity(
                'pipeline.sandbox_failed', 'pipeline_card', run.id, agent.name,
                `Testes falharam no sandbox — ${run.card_key} pausado antes de abrir PR`,
                { card_key: run.card_key, stage: column.column_name, agent: agent.name },
                run.workspace_id
              )
              return
            }
          }
        } catch (sandboxErr) {
          logger.warn({ sandboxErr, run_id: run.id }, 'pipeline-engine: sandbox test failed (non-critical, continuing)')
        }
      }

      // Open PR/MR if agent signalled OPEN_PR: true
      if (effectiveRepoId && /^OPEN_PR:\s*true/im.test(llmResult.text)) {
        try {
          const prResult = await openPRForRepo(effectiveRepoId, run.card_key, run.card_title, llmResult.text)
          const prMsg = prResult.ok
            ? [`✅ **PR/MR aberto automaticamente**`, ``, `🔗 ${prResult.url}`, `*${prResult.message}*`].join('\n')
            : `⚠️ **Não foi possível abrir PR/MR**: ${prResult.message}`
          const prCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, prMsg)
          if (prCommentId) await logMessage(run.id, 'agent_to_card', stageId, prMsg, prCommentId)

          // Store PR info for CI polling (GitHub only) AND for PR review feedback loop
          if (prResult.ok && prResult.prNumber) {
            const repoRow = await dbGet<{ repo_url: string; access_token: string }>(
              'SELECT repo_url, access_token FROM git_repositories WHERE id = ?', [effectiveRepoId]
            )
            if (repoRow && /github\.com\//.test(repoRow.repo_url)) {
              const urlMatch = repoRow.repo_url.match(/github\.com\/([^/]+)\/([^/.]+)/)
              if (urlMatch) {
                const prCheckInfo = {
                  repoId: effectiveRepoId, stageId,
                  owner: urlMatch[1], repo: urlMatch[2],
                  prNumber: prResult.prNumber, ci_fix_count: 0,
                }
                await dbRun('UPDATE pipeline_card_runs SET pr_check_json = ? WHERE id = ?', [JSON.stringify(prCheckInfo), run.id])
              }
            }

            // pr_review_json: armazena info do PR para polling de aprovação/rejeição humana
            const prReviewInfo: PRReviewInfo = {
              repoId: effectiveRepoId,
              stageId,
              prNumber: prResult.prNumber,
              prUrl: prResult.url ?? '',
              ...((() => {
                const repoUrl = (repoRow?.repo_url ?? '')
                const m = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/)
                return m ? { owner: m[1], repo: m[2] } : {}
              })()),
              checkedAt: 0, // force check on next tick
            }
            await dbRun('UPDATE pipeline_card_runs SET pr_review_json = ? WHERE id = ?', [JSON.stringify(prReviewInfo), run.id])
          }
        } catch (prErr: any) {
          logger.error({ prErr, run_id: run.id }, 'pipeline-engine: open PR failed')
        }
      }

      outputParts.push(`### ${agent.name} (${agent.role})\n${llmResult.text}`)
    } catch (err) {
      // If the card was deleted from Jira/Azure, the run is already cancelled — don't overwrite
      if (err instanceof CardNotFoundError) throw err
      const nowFail = Math.floor(Date.now() / 1000)
      await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [nowFail, agent.id]).catch(() => {})
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
    } finally {
      // Safety net: garante que o agente nunca fica preso em 'busy' após qualquer saída do bloco
      dbRun(
        `UPDATE agents SET status = 'idle', updated_at = UNIX_TIMESTAMP() WHERE id = ? AND status = 'busy'`,
        [agent.id]
      ).catch(() => {})
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
      // ── Métrica: QA reprovado + rework ──
      dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_text, stage_name, created_at)
             VALUES (?, ?, ?, 'qa_rejected', ?, ?, UNIX_TIMESTAMP())`,
        [run.workspace_id, run.id, run.card_key, `Retornado para ${devColumn.column_name}`, column.column_name]
      ).catch(() => {})
      dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_text, stage_name, created_at)
             VALUES (?, ?, ?, 'rework_triggered', ?, ?, UNIX_TIMESTAMP())`,
        [run.workspace_id, run.id, run.card_key, column.column_name, devColumn.column_name]
      ).catch(() => {})
      await startColumn(reworkRun, devColumn, cfg, secrets)
      return
    }
  }

  // ── Gate BLOCKED: se qualquer agente emitiu BLOCKED, pausar antes de avançar ──
  // Impede que o pipeline avance para a próxima coluna quando um agente registrou
  // explicitamente que o trabalho está bloqueado (ex: ANALYSIS: BLOCKED, ARCHITECTURE: BLOCKED).
  // NOT_APPLICABLE e APPROVED passam normalmente. Só o valor BLOCKED retém o card.
  const BLOCKED_GATE_PATTERN = /\b(?:ANALYSIS|ARCHITECTURE|ARCHITECTURE_REVIEW|IMPLEMENTATION|VERDICT|QA|SECURITY|DATA|UX|PRODUCT|PRIORITY|FLOW|RELEASE|DISCOVERY|COORDINATION)\s*:\s*BLOCKED\b/i
  const combinedOutput = outputParts.join('\n')
  if (BLOCKED_GATE_PATTERN.test(combinedOutput)) {
    // Extrai qual gate foi bloqueado para informar o usuário
    const blockedMatch = combinedOutput.match(BLOCKED_GATE_PATTERN)
    const blockedGate = blockedMatch ? blockedMatch[0].trim().toUpperCase() : 'GATE: BLOCKED'

    // Identifica o agente que emitiu o bloqueio
    const blockedAgentOutput = outputParts.find(p => BLOCKED_GATE_PATTERN.test(p))
    const blockedAgentMatch = blockedAgentOutput?.match(/^🤖 \*\*(.+?)\*\*/)
    const blockedAgentName = blockedAgentMatch ? blockedAgentMatch[1] : 'um agente'

    const gateBlockMsg = [
      `⛔ **Etapa bloqueada — ${column.column_name}**`,
      ``,
      `O agente **${blockedAgentName}** emitiu \`${blockedGate}\`.`,
      `O pipeline foi pausado — o card não avançará até que o bloqueio seja resolvido.`,
      ``,
      `**O que fazer:**`,
      `- Leia o output do agente acima para entender o motivo do bloqueio`,
      `- Resolva a pendência (informação, decisão, acesso ou ajuste no card)`,
      `- Responda \`@pipeline reprocessar\` para tentar novamente após a correção`,
      `- Ou responda \`@pipeline avançar\` para pular esta etapa manualmente (use com cautela)`,
    ].join('\n')

    const gateBlockId = await postCardComment(run.provider, cfg, secrets, run.card_key, gateBlockMsg, run.id)
    await logMessage(run.id, 'agent_to_card', stageId, gateBlockMsg, gateBlockId ?? undefined)
    await updateRun(run.id, { status: 'waiting_input', task_id: null })

    dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_text, stage_name, created_at)
           VALUES (?, ?, ?, 'gate_blocked_advance', ?, ?, UNIX_TIMESTAMP())`,
      [run.workspace_id, run.id, run.card_key, blockedGate, column.column_name]
    ).catch(() => {})

    logger.info({ run_id: run.id, card_key: run.card_key, stage: column.column_name, gate: blockedGate, agent: blockedAgentName }, 'pipeline-engine: gate BLOCKED — advance suppressed')
    return
  }
  // ── Fim gate BLOCKED ──────────────────────────────────────────────────────

  await advanceToNextColumn(run, column, cfg, secrets, outputParts.join('\n\n---\n\n'))
  const stageDurationSec = Math.floor(Date.now() / 1000) - stageStartedAt
  dbRun(`INSERT INTO pipeline_quality_metrics (workspace_id, run_id, card_key, metric_type, value_num, stage_name, created_at)
         VALUES (?, ?, ?, 'stage_duration_sec', ?, ?, UNIX_TIMESTAMP())`,
    [run.workspace_id, run.id, run.card_key, stageDurationSec, column.column_name]
  ).catch(() => {})
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
    await postCardComment(run.provider, cfg, secrets, run.card_key, doneMsg, run.id)
    eventBus.broadcast('pipeline.run_completed', { run_id: run.id, card_key: run.card_key })

    // Capture knowledge in Second Brain when run completes
    addKnowledge({
      content: `Card ${run.card_key} concluído: ${run.card_title}\n\n${run.card_description?.slice(0, 1000) ?? ''}`,
      domain: inferDomain(run.card_title, run.card_description ?? ''),
      source: `card:${run.card_key}`,
      title: run.card_title,
      card_key: run.card_key,
    }).catch(() => {}) // non-blocking, non-critical
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
  // jira_status sobrescreve column_name quando configurado — permite que o nome da coluna no AURA
  // seja livre sem precisar bater com o nome da transição no Jira
  const jiraTransitionName = nextColumn.jira_status?.trim() || nextColumn.column_name
  const moveResult = await moveCard(run.provider, cfg, secrets, run.card_key, jiraTransitionName)
  if (!moveResult.moved) {
    // Avisa no card que a movimentação falhou — o status interno avança mas o Jira fica parado
    const moveWarn = [
      `⚠️ **Não foi possível mover o card para "${jiraTransitionName}" no Jira**`,
      ``,
      `O pipeline continua executando internamente, mas o card permanece na coluna atual no Jira.`,
      ``,
      moveResult.reason || '',
      ``,
      `**Como corrigir:** em Work Pipeline → colunas → "${nextColumn.column_name}", preencha o campo **"Status no Jira"** com o nome exato da transição disponível para este card.`,
    ].filter(Boolean).join('\n')
    await postCardComment(run.provider, cfg, secrets, run.card_key, moveWarn, run.id)
  }

  const updatedRun: PipelineCardRun = { ...run, current_stage_id: String(nextColumn.id), task_id: null, status: 'running' }
  await updateRun(run.id, { current_stage_id: String(nextColumn.id), task_id: null, status: 'running' })

  if (hasAgents(nextColumn)) {
    // Gate de aprovação humana: se a próxima coluna exige aprovação, pausar e aguardar
    if (nextColumn.requires_human_approval === 1) {
      const approvalMsg = [
        `⏸️ **Aprovação necessária — ${nextColumn.column_name}**`,
        ``,
        `A etapa **${nextColumn.column_name}** requer aprovação humana antes de prosseguir.`,
        ``,
        `Responda com \`avançar\` para iniciar esta etapa ou \`cancelar\` para encerrar a esteira.`,
      ].join('\n')
      const approvalId = await postCardComment(run.provider, cfg, secrets, run.card_key, approvalMsg)
      await logMessage(run.id, 'agent_to_card', String(nextColumn.id), approvalMsg, approvalId ?? undefined)
      await updateRun(run.id, { status: 'waiting_input', current_stage_id: String(nextColumn.id) })
      try {
        db_helpers.logActivity(
          'pipeline.awaiting_approval',
          'pipeline_card',
          run.id,
          'pipeline',
          `${run.card_key} aguardando aprovação humana — "${nextColumn.column_name}"`,
          { card_key: run.card_key, card_title: run.card_title, stage: nextColumn.column_name },
          run.workspace_id
        )
      } catch { /* non-critical */ }
      return
    }
    await startColumn(updatedRun, nextColumn, cfg, secrets)
  } else if (!(await getNextColumn(nextColumn))) {
    // Last column with no agents — auto-complete the run
    await updateRun(run.id, { status: 'done', task_id: null })
    const doneMsg = `✅ **Esteira concluída** — todos os estágios de _${run.card_key}_ foram processados com sucesso.`
    await postCardComment(run.provider, cfg, secrets, run.card_key, doneMsg, run.id)
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

      // Poll PR reviews: se um PR foi aberto, verifica aprovação/rejeição humana
      if (run.pr_review_json) {
        await checkPRReviewFeedback(run, column, cfg, secrets)
        // Não retorna: processa comentários normais também (usuário pode querer comandar)
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

      // Relê o run do banco antes de processar comentários — garante last_comment_ts atualizado.
      // O objeto `run` em memória pode ter timestamp stale se foi atualizado em iterações anteriores.
      const freshRun = await dbGet<PipelineCardRun>('SELECT * FROM pipeline_card_runs WHERE id = ?', [run.id])
      await processInboundComments(freshRun ?? run, column, cfg, secrets)
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

  // Instrução livre via @mention → responde apenas o primeiro agente da coluna (order ASC).
  // Chamar todos os agentes para uma instrução de usuário gera respostas redundantes e alucinação.
  const assignment = assignments[0]
  const agent = agentMap.get(assignment.agent_id)
  if (!agent) return

  const ackMsg = [
    `🤖 **Instrução recebida** — **${agent.name}** responderá`,
    '',
    `> ${userInstruction}`,
    '',
    `⏳ Processando...`,
  ].join('\n')
  const ackCommentId = await postCardComment(run.provider, cfg, secrets, run.card_key, ackMsg, run.id)
  void ackCommentId // postCardComment com runId já registra automaticamente
  // Avança o last_comment_ts para NOW antes de chamar o LLM — evita que o motor
  // releia o comentário do usuário enquanto o LLM está processando (pode demorar até 90s)
  const mentionNowTs = Math.floor(Date.now() / 1000)
  await updateRun(run.id, { status: 'running', task_id: null, last_comment_ts: mentionNowTs })

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
    const isReprocessAll = ['reprocessar', 'reprocesse', 'reprocess', 'reiniciar', 'reinicie', 'restart'].includes(firstWord) &&
                           instructionLower.includes('tudo')
    const isReprocessCmd = !isReprocessAll && ['reprocessar', 'reprocesse', 'reprocess', 'reiniciar', 'reinicie', 'restart'].includes(firstWord)

    // ── Comandos (com ou sem @menção) ─────────────────────────────────────────
    if (isCancelCmd) {
      await updateRun(run.id, { status: 'cancelled', last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, '🛑 Esteira cancelada a pedido do usuário.', run.id)
      return
    }

    if (isAdvanceCmd) {
      // "avançar" só funciona quando waiting_input por aprovação humana ou PR
      // Não retoma runs bloqueados pelo harness — para isso usar "reprocessar"
      if (run.status === 'waiting_input' || hasMention) {
        // Verifica se o bloqueio foi por harness (não deve avançar de etapa, só reprocessar)
        const lastMsg = await dbGet<{ body: string }>(
          `SELECT body FROM pipeline_card_messages WHERE run_id = ? AND direction = 'agent_to_card' ORDER BY created_at DESC LIMIT 1`,
          [run.id]
        )
        const isHarnessBlock = lastMsg?.body?.includes('Intervenção humana necessária') ||
                               lastMsg?.body?.includes('harness de qualidade')
        if (isHarnessBlock) {
          await postCardComment(run.provider, cfg, secrets, run.card_key,
            `⚠️ O run está bloqueado pelo harness de qualidade. Use \`reprocessar\` para tentar novamente, não \`avançar\`.`, run.id)
          await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
          return
        }
        await advanceToNextColumn(run, column, cfg, secrets, '')
        await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
        return
      }
    }

    if (isReprocessCmd) {
      await dbRun('UPDATE pipeline_card_runs SET run_count = COALESCE(run_count, 1) + 1, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
      await updateRun(run.id, { status: 'running', task_id: null, last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, `🔄 **Reprocessando etapa "${column.column_name}"** a pedido do usuário.`, run.id)
      await startColumn({ ...run, status: 'running', task_id: null }, column, cfg, secrets)
      return
    }

    if (isReprocessAll) {
      const allCols = await dbGetAll<PipelineColumn>('SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC', [column.pipeline_id])
      const firstCol = allCols.find(c => hasAgents(c)) ?? column
      await dbRun('UPDATE pipeline_card_runs SET run_count = COALESCE(run_count, 1) + 1, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
      await updateRun(run.id, { status: 'running', task_id: null, current_stage_id: String(firstCol.id), last_comment_ts: emSegundos(latestMs) })
      await postCardComment(run.provider, cfg, secrets, run.card_key, `🔄 **Reiniciando esteira completa** a partir de "${firstCol.column_name}".`, run.id)
      await startColumn({ ...run, status: 'running', task_id: null, current_stage_id: String(firstCol.id) }, firstCol, cfg, secrets)
      return
    }

    // ── @menção com instrução livre → verifica se menciona agente específico ──
    if (hasMention && instruction.length > 0) {
      // Detecta @nomeDoAgente no início da instrução (ex: "@pedro analise o risco")
      const agentMentionMatch = instruction.match(/^@([\w\-]+)\s*(.*)/i)
      if (agentMentionMatch) {
        const mentionedAgentName = agentMentionMatch[1].toLowerCase()
        const agentInstruction = agentMentionMatch[2].trim() || instruction

        // Busca o agente pelo nome em qualquer coluna do pipeline
        const allCols = await dbGetAll<PipelineColumn>(
          'SELECT * FROM pipeline_columns WHERE pipeline_id = ? ORDER BY column_order ASC',
          [column.pipeline_id]
        )
        let targetAgent: AgentFullRow | null = null
        let targetAssignment: ColumnAssignment | null = null
        let targetColumn: PipelineColumn = column

        for (const col of allCols) {
          const assignments = parseAssignments(col)
          for (const a of assignments) {
            const agents = await getAgentsByIds([a.agent_id])
            if (agents[0]?.name.toLowerCase().includes(mentionedAgentName)) {
              targetAgent = agents[0]
              targetAssignment = a
              targetColumn = col
              break
            }
          }
          if (targetAgent) break
        }

        if (targetAgent && targetAssignment) {
          const ackMsg = [
            `🤖 **${targetAgent.name}** foi mencionado diretamente`,
            ``,
            `> ${agentInstruction}`,
            ``,
            `⏳ Processando...`,
          ].join('\n')
          const ackId = await postCardComment(run.provider, cfg, secrets, run.card_key, ackMsg, run.id)
          void ackId // postCardComment com runId já registra automaticamente
          // Avança last_comment_ts imediatamente para evitar reler o comentário do usuário
          const agentMentionTs = Math.floor(Date.now() / 1000)
          await updateRun(run.id, { status: 'running', task_id: null, last_comment_ts: agentMentionTs })

          // Executa o agente mencionado com o contexto da instrução
          const prevMsgs = await getLastAgentMessages(run.id)
          const contextSummary = formatContextSummary(run.context_summary_json)
          const mentionPrompt = [
            contextSummary,
            `# Instrução direta via @${mentionedAgentName} no card ${run.card_key}`,
            ``,
            `O usuário mencionou você diretamente:`,
            ``,
            `> **${agentInstruction}**`,
            ``,
            `Responda especificamente a esta instrução.`,
            ``,
            buildPrompt(run, targetColumn, prevMsgs, targetAgent.name, targetAgent.role),
          ].filter(Boolean).join('\n')

          const taskId = await createAgentTask(run, targetColumn, targetAgent, mentionPrompt, true, targetAssignment.llm_model)
          await updateRun(run.id, { task_id: taskId ?? undefined })

          try {
            const agentWithSkills = { ...targetAgent, _skills: await loadAgentSkills(run.workspace_id) } as AgentFullRow & { _skills?: string }
            const result = await callAgentLLM(agentWithSkills as AgentFullRow, mentionPrompt, cfg, targetAssignment.llm_model)
            const now = Math.floor(Date.now() / 1000)
            const replyComment = [
              `🤖 **${targetAgent.name}** *(${targetAgent.role})* — resposta à menção`,
              '',
              result.text,
              '',
              `---`,
              `*Modelo: ${result.model} | Tokens: ${result.inputTokens} in / ${result.outputTokens} out*`,
            ].join('\n')
            const replyId = await postCardComment(run.provider, cfg, secrets, run.card_key, replyComment)
            if (replyId) await logMessage(run.id, 'agent_to_card', String(targetColumn.id), replyComment, replyId)
            if (taskId) await dbRun(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?`, [now, taskId])
            await dbRun(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ?`, [now, targetAgent.id])
            await appendContextSummary(run.id, targetColumn.column_name, targetAgent.name, targetAgent.role, result.text)
          } catch (err) {
            logger.warn({ err, agent: targetAgent.name }, 'pipeline-engine: agent mention execution failed')
          }
          await updateRun(run.id, { last_comment_ts: emSegundos(latestMs), status: 'waiting_input', task_id: null })
          return
        }
      }

      // @mention genérico (@pipeline ou @aura) → executa LLM com contexto do usuário
      await executeMentionInstruction(run, column, cfg, secrets, instruction)
      await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })
      return
    }

    // ── Resposta comum sem @menção → executa o agente da coluna com o contexto do humano ──
    // O humano pode escrever qualquer coisa: perguntas, contexto adicional, correções,
    // instruções específicas. O agente da coluna atual responde diretamente.
    if (!hasMention && hasAgents(column)) {
      const assignments = parseAssignments(column).sort((a, b) => a.order - b.order)
      const agents = await getAgentsByIds(assignments.map(a => a.agent_id))
      const agent = agents[0]
      const assignment = assignments[0]
      if (agent && assignment) {
        // Avança o timestamp imediatamente antes de processar para evitar loop
        await updateRun(run.id, { last_comment_ts: emSegundos(latestMs) })

        const humanAckMsg = `💬 **${agent.name}** recebeu sua mensagem e está processando...`
        const humanAckId = await postCardComment(run.provider, cfg, secrets, run.card_key, humanAckMsg)
        if (humanAckId) await logMessage(run.id, 'agent_to_card', String(column.id), humanAckMsg, humanAckId)

        await updateRun(run.id, { status: 'running', task_id: null })

        const prevMsgs = await getLastAgentMessages(run.id)
        const contextSummary = formatContextSummary(run.context_summary_json)
        const humanPrompt = [
          contextSummary,
          `# Mensagem do usuário no card ${run.card_key}`,
          ``,
          `O usuário enviou a seguinte mensagem diretamente no card (sem @menção):`,
          ``,
          `> **${comment.body}**`,
          ``,
          `Responda diretamente a esta mensagem. Pode ser uma pergunta, uma instrução, contexto adicional ou uma correção.`,
          `Se for uma pergunta sobre o card, responda com base no que você sabe.`,
          `Se for uma instrução, siga-a e registre o que fez.`,
          `Se for contexto adicional, incorpore e confirme o entendimento.`,
          ``,
          buildPrompt(run, column, prevMsgs, agent.name, agent.role),
        ].filter(Boolean).join('\n')

        const agentSkills = await loadAgentSkills(run.workspace_id)
        const agentWithSkills = { ...agent, _skills: agentSkills }
        try {
          const llmResult = await callAgentLLM(agentWithSkills as AgentFullRow, humanPrompt, cfg, assignment.llm_model, classifyCardComplexity(run.card_title, run.card_description))
          const now = Math.floor(Date.now() / 1000)

          const replyComment = [
            `🤖 **${agent.name}** *(${agent.role})* — resposta à mensagem`,
            '',
            llmResult.text,
            '',
            `---`,
            `*Modelo: ${llmResult.model} | Tokens: ${llmResult.inputTokens} in / ${llmResult.outputTokens} out${llmResult.costUsd > 0 ? ` | $${llmResult.costUsd.toFixed(4)}` : ''}*`,
          ].join('\n')

          const replyCid = await postCardComment(run.provider, cfg, secrets, run.card_key, replyComment)
          if (replyCid) await logMessage(run.id, 'agent_to_card', String(column.id), replyComment, replyCid)

          await dbRun(`INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, cost_usd, agent_name, created_at, workspace_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [llmResult.model, `pipeline-human-reply-${run.id}-${agent.id}`, llmResult.inputTokens, llmResult.outputTokens, llmResult.costUsd, agent.name, now, run.workspace_id]
          ).catch(() => {})

          await appendContextSummary(run.id, column.column_name, agent.name, agent.role, llmResult.text)
          logger.info({ run_id: run.id, agent: agent.name, card_key: run.card_key }, 'pipeline-engine: human reply processed')
        } catch (err) {
          logger.warn({ err, run_id: run.id, agent: agent.name }, 'pipeline-engine: human reply LLM failed')
          await postCardComment(run.provider, cfg, secrets, run.card_key,
            `⚠️ **${agent.name}** não conseguiu processar a mensagem: ${err instanceof Error ? err.message : String(err)}`)
        }

        await updateRun(run.id, { status: run.status, task_id: null })
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

  // Cancel runs stuck in 'waiting_input' with pr_check_json or pr_review_json for more than 7 days.
  // This handles cases where GitHub tokens expire or PRs are abandoned — the run would otherwise
  // stay in waiting_input indefinitely with no way to advance automatically.
  try {
    const staleWaitingThreshold = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
    const staleWaiting = await dbRun(
      `UPDATE pipeline_card_runs SET status = 'failed', updated_at = UNIX_TIMESTAMP()
       WHERE status = 'waiting_input'
         AND (pr_check_json IS NOT NULL OR pr_review_json IS NOT NULL)
         AND updated_at < ?`,
      [staleWaitingThreshold]
    )
    if (staleWaiting.affectedRows > 0) {
      logger.warn({ count: staleWaiting.affectedRows }, 'pipeline-engine: cancelled stale waiting_input runs with pending PR (token may have expired)')
    }
  } catch (err) {
    logger.warn({ err }, 'pipeline-engine: stale waiting_input cleanup failed')
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
    await dbRun('UPDATE pipeline_card_runs SET run_count = COALESCE(run_count, 1) + 1, updated_at = UNIX_TIMESTAMP() WHERE id = ?', [run.id])
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

/**
 * Rollback para o estado anterior a uma etapa específica.
 * Restaura current_stage_id, limpa mensagens da etapa alvo em diante,
 * e reinicia a partir do snapshot escolhido.
 */
export async function rollbackToSnapshot(
  runId: number,
  targetStageId: string,
): Promise<{ ok: boolean; message: string }> {
  if (_running) return { ok: false, message: 'Engine busy — tente novamente em instantes' }
  _running = true
  try {
    const run = await dbGet('SELECT * FROM pipeline_card_runs WHERE id = ?', [runId]) as PipelineCardRun | undefined
    if (!run) return { ok: false, message: `Run ${runId} não encontrado` }

    const snapshots = await getRunSnapshots(runId)
    const snapshot = snapshots.find(s => s.stage_id === targetStageId)
    if (!snapshot) return { ok: false, message: `Snapshot da etapa ${targetStageId} não encontrado` }

    const column = await getColumnById(parseInt(targetStageId, 10))
    if (!column) return { ok: false, message: `Etapa ${targetStageId} não encontrada` }

    const pipelines = await getActivePipelines()
    const pipeline = pipelines.find(p => p.workspaceId === run.workspace_id)
    if (!pipeline) return { ok: false, message: 'Nenhum pipeline ativo encontrado' }

    // Limpa mensagens a partir da etapa alvo (inclusive)
    // Busca todas as etapas com column_order >= etapa alvo
    const laterStages = await dbGetAll<{ id: number }>(
      `SELECT id FROM pipeline_columns WHERE pipeline_id = ? AND column_order >= ?`,
      [column.pipeline_id, column.column_order]
    )
    if (laterStages.length > 0) {
      const stageIds = laterStages.map(s => String(s.id))
      const placeholders = stageIds.map(() => '?').join(',')
      await dbRun(
        `DELETE FROM pipeline_card_messages WHERE run_id = ? AND stage_id IN (${placeholders})`,
        [runId, ...stageIds]
      )
    }

    // Restaura context_summary removendo entradas a partir da etapa alvo
    try {
      const existing = run.context_summary_json ? JSON.parse(run.context_summary_json) as { stage: string }[] : []
      const trimmed = existing.filter(e => e.stage !== snapshot.stage_name)
      await updateRun(runId, { context_summary_json: JSON.stringify(trimmed) })
    } catch { /* non-critical */ }

    // Restaura stage e reinicia
    await updateRun(runId, { current_stage_id: targetStageId, status: 'running', task_id: null })

    await postCardComment(
      run.provider, pipeline.cfg, pipeline.secrets, run.card_key,
      `⏪ **Rollback para "${snapshot.stage_name}"** — reprocessando a partir desta etapa.`
    )

    await startColumn({ ...run, current_stage_id: targetStageId, status: 'running', task_id: null }, column, pipeline.cfg, pipeline.secrets)

    return { ok: true, message: `Rollback para "${snapshot.stage_name}" iniciado` }
  } catch (err) {
    logger.error({ err, run_id: runId }, 'pipeline-engine: rollback failed')
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    _running = false
  }
}
