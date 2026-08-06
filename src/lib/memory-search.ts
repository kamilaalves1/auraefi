/**
 * Memory search — MySQL-compatible stub.
 *
 * The original implementation used SQLite FTS5 virtual tables which are not
 * available in MySQL. Full-text search is preserved via the memory_fts_meta
 * table for metadata, but FTS index operations are no-ops. Search falls back
 * to returning empty results until a MySQL FULLTEXT implementation is added.
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { dbGet, dbGetAll, dbRun } from '@/lib/db-pool'
import { scanMemoryFiles, type MemoryFileInfo } from '@/lib/memory-utils'
import { logger } from '@/lib/logger'

// ─── Schema ──────────────────────────────────────────────────────

/** No-op in MySQL — FTS5 virtual tables are not supported. */
export function ensureFtsTable(_db?: unknown): void {
  // no-op — memory_fts_meta table is created by schema-mysql.sql
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

  // Count readable files (no FTS insert in MySQL)
  let indexed = 0
  for (const file of files) {
    try {
      readFileSync(join(baseDir, file.path), 'utf-8')
      indexed++
    } catch {
      // Skip unreadable files
    }
  }

  await dbRun('INSERT INTO memory_fts_meta (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ['last_rebuild', new Date().toISOString()])
  await dbRun('INSERT INTO memory_fts_meta (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', ['file_count', String(indexed)])

  const duration = Date.now() - start
  logger.info({ indexed, duration }, 'Memory index rebuilt (MySQL stub — no FTS5)')
  return { indexed, duration }
}

/**
 * Index a single file (no-op in MySQL — FTS5 not available).
 */
export function indexFile(_db: unknown, _baseDir: string, _relativePath: string): void {
  // no-op
}

/**
 * Remove a file from the index (no-op in MySQL — FTS5 not available).
 */
export function removeFromIndex(_db: unknown, _relativePath: string): void {
  // no-op
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
  const meta = await dbGet<{ value: string }>("SELECT value FROM memory_fts_meta WHERE key_name = 'last_rebuild'", [])
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

  const meta = await dbGet<{ value: string }>("SELECT value FROM memory_fts_meta WHERE key_name = 'last_rebuild'", [])
  const fileCountMeta = await dbGet<{ value: string }>("SELECT value FROM memory_fts_meta WHERE key_name = 'file_count'", [])

  // MySQL has no FTS5 — return empty results
  // TODO: implement MySQL FULLTEXT search or in-memory file scan fallback
  return {
    query,
    results: [],
    total: 0,
    indexedFiles: fileCountMeta ? Number(fileCountMeta.value) : 0,
    indexedAt: meta?.value ?? null,
  }
}
