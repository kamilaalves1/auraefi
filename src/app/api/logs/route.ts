import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { config } from '@/lib/config'
import { tailLines, redigirLinha, parseLogLine, type LogEntry } from '@/lib/log-tail'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const LOGS_PATH = config.logsDir

/**
 * Discover all log files in the logs directory.
 * Scans both top-level and automation/ subdirectory.
 */
async function discoverLogFiles(): Promise<Array<{ path: string; source: string }>> {
  const files: Array<{ path: string; source: string }> = []
  if (!LOGS_PATH) return files

  try {
    const entries = await readdir(LOGS_PATH, { withFileTypes: true })
    for (const entry of entries) {
      // Aceita tambem os rotacionados `nome.log.1`, `nome.log.2`... Sem isto a
      // tela mostrava so o dia corrente: apos a rotacao diaria (instalada em
      // 2026-09-08) o log de ontem -- que e o que se olha depois de um incidente
      // noturno -- ficava invisivel.
      // `.gz` fica de fora de proposito: exigiria descompactar por requisicao.
      if (entry.isFile() && /\.log(\.\d+)?$/.test(entry.name)) {
        files.push({
          path: join(LOGS_PATH, entry.name),
          source: entry.name.replace(/\.log(\.\d+)?$/, (m) => (m === '.log' ? '' : ' (rotacao' + m.slice(4) + ')')),
        })
      } else if (entry.isDirectory()) {
        // Scan subdirectories (e.g., automation/)
        try {
          const subEntries = await readdir(join(LOGS_PATH, entry.name))
          for (const subFile of subEntries) {
            if (subFile.endsWith('.log')) {
              files.push({
                path: join(LOGS_PATH, entry.name, subFile),
                source: `${entry.name}/${subFile.replace('.log', '')}`,
              })
            }
          }
        } catch {
          // Skip unreadable subdirectories
        }
      }
    }
  } catch {
    // Logs directory doesn't exist or isn't readable
  }

  return files
}

async function readLogFile(filePath: string, source: string, maxLines: number): Promise<LogEntry[]> {
  try {
    // Le apenas a CAUDA. A versao anterior fazia `readFile` do arquivo inteiro e
    // so entao descartava tudo menos as ultimas linhas -- com o log de producao
    // em 25,3 MB (medido 2026-09-08), isso acontecia por arquivo descoberto a
    // cada poll da tela, numa instancia de 2 vCPUs.
    const { lines } = await tailLines(filePath, maxLines)
    const entries: LogEntry[] = []

    for (const linha of lines) {
      const entry = parseLogLine(redigirLinha(linha), source)
      if (entry) entries.push(entry)
    }

    return entries
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'recent'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200)
    const level = searchParams.get('level')
    const session = searchParams.get('session')
    const search = searchParams.get('search')
    const source = searchParams.get('source')

    if (action === 'recent') {
      const logFiles = await discoverLogFiles()
      let logs: LogEntry[] = []

      // Read from all discovered log files
      for (const file of logFiles) {
        if (source && file.source !== source) continue
        const entries = await readLogFile(file.path, file.source, 200)
        logs.push(...entries)
      }

      // Sort newest first
      logs.sort((a, b) => b.timestamp - a.timestamp)

      // Apply filters
      if (level) {
        logs = logs.filter(log => log.level === level)
      }
      if (session) {
        logs = logs.filter(log => log.session?.includes(session))
      }
      if (search) {
        const searchLower = search.toLowerCase()
        // Busca tambem no contexto (`data`). Antes da normalizacao do parser, a
        // mensagem de uma linha do pino era o JSON INTEIRO, entao procurar por
        // nome de agente ou por `taskId` funcionava por acidente. Com `message`
        // passando a ser so o `msg`, isso regrediu: procurar "Felipe" devolvia
        // 0. Medido em 2026-09-08.
        logs = logs.filter(log =>
          log.message.toLowerCase().includes(searchLower) ||
          log.source.toLowerCase().includes(searchLower) ||
          (log.data !== undefined && JSON.stringify(log.data).toLowerCase().includes(searchLower))
        )
      }

      logs = logs.slice(0, limit)
      return NextResponse.json({ logs })
    }

    if (action === 'sources') {
      const logFiles = await discoverLogFiles()
      const sources = logFiles.map(f => f.source)
      return NextResponse.json({ sources })
    }

    if (action === 'tail') {
      const sinceTimestamp = parseInt(searchParams.get('since') || '0')
      const logFiles = await discoverLogFiles()
      let logs: LogEntry[] = []

      for (const file of logFiles) {
        if (source && file.source !== source) continue
        const entries = await readLogFile(file.path, file.source, 50)
        logs.push(...entries.filter(e => e.timestamp > sinceTimestamp))
      }

      logs.sort((a, b) => b.timestamp - a.timestamp)
      logs = logs.slice(0, limit)
      return NextResponse.json({ logs })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Logs API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { action, message, level, source: customSource, session } = await request.json()

    if (action === 'add') {
      if (!message) {
        return NextResponse.json({ error: 'Message required' }, { status: 400 })
      }

      const logEntry: LogEntry = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        level: level || 'info',
        source: customSource || 'mission-control',
        session,
        message,
        data: null,
      }

      return NextResponse.json({ success: true, entry: logEntry })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Logs API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
