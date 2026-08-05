/**
 * POST /api/workspace/git-repositories/:id/test
 * Tests the connection to the repository using its stored token (or env-var fallback).
 */

import { NextRequest, NextResponse } from 'next/server'
import { dbGetOne } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getEffectiveEnvValue } from '@/lib/runtime-env'
import type { GitProvider } from '@/lib/delivery-flow-types'

function normaliseRepoUrl(raw: string): string {
  const s = raw.trim()
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`)
    return url.pathname.replace(/^\//, '').replace(/\.git$/, '')
  } catch {
    return s.replace(/\.git$/, '')
  }
}

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const workspaceId = auth.user.workspace_id ?? 1

    const row = await dbGetOne<any>(
      'SELECT * FROM git_repositories WHERE id = ? AND workspace_id = ?',
      [Number(id), workspaceId]
    )

    if (!row) return NextResponse.json({ error: 'Repository not found' }, { status: 404 })

    const provider = row.provider as GitProvider
    const storedToken: string | null = row.access_token ?? null
    const baseUrl: string | null = row.base_url ?? null

    // Normalise repo_url: strip https://github.com/ prefix, .git suffix, etc.
    const repoId: string = normaliseRepoUrl(row.repo_url ?? '')

    // Resolve the effective token: per-repo first, then env var
    let token: string | null = storedToken
    if (!token) {
      const envKey = provider === 'github' ? 'GITHUB_TOKEN'
        : provider === 'gitlab' ? 'GITLAB_TOKEN'
        : 'BITBUCKET_TOKEN'
      token = await getEffectiveEnvValue(envKey) || null
    }

    if (!token) {
      return NextResponse.json({
        ok: false,
        error: `Nenhum token configurado. Adicione o token neste repositório ou configure a variável de ambiente ${
          provider === 'github' ? 'GITHUB_TOKEN' : provider === 'gitlab' ? 'GITLAB_TOKEN' : 'BITBUCKET_TOKEN'
        }.`,
      })
    }

    // Test auth + repo access using the resolved token directly
    if (provider === 'github') {
      return NextResponse.json(await testGitHub(token, repoId))
    } else if (provider === 'gitlab') {
      return NextResponse.json(await testGitLab(token, repoId, baseUrl))
    } else {
      return NextResponse.json(await testBitbucket(token, repoId))
    }
  } catch (err: any) {
    logger.error({ err }, 'POST /api/workspace/git-repositories/[id]/test error')
    return NextResponse.json({ ok: false, error: err.message || 'Test failed' })
  }
}

async function testGitHub(token: string, repo: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'MissionControl/1.0',
  }
  // 1. Check auth
  const userRes = await fetch('https://api.github.com/user', { headers })
  if (!userRes.ok) return { ok: false, error: `Auth falhou: HTTP ${userRes.status}` }
  const user = await userRes.json()

  // 2. Check repo access
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers })
  if (!repoRes.ok) return { ok: false, error: `Repositório "${repo}" não encontrado (HTTP ${repoRes.status}) — verifique se a URL está correta` }

  return { ok: true, user: user.login }
}

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`)
    if (!['https:', 'http:'].includes(url.protocol)) return true
    const h = url.hostname
    if (['localhost', '0.0.0.0', '::1'].includes(h)) return true
    if (h.endsWith('.local')) return true
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
      const [a, b] = h.split('.').map(Number)
      if (a === 10 || a === 127) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
      if (a === 100 && b >= 64 && b <= 127) return true
    }
    if (/^(\[?fc|fd|fe80)/i.test(h)) return true
    return false
  } catch { return true }
}

async function testGitLab(token: string, repo: string, baseUrl: string | null) {
  const resolvedBase = (baseUrl || 'https://gitlab.com').replace(/\/$/, '')
  if (isBlockedUrl(resolvedBase)) {
    return { ok: false, error: 'base_url aponta para endereço privado não permitido' }
  }
  const base = resolvedBase
  const headers = { 'PRIVATE-TOKEN': token, 'User-Agent': 'MissionControl/1.0' }

  // 1. Check auth
  const userRes = await fetch(`${base}/api/v4/user`, { headers })
  if (!userRes.ok) return { ok: false, error: `Auth falhou: HTTP ${userRes.status}` }
  const user = await userRes.json()

  // 2. Check repo access
  const projectRes = await fetch(`${base}/api/v4/projects/${encodeURIComponent(repo)}`, { headers })
  if (!projectRes.ok) return { ok: false, error: `Repositório inacessível: HTTP ${projectRes.status} — verifique o caminho e as permissões do token` }

  return { ok: true, user: `${user.username} @ ${base}` }
}

async function testBitbucket(token: string, repo: string) {
  const authHeader = token.includes(':')
    ? `Basic ${Buffer.from(token).toString('base64')}`
    : `Bearer ${token}`
  const headers = { Authorization: authHeader, 'User-Agent': 'MissionControl/1.0' }

  // 1. Check auth
  const userRes = await fetch('https://api.bitbucket.org/2.0/user', { headers })
  if (!userRes.ok) return { ok: false, error: `Auth falhou: HTTP ${userRes.status}` }
  const user = await userRes.json()

  // 2. Check repo access
  const repoRes = await fetch(`https://api.bitbucket.org/2.0/repositories/${repo}`, { headers })
  if (!repoRes.ok) return { ok: false, error: `Repositório inacessível: HTTP ${repoRes.status} — verifique o slug e as permissões do token` }

  return { ok: true, user: user.display_name || user.nickname }
}
