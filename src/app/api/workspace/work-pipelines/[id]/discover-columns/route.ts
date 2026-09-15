/**
 * POST /api/workspace/work-pipelines/:id/discover-columns
 * Fetches the available columns/statuses from Jira or Azure DevOps
 * and returns them so the UI can populate the column configurator.
 */
import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { decryptWorkPipelineBlob } from '@/lib/work-pipeline-crypto'

type Params = { params: Promise<{ id: string }> }

function stripSlash(u: string) { return u.replace(/\/+$/, '') }

async function discoverJiraColumns(config: Record<string, any>, secrets: Record<string, any>): Promise<string[]> {
  // Accept full board URLs — extract just the origin
  let host: string
  try { host = new URL((config.jiraHost || '').trim()).origin }
  catch { throw new Error('URL do Jira inválida — use o formato https://empresa.atlassian.net') }
  const projectKey = (config.jiraProjectKey || '').trim().replace(/[^A-Za-z0-9_]/g, '')
  const email = (config.jiraAccountEmail || secrets.jiraEmail || '').trim()
  const token = (secrets.jiraApiToken || '').trim()

  if (!host || !projectKey || !email || !token) {
    throw new Error('Configure host, project key, e-mail e token do Jira antes de descobrir colunas')
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'User-Agent': 'AURA/1.0 (Jira Column Discovery)',
  }

  const signal = AbortSignal.timeout(12000)

  async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
    try {
      const r = await fetch(url, { headers, signal })
      const text = await r.text()
      let data: T | null = null
      try { data = JSON.parse(text) } catch { /* not json */ }
      return { ok: r.ok, status: r.status, data }
    } catch (e: any) {
      return { ok: false, status: 0, data: null, error: e.message }
    }
  }

  // Strategy 1: Agile board configuration — preserves left-to-right column order
  const boards = await fetchJson<{ values?: Array<{ id: number; type: string }> }>(
    `${host}/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=10`
  )
  if (boards.ok && boards.data?.values?.length) {
    for (const board of boards.data.values) {
      const cfg = await fetchJson<{ columnConfig?: { columns?: Array<{ name: string }> } }>(
        `${host}/rest/agile/1.0/board/${board.id}/configuration`
      )
      const cols = cfg.data?.columnConfig?.columns
        ?.map(c => c.name?.trim())
        .filter((n): n is string => Boolean(n))
      if (cols?.length) return cols
    }
  }

  // Strategy 2: project statuses endpoint (v3 then v2) — fallback, order may vary
  for (const v of ['3', '2']) {
    const { ok, data } = await fetchJson<Array<{ statuses: Array<{ name: string }> }>>(
      `${host}/rest/api/${v}/project/${projectKey}/statuses`
    )
    if (ok && Array.isArray(data) && data.length > 0) {
      const seen = new Set<string>()
      const columns: string[] = []
      for (const issueType of data) {
        for (const s of issueType.statuses ?? []) {
          if (s.name && !seen.has(s.name)) { seen.add(s.name); columns.push(s.name) }
        }
      }
      if (columns.length > 0) return columns
    }
  }

  // Build diagnostic error
  const status = boards.status || 0
  let detail = 'sem colunas encontradas'
  if (status === 401) detail = 'credenciais inválidas — verifique e-mail e API Token'
  else if (status === 403) detail = 'sem permissão — o token não acessa este projeto'
  else if (status === 404) detail = 'projeto não encontrado — verifique o Project Key'
  else if (status === 0) {
    if (boards.error?.includes('ENOTFOUND')) detail = 'DNS não resolve — verifique a URL do Jira'
    else if (boards.error?.includes('ECONNREFUSED')) detail = 'conexão recusada — servidor não respondeu'
    else if (boards.error?.includes('timeout')) detail = 'timeout — servidor demorou muito'
    else detail = `host inacessível — ${boards.error || 'verifique a URL e conexão de rede'}`
  }

  throw new Error(`Não foi possível importar colunas do Jira: ${detail}`)
}

async function discoverAzureColumns(config: Record<string, any>, secrets: Record<string, any>): Promise<string[]> {
  const orgUrl = (config.azureOrganizationUrl || '').trim()
  const project = (config.azureProject || '').trim()
  const pat = (secrets.azurePat || '').trim()

  if (!orgUrl || !project || !pat) {
    throw new Error('Configure a URL da organização, projeto e PAT do Azure antes de descobrir colunas')
  }

  // Parse org base
  const raw = stripSlash(orgUrl)
  const u = new URL(raw)
  const apiBase = u.hostname === 'dev.azure.com'
    ? `https://dev.azure.com/${u.pathname.split('/').filter(Boolean)[0]}`
    : `https://${u.hostname}`

  const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`

  // Fetch all work item type states
  const res = await fetch(
    `${apiBase}/${encodeURIComponent(project)}/_apis/wit/workitemtypestates?api-version=7.1`,
    { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = `Azure retornou ${res.status}`
    try { const j = JSON.parse(body); msg = j.message || j.value || msg } catch { /* html */ }
    throw new Error(msg)
  }

  const rawText = await res.text()
  let data: { value?: Array<{ states?: Array<{ name: string }> }> }
  try { data = JSON.parse(rawText) } catch {
    throw new Error('Azure retornou resposta inválida — verifique a URL da organização e o projeto')
  }
  const seen = new Set<string>()
  const columns: string[] = []
  for (const wt of data.value ?? []) {
    for (const s of wt.states ?? []) {
      if (s.name && !seen.has(s.name)) { seen.add(s.name); columns.push(s.name) }
    }
  }
  return columns
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params

    const workspaceId = auth.user.workspace_id ?? 1

    const row = await dbGet('SELECT * FROM work_pipelines WHERE id = ? AND workspace_id = ?', [Number(id), workspaceId]) as any
    if (!row) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    let config: Record<string, any> = {}
    try { config = row.config_json ? JSON.parse(row.config_json) : {} } catch { /* ignore */ }

    let secrets: Record<string, any> = {}
    if (row.secret_blob) {
      try { secrets = JSON.parse(decryptWorkPipelineBlob(row.secret_blob)) } catch { /* ignore */ }
    }

    // Allow credentials override from request body (for when user just typed them, not saved yet)
    const body = await request.json().catch(() => ({}))
    if (body.config) config = { ...config, ...body.config }
    if (body.credentials) secrets = { ...secrets, ...body.credentials }

    let columns: string[]
    if (row.provider === 'jira') {
      columns = await discoverJiraColumns(config, secrets)
    } else if (row.provider === 'azure_devops') {
      columns = await discoverAzureColumns(config, secrets)
    } else {
      return NextResponse.json({ error: 'Provider não suporta descoberta de colunas' }, { status: 400 })
    }

    return NextResponse.json({ columns })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/workspace/work-pipelines/[id]/discover-columns error')
    return NextResponse.json({ error: err.message || 'Falha ao descobrir colunas' }, { status: 500 })
  }
}
