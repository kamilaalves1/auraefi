import mysql from 'mysql2/promise'
import { logger } from './logger'

const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = '3306',
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '',
  MYSQL_DATABASE = 'vertex_control',
  MYSQL_SSL = '',
} = process.env

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: parseInt(MYSQL_PORT, 10),
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      ssl: MYSQL_SSL === '1' ? { rejectUnauthorized: true } : undefined,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      timezone: '+00:00',
      // Return bigint columns as number (MySQL returns BigInt for AUTO_INCREMENT ids)
      bigNumberStrings: false,
      supportBigNumbers: true,
    })
    logger.info(`MySQL pool created → ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`)
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// ── Typed query helpers ──────────────────────────────────────────────────────

/** Returns the first row, or undefined if no rows match. */
export async function dbGetOne<T = Record<string, any>>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  const [rows] = await getPool().execute(sql, params)
  return (rows as T[])[0]
}

/** Returns all matching rows. */
export async function dbGetAll<T = Record<string, any>>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params)
  return rows as T[]
}

/** Executes an INSERT / UPDATE / DELETE and returns the result header. */
export async function dbRun(
  sql: string,
  params: any[] = []
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await getPool().execute(sql, params)
  const header = result as mysql.ResultSetHeader
  return { insertId: header.insertId, affectedRows: header.affectedRows }
}

/** Runs multiple statements in a single transaction. Rolls back on error. */
export async function dbTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await getPool().getConnection()
  await conn.beginTransaction()
  try {
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
