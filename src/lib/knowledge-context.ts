/**
 * knowledge-context.ts
 *
 * Camada de contexto de conhecimento externo.
 *
 * Lê a seção "## Fontes de conhecimento" da skill do agente,
 * detecta as URLs e o tipo de cada fonte, busca o conteúdo
 * via API e retorna um bloco formatado para injetar no prompt.
 *
 * Fontes suportadas:
 *   - Jira histórico  (automático — usa credenciais do pipeline)
 *   - Miro            (MIRO_TOKEN na tabela de integrações)
 *   - Confluence      (CONFLUENCE_TOKEN na tabela de integrações)
 *   - SharePoint      (SHAREPOINT_TOKEN via Microsoft Graph)
 *
 * Configuração na skill:
 *
 * ## Fontes de conhecimento
 * - Jira: histórico de cards concluídos da mesma épica
 * - Miro: https://miro.com/app/board/ABC123/
 * - Confluence: https://efisupport.atlassian.net/wiki/spaces/CARTOES
 * - SharePoint: https://efisupport.sharepoint.com/sites/cartoes/docs
 */

import { logger } from './logger'
import { dbGet } from './db-pool'
import type { WorkPipelineConfigJson, WorkPipelineSecrets } from './work-pipeline-types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface KnowledgeSource {
  type: 'jira_history' | 'miro' | 'confluence' | 'sharepoint' | 'unknown'
  url: string
  raw: string  // linha original da skill
}

export interface KnowledgeChunk {
  source: string
  title: string
  content: string
}

// ─── Parser de fontes na skill ────────────────────────────────────────────────

/**
 * Extrai a seção "## Fontes de conhecimento" da skill e retorna
 * a lista de fontes identificadas.
 */
