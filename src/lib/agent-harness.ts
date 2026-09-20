/**
 * Agent Harness — valida o output dos agentes antes de executar ações.
 *
 * Princípio: o agente gera texto. O harness verifica se o texto está dentro
 * dos limites esperados antes de commitar código, avançar cards ou abrir PRs.
 *
 * Quando rejeita: retorna uma mensagem descritiva para postar no card
 * e aguardar intervenção humana (run → waiting_input).
 *
 * Configuração por papel:
 * Cada skill pode ter um arquivo harness.json no mesmo diretório do SKILL.md.
 * Esse arquivo sobrescreve os defaults. Se não existir, usa os defaults abaixo.
 *
 * Formato do harness.json:
 * {
 *   "min_response_length": 150,
 *   "gate_pattern": "ANALYSIS:\\s*(?:READY|BLOCKED|NOT_APPLICABLE)",
 *   "is_coordination_role": false
 * }
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface HarnessResult {
  ok: boolean
  reason?: string
}

export interface HarnessContext {
  agentRole: string
  cardKey: string
  hasRepo: boolean
  columnInstructions?: string | null
  /** Caminho do diretório da skill para leitura do harness.json (opcional) */
  skillPath?: string | null
}

// ─── Configuração de harness por arquivo ──────────────────────────────────────

interface HarnessFileConfig {
  min_response_length?: number
  gate_pattern?: string | null
  is_coordination_role?: boolean
}

/** Cache de harness configs por skillPath — evita I/O repetido */
const _harnessCache = new Map<string, { config: HarnessFileConfig; cachedAt: number }>()
const HARNESS_CACHE_TTL_MS = 30_000

function loadHarnessConfig(skillPath: string | null | undefined): HarnessFileConfig {
  if (!skillPath) return {}

  const now = Date.now()
  const cached = _harnessCache.get(skillPath)
  if (cached && (now - cached.cachedAt) < HARNESS_CACHE_TTL_MS) {
    return cached.config
  }

  try {
    const harnessFile = join(skillPath, 'harness.json')
    if (existsSync(harnessFile)) {
      const raw = readFileSync(harnessFile, 'utf-8')
      const config = JSON.parse(raw) as HarnessFileConfig
      _harnessCache.set(skillPath, { config, cachedAt: now })
      return config
    }
  } catch {
    // Arquivo malformado ou inacessível — usa defaults
  }

  _harnessCache.set(skillPath, { config: {}, cachedAt: now })
  return {}
}

// ─── Defaults por papel (usados quando harness.json não existe) ───────────────

const DEFAULT_GATE_REQUIRED_ROLES: Record<string, RegExp> = {
  'software architect':  /ARCHITECTURE(?:_REVIEW)?\s*:\s*(?:APPROVED|BLOCKED|CHANGES_REQUESTED)/i,
  'security auditor':    /SECURITY\s*:\s*(?:APPROVED|BLOCKED|NOT_APPLICABLE)/i,
  'qa engineer':         /(?:VERDICT|QA)\s*:\s*(?:APPROVED|CHANGES_REQUESTED|BLOCKED)/i,
  'business analyst':    /ANALYSIS\s*:\s*(?:READY|BLOCKED|NOT_APPLICABLE)/i,
  'data engineer':       /DATA\s*:\s*(?:APPROVED|APPROVED_WITH_CONDITIONS|BLOCKED|NOT_APPLICABLE)/i,
  'ux designer':         /UX\s*:\s*(?:APPROVED|BLOCKED|NOT_APPLICABLE)/i,
  'product manager':     /PRODUCT\s*:\s*(?:READY|BLOCKED|NOT_APPLICABLE)/i,
  'product owner':       /(?:PRODUCT|BACKLOG)\s*:\s*(?:READY|BLOCKED|PRIORITIZED|NOT_APPLICABLE)/i,
  'developer':           /IMPLEMENTATION\s*:\s*(?:READY_FOR_REVIEW|BLOCKED|IN_PROGRESS|COMPLETED)/i,
  'devops engineer':     /RELEASE\s*:\s*(?:SUCCESS|ROLLED_BACK|FAILED|BLOCKED)/i,
  'discovery':           /DISCOVERY\s*:\s*(?:READY|BLOCKED|NOT_APPLICABLE)/i,
}

