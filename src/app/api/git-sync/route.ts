/**
 * GET  /api/git-sync?action=status          â€” sync history + provider connection status
 * GET  /api/git-sync?action=issues&flow_id= â€” preview issues from a flow's repo
 * POST /api/git-sync  { action: 'trigger', flow_id }   â€” manual sync for a flow
 * POST /api/git-sync  { action: 'trigger-all' }        â€” sync all active flows
 * POST /api/git-sync  { action: 'test', provider }     â€” test provider token
 */

import { NextRequest, NextResponse } from 'next/server'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getGitProviderClient, testAllProviders } from '@/lib/git-provider'
import { pullFromGitProvider, type DeliveryFlowSyncConfig } from '@/lib/git-sync-engine'
import type { GitProvider } from '@/lib/delivery-flow-types'

// â”€â”€ GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const workspaceId = auth.user.workspace_id ?? 1
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'status'

  try {
    if (action === 'status') {
      return handleStatus(workspaceId)
    }

    if (action === 'issues') {
      const flowId = Number(searchParams.get('flow_id'))
      const state = (searchParams.get('state') ?? 'open') as 'open' | 'closed' | 'all'
      return await handlePreviewIssues(flowId, state, workspaceId)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'GET /api/git-sync error')
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 })
  }
}

// â”€â”€ POST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const workspaceId = auth.user.workspace_id ?? 1
  const body = await request.json().catch(() => ({}))

  try {
    switch (body.action) {
      case 'trigger':
        return await handleTrigger(body.flow_id, workspaceId)
      case 'trigger-all':
        return await handleTriggerAll(workspaceId)
      case 'test':
        return await handleTest(body.provider)
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    logger.error({ err }, `POST /api/git-sync action=${body.action} error`)
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 })
  }
}

// â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handleStatus(workspaceId: number) {
  const syncs = await dbGetAll(`
    SELECT gs.*, df.name as flow_name
    FROM git_syncs gs
    LEFT JOIN delivery_flows df ON df.id = gs.flow_id
    WHERE gs.workspace_id = ?
    ORDER BY gs.created_at DESC
    LIMIT 50
  `, [workspaceId])

  const flows = await dbGetAll(`
    SELECT df.id, df.name, df.is_active,
           gr.provider AS git_provider, gr.repo_url AS git_repo_url, gr.branch AS git_branch, gr.name AS repo_name
    FROM delivery_flows df
    LEFT JOIN git_repositories gr ON gr.id = df.git_repository_id
    WHERE df.workspace_id = ?
    ORDER BY df.created_at ASC
  `, [workspaceId])

  return NextResponse.json({ syncs, flows })
}

async function handlePreviewIssues(flowId: number, state: 'open' | 'closed' | 'all', workspaceId: number) {
  const row = await dbGet(`
    SELECT df.id, gr.provider AS git_provider, gr.repo_url AS git_repo_url, gr.branch AS git_branch
    FROM delivery_flows df
    LEFT JOIN git_repositories gr ON gr.id = df.git_repository_id
    WHERE df.id = ? AND df.workspace_id = ?
  `, [flowId, workspaceId]) as any | undefined

  if (!row) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
  if (!row.git_provider || !row.git_repo_url) {
    return NextResponse.json({ error: 'Flow has no git repo configured' }, { status: 400 })
  }

  const client = getGitProviderClient(row.git_provider as GitProvider)
  const issues = await client.fetchIssues(row.git_repo_url, { state, per_page: 50 })
  return NextResponse.json({ issues, total: issues.length, provider: row.git_provider, repo: row.git_repo_url })
}

async function handleTrigger(flowId: number, workspaceId: number) {
  if (!flowId) return NextResponse.json({ error: 'flow_id required' }, { status: 400 })
  const row = await dbGet(`
    SELECT df.id, df.name, gr.provider AS git_provider, gr.repo_url AS git_repo_url, gr.branch AS git_branch
    FROM delivery_flows df
    LEFT JOIN git_repositories gr ON gr.id = df.git_repository_id
    WHERE df.id = ? AND df.workspace_id = ?
  `, [flowId, workspaceId]) as any | undefined

  if (!row) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
  if (!row.git_provider || !row.git_repo_url) {
    return NextResponse.json({ error: 'Flow has no git repo configured' }, { status: 400 })
  }

  const cfg: DeliveryFlowSyncConfig = {
    flowId: row.id,
    workspaceId,
    provider: row.git_provider as GitProvider,
    repo: row.git_repo_url,
    branch: row.git_branch ?? 'main',
  }

  const result = await pullFromGitProvider(cfg)
  return NextResponse.json({ ok: true, ...result, provider: row.git_provider, repo: row.git_repo_url })
}

async function handleTriggerAll(workspaceId: number) {
  const flows = await dbGetAll(`
    SELECT df.id, df.name,
           gr.provider AS git_provider, gr.repo_url AS git_repo_url, gr.branch AS git_branch
    FROM delivery_flows df
    JOIN git_repositories gr ON gr.id = df.git_repository_id
    WHERE df.workspace_id = ? AND df.is_active = 1
      AND gr.is_active = 1
      AND gr.repo_url IS NOT NULL AND gr.repo_url != ''
  `, [workspaceId]) as any[]

  const results: Array<{ flowId: number; name: string; provider: string; repo: string; result: any }> = []

  for (const flow of flows) {
    try {
      const cfg: DeliveryFlowSyncConfig = {
        flowId: flow.id,
        workspaceId,
        provider: flow.git_provider as GitProvider,
        repo: flow.git_repo_url,
        branch: flow.git_branch ?? 'main',
      }
      const result = await pullFromGitProvider(cfg)
      results.push({ flowId: flow.id, name: flow.name, provider: flow.git_provider, repo: flow.git_repo_url, result })
    } catch (err: any) {
      results.push({ flowId: flow.id, name: flow.name, provider: flow.git_provider, repo: flow.git_repo_url, result: { error: err.message } })
    }
  }

  const totalPulled = results.reduce((s, r) => s + (r.result.pulled ?? 0), 0)
  return NextResponse.json({ ok: true, flows: results.length, totalPulled })
}

async function handleTest(provider: string) {
  if (!provider) {
    // Test all providers
    const results = await testAllProviders()
    return NextResponse.json({ results })
  }
  const client = getGitProviderClient(provider as GitProvider)
  const result = await client.testConnection()
  return NextResponse.json(result)
}
