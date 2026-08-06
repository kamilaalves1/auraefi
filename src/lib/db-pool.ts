import mysql from 'mysql2/promise'
import { logger } from './logger'

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'vertex_control',
      ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '+00:00',
      namedPlaceholders: false,
    })
  }
  return pool
}

/** Get a single row. Uses query() to handle all param types correctly. */
export async function dbGet<T = Record<string, any>>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  const [rows] = await getPool().query(sql, params)
  return (rows as T[])[0]
}

/** Get all rows. Uses query() to handle LIMIT/OFFSET numeric params. */
export async function dbGetAll<T = Record<string, any>>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const [rows] = await getPool().query(sql, params)
  return rows as T[]
}

/** Execute an INSERT/UPDATE/DELETE. Returns insertId and affectedRows. */
export async function dbRun(
  sql: string,
  params: any[] = []
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await getPool().query(sql, params) as any
  return { insertId: result.insertId ?? 0, affectedRows: result.affectedRows ?? 0 }
}

export async function closePool(): Promise<void> {
  if (pool) {
    try { await pool.end() } catch { /* ignore */ }
    pool = null
  }
}
