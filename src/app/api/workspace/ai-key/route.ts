import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

const SETTING_KEY = 'anthropic.api_key'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined
  const hasKey = Boolean(row?.value?.trim())
  const preview = hasKey ? row!.value.slice(0, 8) + '••••' : null

  return NextResponse.json({ hasKey, preview })
}

export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { anthropicApiKey } = await request.json()
  if (typeof anthropicApiKey !== 'string') {
    return NextResponse.json({ error: 'anthropicApiKey required' }, { status: 400 })
  }

  const db = getDatabase()
  const value = anthropicApiKey.trim()

  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  stmt.run(SETTING_KEY, value)
  // Also keep the unified integrations key in sync
  if (value) {
    stmt.run('integration.ANTHROPIC_API_KEY', value)
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run('integration.ANTHROPIC_API_KEY')
  }

  return NextResponse.json({ ok: true, hasKey: Boolean(value) })
}
