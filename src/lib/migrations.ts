import { readFileSync } from 'fs'
import { join } from 'path'
import type mysql from 'mysql2/promise'
import { logger } from './logger'

export type Migration = {
  id: string
  up: (conn: mysql.PoolConnection) => Promise<void>
}

const extraMigrations: Migration[] = []
export function registerMigrations(newMigrations: Migration[]): void {
  extraMigrations.push(...newMigrations)
}

// MySQL-compatible helpers
async function hasTable(conn: mysql.PoolConnection, table: string): Promise<boolean> {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return (rows as any[]).length > 0
}

async function hasColumn(conn: mysql.PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  )
  return (rows as any[]).length > 0
}

const migrations: Migration[] = [
  {
    id: '001_mysql_init',
    up: async (conn) => {
      const schemaPath = join(process.cwd(), 'src', 'lib', 'schema-mysql.sql')
      const schema = readFileSync(schemaPath, 'utf8')

      // Split on semicolons but filter empty statements and SET commands that need special handling
      const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'))

      for (const stmt of statements) {
        if (!stmt.trim()) continue
        try {
          await conn.query(stmt)
        } catch (err: any) {
          // Ignore "already exists" errors for idempotency
          if (err?.code !== 'ER_TABLE_EXISTS_ERROR' && err?.code !== 'ER_DUP_KEYNAME') {
            logger.error({ err, stmt: stmt.slice(0, 200) }, 'Migration 001 statement failed')
            throw err
          }
        }
      }
    }
  },
  {
    id: '002_ensure_default_workspace',
    up: async (conn) => {
      // Ensure a default tenant exists
      const [tenants] = await conn.execute(`SELECT id FROM tenants ORDER BY id ASC LIMIT 1`)
      let tenantId: number

      if ((tenants as any[]).length === 0) {
        const [result] = await conn.execute(
          `INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, gateway_home, workspace_root, config, created_by, owner_gateway)
           VALUES (?, 'Local Owner', 'local', 'standard', 'active', '/tmp/.agents', '/tmp/workspace', '{}', 'system', 'primary')`,
          ['default']
        )
        tenantId = (result as any).insertId
      } else {
        tenantId = (tenants as any[])[0].id
      }

      // Ensure a default workspace exists
      const [workspaces] = await conn.execute(`SELECT id FROM workspaces WHERE id = 1`)
      if ((workspaces as any[]).length === 0) {
        await conn.execute(
          `INSERT INTO workspaces (id, slug, name, tenant_id) VALUES (1, 'default', 'Default Workspace', ?)
           ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id)`,
          [tenantId]
        )
      }
    }
  },
]

export async function runMigrations(conn: mysql.PoolConnection): Promise<void> {
  // Create migrations tracking table
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(191) NOT NULL,
      applied_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  const [appliedRows] = await conn.execute(`SELECT id FROM schema_migrations`)
  const applied = new Set((appliedRows as Array<{ id: string }>).map(r => r.id))

  for (const migration of [...migrations, ...extraMigrations]) {
    if (applied.has(migration.id)) continue

    logger.info(`Applying migration: ${migration.id}`)
    await conn.beginTransaction()
    try {
      await migration.up(conn)
      await conn.execute(`INSERT IGNORE INTO schema_migrations (id) VALUES (?)`, [migration.id])
      await conn.commit()
      logger.info(`Migration applied: ${migration.id}`)
    } catch (err) {
      await conn.rollback()
      logger.error({ err }, `Migration failed: ${migration.id}`)
      throw err
    }
  }
}
