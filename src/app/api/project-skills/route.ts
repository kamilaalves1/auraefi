import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, normalize } from 'node:path'
import { requireRole } from '@/lib/auth'

const SKILLS_ROOT = join(process.cwd(), 'skills')

function safeSkillPath(name: string): string | null {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) return null
  const candidate = resolve(join(SKILLS_ROOT, name, 'SKILL.md'))
  if (!candidate.startsWith(normalize(SKILLS_ROOT) + '/') && !candidate.startsWith(normalize(SKILLS_ROOT) + '\\')) return null
  return candidate
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')?.trim() || ''

  const skillPath = safeSkillPath(name)
  if (!skillPath) return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 })

  try {
    await access(skillPath, constants.R_OK)
  } catch {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const content = await readFile(skillPath, 'utf8')
  return NextResponse.json({ name, content })
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  const content = typeof body?.content === 'string' ? body.content : null

  if (!name || content === null) {
    return NextResponse.json({ error: 'name and content are required' }, { status: 400 })
  }

  const skillPath = safeSkillPath(name)
  if (!skillPath) return NextResponse.json({ error: 'Invalid skill name' }, { status: 400 })

  try {
    await access(skillPath, constants.R_OK)
  } catch {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  await writeFile(skillPath, content, 'utf8')
  return NextResponse.json({ ok: true, name })
}

export const dynamic = 'force-dynamic'
