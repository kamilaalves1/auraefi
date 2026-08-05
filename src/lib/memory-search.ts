/**
 * Full-text search for the memory filesystem.
 *
 * Uses MySQL FULLTEXT indexes to provide ranked, tokenized search
 * across all markdown/text files in the memory directory.
 *
 * The index is stored in the main MC database alongside other tables.
 * Files are indexed on-demand (first search or explicit rebuild).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { dbGetOne, dbGetAll, dbRun, dbTransaction } from '@/lib/db'
import { scanMemoryFiles, type MemoryFileInfo } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

// ─── Schema ──────────────────────────────────────────────────────

export async function ensureFtsTable(): Promise<void> {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS memory_fts (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      path VARCHAR(1000) NOT NULL,
      title TEXT,
      content MEDIUMTEXT,
      PRIMARY KEY (id),
      UNIQUE KEY uk_path (path(255)),
      FULLTEXT KEY idx_fts (title, content)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS memory_fts_meta (
      \`key\` VARCHAR(100) NOT NULL,
      value TEXT,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

// ─── Index management ────────────────────────────────────────────

function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)/m)
  if (h1Match) return h1Match[1].trim()
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/title:\s*(.+)/)
    if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  return filename.replace(/\.(md|txt)$/, '').replace(/[-_]/g, ' ')
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

export async function rebuildIndex(baseDir: string, allowedPrefixes: string[]): Promise<{ indexed: number; duration: number }> {
  const start = Date.now()
  await ensureFtsTable()

  const files: MemoryFileInfo[] = []
  if (allowedPrefixes.length) {
    for (const prefix of allowedPrefixes) {
      const folder = prefix.replace(/\/$/, '')
      const fullPath = join(baseDir, folder)
      if (!existsSync(fullPath)) continue
      const prefixFiles = await scanMemoryFiles(fullPath, { extensions: ['.md', '.txt'] })
      for (const f of prefixFiles) {
        files.push({ ...f, path: join(folder, f.path) })
      }
    }
  } else {
    files.push(...await scanMemoryFiles(baseDir, { extensions: ['.md', '.txt'] }))
  }

  let indexed = 0
  await dbTransaction(async (conn) => {
    await conn.execute('DELETE FROM memory_fts')

    for (const file of files) {
      try {
        const content = readFileSync(join(baseDir, file.path), 'utf-8')
        const title = extractTitle(content, file.name)
        const body = stripFrontmatter(content)
        await conn.execute(
          'INSERT INTO memory_fts (path, title, content) VALUES (?, ?, ?)',
          [file.path, title, body]
        )
        indexed++
      } catch {
        // Skip unreadable files
      }
    }

    await conn.execute(
      'REPLACE INTO memory_fts_meta (`key`, value) VALUES (?, ?)',
      ['last_rebuild', new Date().toISOString()]
    )
    await conn.execute(
      'REPLACE INTO memory_fts_meta (`key`, value) VALUES (?, ?)',
      ['file_count', String(indexed)]
    )
  })

  const duration = Date.now() - start
  logger.info({ indexed, duration }, 'Memory FTS index rebuilt')
  return { indexed, duration }
}

/**
 * Index a single file (for incremental updates after saves).
 */
export async function indexFile(baseDir: string, relativePath: string): Promise<void> {
  await ensureFtsTable()
  try {
    const content = readFileSync(join(baseDir, relativePath), 'utf-8')
    const name = relativePath.split('/').pop() || relativePath
    const title = extractTitle(content, name)
    const body = stripFrontmatter(content)

    await dbTransaction(async (conn) => {
      await conn.execute('DELETE FROM memory_fts WHERE path = ?', [relativePath])
      await conn.execute(
        'INSERT INTO memory_fts (path, title, content) VALUES (?, ?, ?)',
        [relativePath, title, body]
      )
    })
  } catch (err) {
    logger.warn({ err, path: relativePath }, 'Failed to index file for FTS')
  }
}

/**
 * Remove a file from the index.
 */
export async function removeFromIndex(relativePath: string): Promise<void> {
  try {
    await dbRun('DELETE FROM memory_fts WHERE path = ?', [relativePath])
  } catch {
    // Index may not exist yet
  }
}

// ─── Search ──────────────────────────────────────────────────────

export interface SearchResult {
  path: string
  title: string
  snippet: string
  rank: number
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
  indexedFiles: number
  indexedAt: string | null
}

async function ensureIndex(baseDir: string, allowedPrefixes: string[]): Promise<void> {
  await ensureFtsTable()

  const meta = await dbGetOne<{ value: string }>(
    "SELECT value FROM memory_fts_meta WHERE `key` = 'last_rebuild'"
  )

  if (!meta) {
    await rebuildIndex(baseDir, allowedPrefixes)
  }
}

export async function searchMemory(
  baseDir: string,
  allowedPrefixes: string[],
  query: string,
  opts?: { limit?: number }
): Promise<SearchResponse> {
  await ensureIndex(baseDir, allowedPrefixes)

  const limit = opts?.limit ?? 20
  const sanitized = sanitizeFtsQuery(query)

  let results: SearchResult[] = []
  let total = 0

  if (sanitized) {
    try {
      const rows = await dbGetAll<{ path: string; title: string; snippet: string; rank: number }>(`
        SELECT
          path,
          title,
          LEFT(content, 300) as snippet,
          MATCH(title, content) AGAINST(? IN BOOLEAN MODE) AS rank
        FROM memory_fts
        WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)
        ORDER BY rank DESC
        LIMIT ?
      `, [sanitized, sanitized, limit])

      results = rows.map((r) => ({
        path: r.path,
        title: r.title,
        snippet: r.snippet,
        rank: Math.abs(r.rank),
      }))

      const countRow = await dbGetOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM memory_fts WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)',
        [sanitized]
      )
      total = countRow?.cnt ?? 0
    } catch (err) {
      logger.warn({ err, query: sanitized }, 'Fulltext query failed, falling back to LIKE search')
      try {
        const fallbackPattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`
        const rows = await dbGetAll<{ path: string; title: string; snippet: string; rank: number }>(`
          SELECT path, title, LEFT(content, 300) as snippet, 1 as rank
          FROM memory_fts
          WHERE title LIKE ? OR content LIKE ?
          ORDER BY title
          LIMIT ?
        `, [fallbackPattern, fallbackPattern, limit])
        results = rows.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet, rank: Math.abs(r.rank) }))
        total = results.length
      } catch {
        // Return empty on total failure
      }
    }
  }

  const meta = await dbGetOne<{ value: string }>(
    "SELECT value FROM memory_fts_meta WHERE `key` = 'last_rebuild'"
  )
  const fileCountMeta = await dbGetOne<{ value: string }>(
    "SELECT value FROM memory_fts_meta WHERE `key` = 'file_count'"
  )

  return {
    query,
    results,
    total,
    indexedFiles: fileCountMeta ? Number(fileCountMeta.value) : 0,
    indexedAt: meta?.value ?? null,
  }
}

/**
 * Sanitize a user query for MySQL FULLTEXT BOOLEAN MODE.
 */
function sanitizeFtsQuery(query: string): string {
  const trimmed = query.trim()
  if (!trimmed) return ''

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    return `+${words[0]}*`
  }

  // Multiple words — require all terms with prefix matching
  return words.map((w) => `+${w}*`).join(' ')
}