export function parseKnowledgeSources(skillContent: string): KnowledgeSource[] {
  // Encontra a seção "## Fontes de conhecimento"
  const sectionMatch = skillContent.match(
    /##\s*Fontes\s*de\s*conhecimento\s*\n([\s\S]*?)(?=\n##|\n---|\s*$)/i
  )
  if (!sectionMatch) return []

  const sectionText = sectionMatch[1]
  const sources: KnowledgeSource[] = []

  for (const line of sectionText.split('\n')) {
    const trimmed = line.replace(/^[\s\-*]+/, '').trim()
    if (!trimmed) continue

    // Jira histórico (sem URL — usa credenciais do pipeline)
    if (/^jira\s*:/i.test(trimmed)) {
      sources.push({ type: 'jira_history', url: '', raw: trimmed })
      continue
    }

    // Miro
    const miroMatch = trimmed.match(/miro\.com\/app\/board\/([^/\s?#]+)/i)
    if (miroMatch) {
      sources.push({ type: 'miro', url: trimmed.match(/https?:\/\/[^\s]+/)?.[0] ?? '', raw: trimmed })
      continue
    }

    // Confluence — detecta pela URL ou pela palavra-chave
    if (/confluence|atlassian\.net\/wiki/i.test(trimmed)) {
      sources.push({ type: 'confluence', url: trimmed.match(/https?:\/\/[^\s]+/)?.[0] ?? '', raw: trimmed })
      continue
    }

    // SharePoint
    if (/sharepoint\.com/i.test(trimmed)) {
      sources.push({ type: 'sharepoint', url: trimmed.match(/https?:\/\/[^\s]+/)?.[0] ?? '', raw: trimmed })
      continue
    }

    // URL genérica — tenta inferir pelo domínio
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      sources.push({ type: 'unknown', url: urlMatch[0], raw: trimmed })
    }
  }

  return sources
}

// ─── Resolver de tokens ───────────────────────────────────────────────────────

async function resolveToken(envKey: string): Promise<string | null> {
  const fromEnv = (process.env[envKey] || '').trim()
  if (fromEnv) return fromEnv
  try {
    const row = await dbGet<{ value: string }>(
      `SELECT value FROM settings WHERE \`key\` = ?`, [`integration.${envKey}`]
    )
    return row?.value?.trim() || null
  } catch {
    return null
  }
}

// ─── Jira histórico ───────────────────────────────────────────────────────────

/**
 * Busca contexto histórico do Jira:
 * 1. Épica vinculada ao card atual
 * 2. Últimos 5 cards concluídos da mesma épica (com comentários dos agentes)
 * 3. Últimos 3 cards similares no projeto por texto
 */
export async function fetchJiraHistory(
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  cardTitle: string,
  cardDescription: string,
): Promise<KnowledgeChunk[]> {
  const host = (cfg.jiraHost || '').trim().replace(/\/+$/, '')
  const email = (cfg.jiraAccountEmail || secrets.jiraEmail || '').trim()
  const token = (secrets.jiraApiToken || '').trim()
  if (!host || !email || !token) return []

  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' }
  const chunks: KnowledgeChunk[] = []

  try {
    // 1. Busca o card atual para encontrar a épica vinculada
    const issueRes = await fetch(
      `${host}/rest/api/3/issue/${encodeURIComponent(cardKey)}?fields=parent,customfield_10014,summary`,
      { headers, signal: AbortSignal.timeout(10_000) }
    )
    if (!issueRes.ok) throw new Error(`Jira issue ${issueRes.status}`)

    const issueData = await issueRes.json() as {
      fields: {
        parent?: { key: string; fields?: { summary?: string } }
        customfield_10014?: string  // Epic Link (Server)
        summary?: string
      }
    }

    // Detecta a épica — pode ser parent (Next-gen) ou customfield_10014 (Classic)
    const epicKey = issueData.fields.parent?.key || issueData.fields.customfield_10014 || null

    // 2. Cards concluídos da mesma épica
    if (epicKey) {
      const epicRes = await fetch(
        `${host}/rest/api/3/issue/${encodeURIComponent(epicKey)}?fields=summary,description`,
        { headers, signal: AbortSignal.timeout(10_000) }
      )
      if (epicRes.ok) {
        const epicData = await epicRes.json() as { fields: { summary?: string } }
        chunks.push({
          source: `Jira — Épica ${epicKey}`,
          title: `Épica: ${epicData.fields.summary ?? epicKey}`,
          content: `Esta épica agrupa as entregas relacionadas. Card atual ${cardKey} faz parte desta épica.`,
        })
      }

      // Cards concluídos da épica
      const epicCardsUrl = new URL(`${host}/rest/api/3/search/jql`)
      epicCardsUrl.searchParams.set('jql', `"Epic Link" = ${epicKey} AND status = Done ORDER BY updated DESC`)
      epicCardsUrl.searchParams.set('maxResults', '5')
      epicCardsUrl.searchParams.set('fields', 'summary,comment')

      const epicCardsRes = await fetch(epicCardsUrl.toString(), { headers, signal: AbortSignal.timeout(15_000) })
      if (epicCardsRes.ok) {
        const epicCardsData = await epicCardsRes.json() as {
          issues: Array<{
            key: string
            fields: {
              summary: string
              comment?: { comments: Array<{ body: unknown; author?: { displayName?: string } }> }
            }
          }>
        }

        for (const issue of epicCardsData.issues || []) {
          if (issue.key === cardKey) continue  // não inclui o próprio card

          // Extrai comentários dos agentes (contêm 🤖 no início)
          const agentComments = (issue.fields.comment?.comments || [])
            .filter(c => {
              const text = extractCommentText(c.body)
              return text.includes('🤖') || text.includes('ANALYSIS:') || text.includes('ARCHITECTURE:')
            })
            .slice(-3)  // últimas 3 mensagens de agentes
            .map(c => extractCommentText(c.body).slice(0, 800))
            .join('\n\n')

          if (agentComments) {
            chunks.push({
              source: `Jira — ${issue.key}`,
              title: `Card anterior: ${issue.fields.summary}`,
              content: agentComments,
            })
          }
        }
      }
    }

    // 3. Cards similares no projeto por texto
    const projectKey = (cfg.jiraProjectKey || '').trim().replace(/[^A-Za-z0-9_]/g, '')
    if (projectKey && cardTitle) {
      // Usa as primeiras palavras significativas do título para busca
      const searchTerms = cardTitle
        .replace(/[^\w\sáàâãéèêíìïóòôõúùûçÁÀÂÃÉÈÊÍÌÏÓÒÔÕÚÙÛÇ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 4)
        .join(' ')

      if (searchTerms) {
        const similarUrl = new URL(`${host}/rest/api/3/search/jql`)
        similarUrl.searchParams.set(
          'jql',
          `project = ${projectKey} AND status = Done AND text ~ "${searchTerms.replace(/"/g, '\\"')}" ORDER BY updated DESC`
        )
        similarUrl.searchParams.set('maxResults', '3')
        similarUrl.searchParams.set('fields', 'summary,comment')

        const similarRes = await fetch(similarUrl.toString(), { headers, signal: AbortSignal.timeout(15_000) })
        if (similarRes.ok) {
          const similarData = await similarRes.json() as {
            issues: Array<{
              key: string
              fields: {
                summary: string
                comment?: { comments: Array<{ body: unknown }> }
              }
            }>
          }

          for (const issue of similarData.issues || []) {
            if (issue.key === cardKey) continue
            // Evita duplicar cards já incluídos via épica
            if (chunks.some(c => c.source.includes(issue.key))) continue

            const agentComments = (issue.fields.comment?.comments || [])
              .filter(c => {
                const text = extractCommentText(c.body)
                return text.includes('🤖') || text.includes('ANALYSIS:') || text.includes('ARCHITECTURE:') || text.includes('VERDICT:')
              })
              .slice(-2)
              .map(c => extractCommentText(c.body).slice(0, 600))
              .join('\n\n')

            if (agentComments) {
              chunks.push({
                source: `Jira — ${issue.key} (card similar)`,
                title: `Card similar: ${issue.fields.summary}`,
                content: agentComments,
              })
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, cardKey }, 'knowledge-context: Jira history fetch failed')
  }

  return chunks
}

/** Extrai texto de um body de comentário Jira (ADF ou string) */
function extractCommentText(body: unknown): string {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (typeof body !== 'object') return ''

  const extractAdf = (node: unknown): string => {
    if (!node || typeof node !== 'object') return ''
    const o = node as Record<string, unknown>
    if (typeof o.text === 'string') return o.text
    if (o.type === 'hardBreak') return '\n'
    if (Array.isArray(o.content)) return o.content.map(extractAdf).join('')
    return ''
  }

  return extractAdf(body)
}

// ─── Miro ─────────────────────────────────────────────────────────────────────

/**
 * Lê um quadro Miro e extrai texto dos widgets (sticky notes, shapes, text).
 * Requer MIRO_TOKEN configurado na tela de Integrações.
 */
export async function fetchMiroBoard(boardUrl: string): Promise<KnowledgeChunk[]> {
  const token = await resolveToken('MIRO_TOKEN')
  if (!token) {
    logger.info({ boardUrl }, 'knowledge-context: MIRO_TOKEN not configured, skipping Miro')
    return []
  }

  // Extrai o board ID da URL
  // Formatos: /app/board/ABC123/ ou /board/ABC123/
  const boardIdMatch = boardUrl.match(/(?:app\/board|board)\/([^/?#]+)/i)
  if (!boardIdMatch) {
    logger.warn({ boardUrl }, 'knowledge-context: could not extract Miro board ID from URL')
    return []
  }
  const boardId = boardIdMatch[1]

  try {
    // Busca os widgets do quadro (items)
    // type=sticky_note,text,shape traz os elementos com texto
    const res = await fetch(
      `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}/items?type=sticky_note,text,shape&limit=50`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!res.ok) {
      logger.warn({ boardId, status: res.status }, 'knowledge-context: Miro API error')
      return []
    }

    const data = await res.json() as {
      data: Array<{
        type: string
        data?: { content?: string; shape?: string }
        style?: { fillColor?: string }
        position?: { x: number; y: number }
      }>
    }

    // Extrai texto de cada widget, agrupa por tipo
    const texts: string[] = []
    for (const item of data.data || []) {
      const content = item.data?.content
      if (!content) continue

      // Remove HTML tags do conteúdo (Miro retorna HTML em sticky notes)
      const cleanText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (cleanText.length > 5) {
        texts.push(cleanText)
      }
    }

    if (!texts.length) return []

    // Busca metadados do quadro para o título
    const boardRes = await fetch(
      `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      }
    )
    const boardName = boardRes.ok
      ? ((await boardRes.json()) as { name?: string }).name ?? 'Quadro Miro'
      : 'Quadro Miro'

    return [{
      source: `Miro — ${boardName}`,
      title: boardName,
      content: texts.join('\n\n').slice(0, 8000),  // limite de contexto
    }]
  } catch (err) {
    logger.warn({ err, boardId }, 'knowledge-context: Miro fetch failed')
    return []
  }
}

// ─── Confluence ───────────────────────────────────────────────────────────────

/**
 * Lê páginas de um espaço Confluence.
 * Suporta URL de espaço (/wiki/spaces/KEY) ou URL de página específica (/wiki/spaces/KEY/pages/ID).
 * Requer CONFLUENCE_TOKEN configurado na tela de Integrações.
 */
export async function fetchConfluencePage(confluenceUrl: string): Promise<KnowledgeChunk[]> {
  const token = await resolveToken('CONFLUENCE_TOKEN')
  if (!token) {
    logger.info({ confluenceUrl }, 'knowledge-context: CONFLUENCE_TOKEN not configured, skipping Confluence')
    return []
  }

  try {
    const url = new URL(confluenceUrl)
    const baseUrl = `${url.protocol}//${url.host}`
    const auth = `Bearer ${token}`

    // Detecta se é URL de página específica ou espaço
    const pageIdMatch = confluenceUrl.match(/\/pages\/(\d+)/)
    const spaceKeyMatch = confluenceUrl.match(/\/spaces\/([^/?#]+)/)

    const chunks: KnowledgeChunk[] = []

    if (pageIdMatch) {
      // Página específica
      const pageId = pageIdMatch[1]
      const res = await fetch(
        `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.view,title`,
        { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
      )
      if (!res.ok) return []

      const data = await res.json() as { title: string; body: { view: { value: string } } }
      const cleanContent = data.body.view.value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000)

      if (cleanContent) {
        chunks.push({
          source: `Confluence — ${data.title}`,
          title: data.title,
          content: cleanContent,
        })
      }
    } else if (spaceKeyMatch) {
      // Espaço inteiro — busca as páginas mais recentes/relevantes
      const spaceKey = spaceKeyMatch[1]
      const res = await fetch(
        `${baseUrl}/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&expand=body.view,title&limit=5&orderby=modified`,
        { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
      )
      if (!res.ok) return []

      const data = await res.json() as { results: Array<{ title: string; body: { view: { value: string } } }> }
      for (const page of data.results || []) {
        const cleanContent = page.body.view.value
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000)

        if (cleanContent) {
          chunks.push({
            source: `Confluence — ${page.title}`,
            title: page.title,
            content: cleanContent,
          })
        }
      }
    }

    return chunks
  } catch (err) {
    logger.warn({ err, confluenceUrl }, 'knowledge-context: Confluence fetch failed')
    return []
  }
}

// ─── SharePoint ───────────────────────────────────────────────────────────────

/**
 * Lê documentos de um site SharePoint via Microsoft Graph API.
 * Requer SHAREPOINT_TOKEN (Bearer token do Microsoft Graph) na tela de Integrações.
 * O token pode ser o mesmo AZURE_CLIENT_SECRET + tenant para auth de app.
 */
export async function fetchSharePointDocs(sharePointUrl: string): Promise<KnowledgeChunk[]> {
  const token = await resolveToken('SHAREPOINT_TOKEN')
  if (!token) {
    logger.info({ sharePointUrl }, 'knowledge-context: SHAREPOINT_TOKEN not configured, skipping SharePoint')
    return []
  }

  try {
    const url = new URL(sharePointUrl)
    const hostname = url.hostname  // ex: efisupport.sharepoint.com

    // Extrai o site path — ex: /sites/cartoes
    const siteMatch = sharePointUrl.match(/\/sites\/([^/?#]+)/)
    if (!siteMatch) {
      logger.warn({ sharePointUrl }, 'knowledge-context: could not extract SharePoint site from URL')
      return []
    }
    const sitePath = `/sites/${siteMatch[1]}`

    const graphBase = 'https://graph.microsoft.com/v1.0'
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

    // 1. Resolve o site ID
    const siteRes = await fetch(
      `${graphBase}/sites/${hostname}:${sitePath}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    )
    if (!siteRes.ok) {
      logger.warn({ status: siteRes.status, sitePath }, 'knowledge-context: SharePoint site not found')
      return []
    }
    const siteData = await siteRes.json() as { id: string; displayName?: string }
    const siteId = siteData.id

    // 2. Busca a drive padrão do site
    const driveRes = await fetch(
      `${graphBase}/sites/${siteId}/drive/root/children?$select=name,id,file,@microsoft.graph.downloadUrl&$top=10`,
      { headers, signal: AbortSignal.timeout(15_000) }
    )
    if (!driveRes.ok) return []

    const driveData = await driveRes.json() as {
      value: Array<{
        name: string
        id: string
        file?: { mimeType?: string }
        '@microsoft.graph.downloadUrl'?: string
      }>
    }

    const chunks: KnowledgeChunk[] = []
    const TEXT_TYPES = ['text/plain', 'text/markdown', 'application/json']

    for (const item of (driveData.value || []).slice(0, 5)) {
      const mimeType = item.file?.mimeType ?? ''
      const downloadUrl = item['@microsoft.graph.downloadUrl']
      if (!downloadUrl) continue

      // Lê apenas arquivos de texto — Word e PDF requerem conversão extra
      if (TEXT_TYPES.some(t => mimeType.includes(t)) ||
          /\.(md|txt|json)$/i.test(item.name)) {
        const contentRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(15_000) })
        if (!contentRes.ok) continue
        const text = (await contentRes.text()).slice(0, 4000).trim()
        if (text) {
          chunks.push({
            source: `SharePoint — ${siteData.displayName ?? sitePath}/${item.name}`,
            title: item.name,
            content: text,
          })
        }
      }
    }

    return chunks
  } catch (err) {
    logger.warn({ err, sharePointUrl }, 'knowledge-context: SharePoint fetch failed')
    return []
  }
}

// ─── Orquestrador principal ───────────────────────────────────────────────────

/**
 * Constrói o contexto de conhecimento externo para um agente.
 *
 * Lê as fontes declaradas na skill do agente, busca o conteúdo
 * de cada uma em paralelo e retorna um bloco formatado para
 * injetar no prompt.
 *
 * Timeout global: 30 segundos. Se uma fonte demorar mais, é ignorada.
 */
export async function buildKnowledgeContext(
  agentSkillContent: string,
  cfg: WorkPipelineConfigJson,
  secrets: WorkPipelineSecrets,
  cardKey: string,
  cardTitle: string,
  cardDescription: string,
): Promise<string> {
  const sources = parseKnowledgeSources(agentSkillContent)
  if (!sources.length) return ''

  const allChunks: KnowledgeChunk[] = []

  // Executa todas as fontes em paralelo com timeout global de 30s
  const fetches = sources.map(async (source): Promise<KnowledgeChunk[]> => {
    try {
      switch (source.type) {
        case 'jira_history':
          return await fetchJiraHistory(cfg, secrets, cardKey, cardTitle, cardDescription)
        case 'miro':
          return source.url ? await fetchMiroBoard(source.url) : []
        case 'confluence':
          return source.url ? await fetchConfluencePage(source.url) : []
        case 'sharepoint':
          return source.url ? await fetchSharePointDocs(source.url) : []
        default:
          return []
      }
    } catch {
      return []
    }
  })

  const results = await Promise.allSettled(
    fetches.map(f => Promise.race([
      f,
      new Promise<KnowledgeChunk[]>(resolve => setTimeout(() => resolve([]), 30_000)),
    ]))
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allChunks.push(...result.value)
    }
  }

  if (!allChunks.length) return ''

  // Formata como bloco de contexto
  const lines = [
    `## 📚 Contexto de conhecimento externo`,
    ``,
    `As seguintes fontes foram consultadas antes desta execução:`,
    ``,
  ]

  for (const chunk of allChunks) {
    lines.push(`### ${chunk.title}`)
    lines.push(`*Fonte: ${chunk.source}*`)
    lines.push(``)
    lines.push(chunk.content.slice(0, 4000))
    lines.push(``)
    lines.push(`---`)
    lines.push(``)
  }

  logger.info(
    { cardKey, sources: allChunks.map(c => c.source) },
    'knowledge-context: context built successfully'
  )

  return lines.join('\n').trim()
}