const DEFAULT_MIN_RESPONSE_LENGTH: Record<string, number> = {
  'software architect': 400,
  'security auditor':   300,
  'qa engineer':        200,
  'business analyst':   150,
  'developer':          100,
  'devops engineer':    100,
}

const DEFAULT_COORDINATION_ROLES = new Set([
  'orchestrator', 'coordinator', 'scrum master', 'product manager', 'product owner',
])

const DEFAULT_MIN_LENGTH = 50

// ─── Secrets ──────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:password|senha|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /(?:ghp|gho|ghu|ghs|ghr|glpat|sk-|AKIA)[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
]

// ─── Resolução de config efetiva ─────────────────────────────────────────────

function resolveHarnessConfig(role: string, skillPath?: string | null) {
  const fileConfig = loadHarnessConfig(skillPath)
  const roleLower = role.toLowerCase().trim()

  // Gate pattern: harness.json > defaults hardcoded
  let gatePattern: RegExp | null = null
  if (fileConfig.gate_pattern !== undefined) {
    // null no arquivo = sem gate obrigatório
    gatePattern = fileConfig.gate_pattern ? new RegExp(fileConfig.gate_pattern, 'i') : null
  } else {
    gatePattern = DEFAULT_GATE_REQUIRED_ROLES[roleLower] ?? null
  }

  // Min response length
  const minLen = fileConfig.min_response_length !== undefined
    ? fileConfig.min_response_length
    : (DEFAULT_MIN_RESPONSE_LENGTH[roleLower] ?? DEFAULT_MIN_LENGTH)

  // Is coordination role
  const isCoordination = fileConfig.is_coordination_role !== undefined
    ? fileConfig.is_coordination_role
    : DEFAULT_COORDINATION_ROLES.has(roleLower)

  return { gatePattern, minLen, isCoordination }
}

// ─── Validação principal ─────────────────────────────────────────────────────

export function validateAgentOutput(
  text: string,
  ctx: HarnessContext,
): HarnessResult {
  const role = ctx.agentRole.toLowerCase().trim()
  const { gatePattern, minLen, isCoordination } = resolveHarnessConfig(role, ctx.skillPath)

  // 1. Resposta vazia
  if (!text || !text.trim()) {
    return {
      ok: false,
      reason: `O agente **${ctx.agentRole}** retornou uma resposta vazia. Verifique se o modelo está configurado corretamente e tente novamente.`,
    }
  }

  // 2. Resposta muito curta
  if (text.trim().length < minLen) {
    return {
      ok: false,
      reason: `A resposta do agente **${ctx.agentRole}** está muito curta (${text.trim().length} chars, mínimo ${minLen}). O agente pode não ter executado a skill corretamente. Verifique as instruções da coluna e tente novamente.`,
    }
  }

  // 3. Secrets no código gerado
  if (ctx.hasRepo) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        pattern.lastIndex = 0
        return {
          ok: false,
          reason: `⚠️ **Harness bloqueou o output** — o agente **${ctx.agentRole}** pode ter incluído credenciais ou secrets no código gerado. Revise manualmente antes de prosseguir.`,
        }
      }
      pattern.lastIndex = 0
    }
  }

  // 4. Papéis de coordenação não geram código
  if (isCoordination) {
    if (/###\s*(?:FILE|ARQUIVO)\s*:/i.test(text)) {
      return {
        ok: false,
        reason: `O agente **${ctx.agentRole}** gerou blocos de código (\`### FILE:\`) — esse papel não deve implementar código. Apenas **developer**, **software architect** ou **devops engineer** podem gerar arquivos. Revise as instruções da coluna.`,
      }
    }
    if (/^OPEN_PR\s*:\s*true/im.test(text)) {
      return {
        ok: false,
        reason: `O agente **${ctx.agentRole}** tentou abrir um PR (\`OPEN_PR: true\`) — esse papel não deve fazer isso. Apenas **developer** ou **software architect** podem abrir PRs.`,
      }
    }
  }

  // 5. Gate obrigatório ausente
  if (gatePattern && !gatePattern.test(text)) {
    // Monta exemplo a partir do padrão do harness.json ou do default
    const example = buildGateExample(role, ctx.skillPath)
    return {
      ok: false,
      reason: `O agente **${ctx.agentRole}** não emitiu o gate obrigatório na resposta. Esperado: ${example}. A skill pode não ter sido seguida corretamente. Revise as instruções da coluna e reprocesse.`,
    }
  }

  // 6. FILE: sem bloco fenced
  if (ctx.hasRepo) {
    const fileHeaderWithoutBlock = /###\s*(?:FILE|ARQUIVO):\s*[^\n]+\n(?!```)/i
    if (fileHeaderWithoutBlock.test(text)) {
      return {
        ok: false,
        reason: `O agente **${ctx.agentRole}** gerou um bloco \`### FILE:\` sem conteúdo de código. Cada arquivo deve ser seguido de um bloco fenced (\`\`\`). Reprocesse.`,
      }
    }
  }

  return { ok: true }
}

