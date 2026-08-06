import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'

const SETTING_KEY = 'anthropic.api_key'

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const row = await dbGet('SELECT value FROM settings WHERE `key` = ?', [SETTING_KEY]) as { value: string } | undefined
  const hasKey = Boolean(row?.value?.trim())
  const preview = hasKey ? row!.value.slice(0, 8) + 'â€¢â€¢â€¢â€¢' : null

  return NextResponse.json({ hasKey, preview })
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { anthropicApiKey } = await request.json()
  if (typeof anthropicApiKey !== 'string') {
    return NextResponse.json({ error: 'anthropicApiKey required' }, { status: 400 })
  }
  const value = anthropicApiKey.trim()

  await dbRun(`INSERT INTO settings (\`key\`, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`, [SETTING_KEY, value])
  // Also keep the unified integrations key in sync
  if (value) {
    await dbRun(`INSERT INTO settings (\`key\`, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`, ['integration.ANTHROPIC_API_KEY', value])
  } else {
    await dbRun('DELETE FROM settings WHERE `key` = ?', ['integration.ANTHROPIC_API_KEY'])
  }

  return NextResponse.json({ ok: true, hasKey: Boolean(value) })
}
