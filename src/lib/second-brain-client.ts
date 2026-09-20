/**
 * second-brain-client.ts
 *
 * Cliente HTTP para o serviço Second Brain.
 * O serviço roda em um EC2 separado e expõe uma API REST.
 *
 * Configuração: defina SECOND_BRAIN_URL no .env ou na tela de Integrações.
 * Ex: SECOND_BRAIN_URL=http://seu-ec2.com:8080
 *
 * Quando SECOND_BRAIN_URL não está configurado, todas as funções
 * retornam valores vazios silenciosamente — o sistema funciona
 * normalmente sem o Second Brain.
 */

import { logger } from './logger'
import { dbGet } from './db-pool'

/** Resolve a URL do Second Brain: process.env → tabela settings (configurado pela UI) */
async function resolveSecondBrainUrl(): Promise<string> {
  const fromEnv = (process.env.SECOND_BRAIN_URL || '').trim().replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  try {
    const row = await dbGet<{ value: string }>(
      `SELECT value FROM settings WHERE \`key\` = 'integration.SECOND_BRAIN_URL'`, []
    )
    return (row?.value || '').trim().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

const TIMEOUT_MS = 5_000

export interface KnowledgeEntry {
  id: string
  content: string
  domain: string
  source: string
  title?: string | null
  card_key?: string | null
  tags?: string[] | null
  created_at: string
  distance?: number | null
}

/**
 * Busca conhecimento relevante no Second Brain.
 * Retorna os chunks mais similares ao query no domínio especificado.
 */
export async function searchKnowledge(
  query: string,
  domain: string,
  nResults = 5,
): Promise<KnowledgeEntry[]> {
  const url = await resolveSecondBrainUrl()
  if (!url) return []

  try {
    const params = new URLSearchParams({
      query,
      domain: domain.toLowerCase(),
      n_results: String(nResults),
    })
    const res = await fetch(`${url}/knowledge/search?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = await res.json() as { results: KnowledgeEntry[] }
    return data.results ?? []
  } catch (err) {
    logger.warn({ err, query, domain }, 'second-brain: search failed — continuing without knowledge context')
    return []
  }
}

/**
 * Grava um chunk de conhecimento no Second Brain.
 * Chamado após o processamento de um card para acumular aprendizado.
 */
export async function addKnowledge(entry: {
  content: string
  domain: string
  source: string
  title?: string
  card_key?: string
  tags?: string[]
}): Promise<boolean> {
  const url = await resolveSecondBrainUrl()
  if (!url) return false

  try {
    const res = await fetch(`${url}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch (err) {
    logger.warn({ err, entry: entry.source }, 'second-brain: add knowledge failed — continuing')
    return false
  }
}

/**
 * Formata o conhecimento recuperado como contexto para o prompt do agente.
 */
export function formatKnowledgeContext(entries: KnowledgeEntry[], domain: string): string {
  if (!entries.length) return ''

  const lines = [
    `## Conhecimento do Second Brain — domínio: ${domain}`,
    ``,
    `Os seguintes aprendizados de cards anteriores são relevantes para este card:`,
    ``,
  ]

  for (const entry of entries) {
    const title = entry.title ? `**${entry.title}**\n` : ''
    const source = entry.card_key ? `*(fonte: ${entry.card_key})*` : `*(fonte: ${entry.source})*`
    lines.push(`---`, `${title}${entry.content}`, source, ``)
  }

  return lines.join('\n')
}

/**
 * Extrai o domínio de negócio de um card a partir de labels, épico ou título.
 * Retorna o domínio identificado ou 'geral' como fallback.
 */
export function inferDomain(cardTitle: string, cardDescription: string, tags?: string[]): string {
  const text = `${cardTitle} ${cardDescription} ${(tags || []).join(' ')}`.toLowerCase()

  // Mapa de palavras-chave para domínios
  const domainKeywords: Record<string, string[]> = {
    cartoes:    ['cartão', 'cartao', 'card', 'fatura', 'limite', 'parcel', 'bandeira', 'credito', 'crédito', 'débito', 'debito'],
    pix:        ['pix', 'chave pix', 'transferência', 'transferencia', 'qr code'],
    cobranca:   ['boleto', 'cobrança', 'cobranca', 'vencimento', 'pagamento', 'inadimpl'],
    conta:      ['conta corrente', 'conta digital', 'saldo', 'extrato', 'ted', 'doc'],
    emprestimo: ['empréstimo', 'emprestimo', 'crédito pessoal', 'credito pessoal', 'consignado', 'parcela'],
    seguro:     ['seguro', 'sinistro', 'apólice', 'apolice', 'proteção', 'protecao'],
    investimento: ['investimento', 'cdb', 'renda fixa', 'fundo', 'tesouro', 'ação', 'acao', 'bvmf'],
  }

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some(kw => text.includes(kw))) return domain
  }

  return 'geral'
}