function buildGateExample(role: string, skillPath?: string | null): string {
  const fileConfig = loadHarnessConfig(skillPath)
  if (fileConfig.gate_pattern) {
    // Simplifica o regex para exibição
    const simplified = fileConfig.gate_pattern
      .replace(/\(\?:/g, '(').replace(/\\/g, '')
      .replace(/\s\*/g, ' ').replace(/\s\?/g, ' ')
      .slice(0, 80)
    return `\`${simplified}\``
  }

  const examples: Record<string, string> = {
    'software architect': '`ARCHITECTURE: APPROVED` ou `ARCHITECTURE: BLOCKED`',
    'security auditor':   '`SECURITY: APPROVED` ou `SECURITY: NOT_APPLICABLE`',
    'qa engineer':        '`VERDICT: APPROVED` ou `VERDICT: CHANGES_REQUESTED`',
    'business analyst':   '`ANALYSIS: READY` ou `ANALYSIS: BLOCKED`',
    'data engineer':      '`DATA: APPROVED` ou `DATA: NOT_APPLICABLE`',
    'ux designer':        '`UX: APPROVED` ou `UX: NOT_APPLICABLE`',
    'product manager':    '`PRODUCT: READY`, `PRODUCT: BLOCKED` ou `PRODUCT: NOT_APPLICABLE`',
    'product owner':      '`BACKLOG: PRIORITIZED` ou `PRODUCT: NOT_APPLICABLE`',
    'developer':          '`IMPLEMENTATION: READY_FOR_REVIEW` ou `IMPLEMENTATION: BLOCKED`',
    'devops engineer':    '`RELEASE: SUCCESS` ou `RELEASE: BLOCKED`',
    'discovery':          '`DISCOVERY: READY` ou `DISCOVERY: BLOCKED`',
  }
  return examples[role] ?? '`GATE: APPROVED` ou `GATE: BLOCKED`'
}

// ─── Mensagem de rejeição formatada ──────────────────────────────────────────

export function formatHarnessRejection(reason: string, agentName: string, cardKey: string): string {
  return [
    `🛑 **Intervenção humana necessária — ${cardKey}**`,
    ``,
    `O harness de qualidade identificou um problema no output do agente **${agentName}**:`,
    ``,
    reason,
    ``,
    `**O que fazer:**`,
    `- Revise as instruções da coluna e verifique se estão claras`,
    `- Edite o card e responda \`@pipeline reprocessar\` para tentar novamente`,
    `- Ou responda com instruções específicas via \`@pipeline <instrução>\``,
  ].join('\n')
}
