/**
 * Agent Harness — valida o output dos agentes antes de executar ações.
 *
 * Princípio: o agente gera texto. O harness verifica se o texto está dentro
 * dos limites esperados antes de commitar código, avançar cards ou abrir PRs.
 *
 * Quando rejeita: retorna uma mensagem descritiva para postar no card
 * e aguardar intervenção humana (run → waiting_input).
 */

export interface HarnessResult {
  ok: boolean
  reason?: string // mensagem para o card quando !ok
}

export interface HarnessContext {
  agentRole: string
  cardKey: string
  hasRepo: boolean
  columnInstructions?: string | null
}

// ─── Guardrails ───────────────────────────────────────────────────────────────

/** Padrões que indicam secrets/credenciais no output — nunca devem ir para o código */
const SECRET_PATTERNS = [
  /(?:password|senha|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /(?:ghp|gho|ghu|ghs|ghr|glpat|sk-|AKIA)[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
]

/** Papéis que devem emitir um gate explícito na resposta */
const GATE_REQUIRED_ROLES: Record<string, RegExp> = {
  'software architect':  /ARCHITECTURE(?:_REVIEW)?\s*:\s*(?:APPROVED|BLOCKED|CHANGES_REQUESTED)/i,
  'security auditor':    /SECURITY\s*:\s*(?:APPROVED|BLOCKED|NOT_APPLICABLE)/i,
  'qa engineer':         /(?:VERDICT|QA)\s*:\s*(?:APPROVED|CHANGES_REQUESTED|BLOCKED)/i,
  'business analyst':    /ANALYSIS\s*:\s*(?:READY|BLOCKED)/i,
  'data engineer':       /DATA\s*:\s*(?:APPROVED|BLOCKED|NOT_APPLICABLE)/i,
  'ux designer':         /UX\s*:\s*(?:APPROVED|BLOCKED|NOT_APPLICABLE)/i,
  'product manager':     /PRODUCT\s*:\s*(?:READY|BLOCKED)/i,
}

/** Tamanho mínimo de resposta por papel (chars) — respostas muito curtas indicam falha */
const MIN_RESPONSE_LENGTH: Record<string, number> = {
  'software architect': 400,
  'security auditor':   300,
  'qa engineer':        200,
  'business analyst':   150,
  'developer':          100,
  'devops engineer':    100,
}

const DEFAULT_MIN_LENGTH = 50

// ─── Main validation ──────────────────────────────────────────────────────────

export function validateAgentOutput(
  text: string,
  ctx: HarnessContext,
): HarnessResult {
  const role = ctx.agentRole.toLowerCase().trim()

  // 1. Resposta vazia
  if (!text || !text.trim()) {
    return {
      ok: false,
      reason: `O agente **${ctx.agentRole}** retornou uma resposta vazia. Por favor, verifique se o modelo está configurado corretamente e tente novamente.`,
    }
  }

  // 2. Resposta muito curta para o papel
  const minLen = MIN_RESPONSE_LENGTH[role] ?? DEFAULT_MIN_LENGTH
  if (text.trim().length < minLen) {
    return {
      ok: false,
      reason: `A resposta do agente **${ctx.agentRole}** está muito curta (${text.trim().length} chars, mínimo ${minLen}). O agente pode não ter executado a skill corretamente. Verifique as instruções da coluna e tente novamente.`,
    }
  }

  // 3. Secrets/credenciais detectados no código gerado
  if (ctx.hasRepo) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        pattern.lastIndex = 0 // reset regex state
        return {
          ok: false,
          reason: `⚠️ **Harness bloqueou o output** — o agente **${ctx.agentRole}** pode ter incluído credenciais ou secrets no código gerado. Por favor, revise manualmente o output e corrija antes de prosseguir. Não é seguro commitar este conteúdo automaticamente.`,
        }
      }
      pattern.lastIndex = 0
    }
  }

  // 4. Gate obrigatório ausente
  const gatePattern = GATE_REQUIRED_ROLES[role]
  if (gatePattern && !gatePattern.test(text)) {
    return {
      ok: false,
      reason: `O agente **${ctx.agentRole}** não emitiu o gate obrigatório na resposta (ex: \`ARCHITECTURE: APPROVED\`, \`SECURITY: APPROVED\`, etc.). A skill pode não ter sido seguida corretamente. Por favor, revise as instruções da coluna e reprocesse.`,
    }
  }

  // 5. Arquivo sem conteúdo quando há repo (FILE: sem bloco de código)
  if (ctx.hasRepo) {
    const fileHeaderWithoutBlock = /###\s*(?:FILE|ARQUIVO):\s*[^\n]+\n(?!```)/i
    if (fileHeaderWithoutBlock.test(text)) {
      return {
        ok: false,
        reason: `O agente **${ctx.agentRole}** gerou um bloco \`### FILE:\` sem conteúdo de código. Cada arquivo deve ser seguido de um bloco de código fenced (\`\`\`). Por favor, reprocesse.`,
      }
    }
  }

  return { ok: true }
}

// ─── Format rejection message ─────────────────────────────────────────────────

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
    `- Se necessário, edite o card e responda \`@pipeline reprocessar\` para tentar novamente`,
    `- Ou responda com instruções específicas para o agente via \`@pipeline <instrução>\``,
  ].join('\n')
}
