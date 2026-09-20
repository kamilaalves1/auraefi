import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, normalize } from 'node:path'
import { requireRole } from '@/lib/auth'

const SKILLS_ROOT = join(process.cwd(), 'skills')

/** Arquivos permitidos dentro de um diretório de skill */
const ALLOWED_FILES = new Set(['SKILL.md', 'harness.json'])

function safeSkillFilePath(name: string, file = 'SKILL.md'): string | null {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) return null
  if (!ALLOWED_FILES.has(file)) return null
  const candidate = resolve(join(SKILLS_ROOT, name, file))
  const root = normalize(SKILLS_ROOT)
  if (!candidate.startsWith(root + '/') && !candidate.startsWith(root + '\\')) return null
  return candidate
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')?.trim() || ''
  const file = searchParams.get('file')?.trim() || 'SKILL.md'

  const skillPath = safeSkillFilePath(name, file)
  if (!skillPath) return NextResponse.json({ error: 'Invalid skill name or file' }, { status: 400 })

  try {
    await access(skillPath, constants.R_OK)
  } catch {
    // harness.json pode não existir — retorna vazio sem erro
    if (file === 'harness.json') return NextResponse.json({ name, file, content: '' })
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const content = await readFile(skillPath, 'utf8')
  return NextResponse.json({ name, file, content })
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  const file = String(body?.file || 'SKILL.md').trim()
  const content = typeof body?.content === 'string' ? body.content : null

  if (!name || content === null) {
    return NextResponse.json({ error: 'name and content are required' }, { status: 400 })
  }

  const skillPath = safeSkillFilePath(name, file)
  if (!skillPath) return NextResponse.json({ error: 'Invalid skill name or file' }, { status: 400 })

  // Para SKILL.md — verifica que o diretório existe
  // Para harness.json — cria mesmo se não existia antes
  if (file === 'SKILL.md') {
    try {
      await access(skillPath, constants.R_OK)
    } catch {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }
  }

  await writeFile(skillPath, content, 'utf8')
  return NextResponse.json({ ok: true, name, file })
}

export const dynamic = 'force-dynamic'
