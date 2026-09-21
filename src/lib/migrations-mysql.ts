import { readFileSync } from 'fs'
import { join } from 'path'
import { getPool } from './db-pool'
import { logger } from './logger'

export async function runMigrationsMysql(): Promise<void> {
  const pool = getPool()

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) NOT NULL PRIMARY KEY,
      applied_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
    )
  `)

  const [rows] = await pool.query('SELECT id FROM schema_migrations') as any
  const applied = new Set((rows as any[]).map((r: any) => r.id))

  if (!applied.has('001_init_mysql')) {
    const schemaPath = join(process.cwd(), 'src', 'lib', 'schema-mysql.sql')
    const schema = readFileSync(schemaPath, 'utf8')
    // Os comentarios precisam sair ANTES da divisao por ';'. Dividindo
    // primeiro, todo statement precedido por uma linha de comentario comeca
    // com '--' e era descartado inteiro pelo filtro: 4 de 163, entre eles o
    // CREATE TABLE de `tasks` e o INSERT da workspace padrao. Sem a tabela
    // `tasks`, o CREATE INDEX seguinte falhava com ER_NO_SUCH_TABLE (1146),
    // a migracao 001 nunca era registrada e o boot quebrava sempre.
    const statements = schema
      .split('\n')
      .filter((linha) => !linha.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const stmt of statements) {
      try {
        await pool.query(stmt)
      } catch (err: any) {
        if (
          err.code !== 'ER_TABLE_EXISTS_ERROR' &&
          err.code !== 'ER_DUP_KEYNAME' &&
          err.code !== 'ER_DUP_ENTRY' &&
          err.code !== 'ER_DUP_FIELDNAME' &&
          err.code !== 'ER_BLOB_KEY_WITHOUT_LENGTH' &&
          !err.message?.includes('already exists') &&
          !err.message?.includes('Duplicate column name') &&
          !err.message?.includes('used in key specification without a key length')
        ) {
          logger.error({ err, stmt: stmt.slice(0, 120) }, 'MySQL migration statement failed')
          throw err
        }
      }
    }

    await pool.query("INSERT IGNORE INTO schema_migrations (id) VALUES ('001_init_mysql')")
    logger.info('MySQL schema initialized successfully')
  }

  if (!applied.has('002_workspace_brand_isolation')) {
    const alters = [
      "ALTER TABLE workspaces ADD COLUMN brand VARCHAR(255) NULL",
      "ALTER TABLE workspaces ADD COLUMN isolation VARCHAR(50) NOT NULL DEFAULT 'shared'",
    ]
    for (const stmt of alters) {
      try {
        await pool.query(stmt)
      } catch (err: any) {
        if (
          err.code !== 'ER_DUP_FIELDNAME' &&
          !err.message?.includes('Duplicate column name')
        ) {
          logger.error({ err, stmt }, 'Migration 002 statement failed')
          throw err
        }
      }
    }
    await pool.query("INSERT IGNORE INTO schema_migrations (id) VALUES ('002_workspace_brand_isolation')")
    logger.info('Migration 002 applied: workspace brand/isolation columns')
  }

  if (!applied.has('003_audit_log_workspace_id')) {
    try {
      await pool.query("ALTER TABLE audit_log ADD COLUMN workspace_id INT NOT NULL DEFAULT 1")
    } catch (err: any) {
      if (err.code !== 'ER_DUP_FIELDNAME' && !err.message?.includes('Duplicate column name')) {
        logger.error({ err }, 'Migration 003 failed')
        throw err
      }
    }
    await pool.query("INSERT IGNORE INTO schema_migrations (id) VALUES ('003_audit_log_workspace_id')")
    logger.info('Migration 003 applied: audit_log workspace_id column')
  }

  if (!applied.has('005_pipeline_new_columns')) {
    const alters = [
      // pipeline_columns: campo de aprovação humana por etapa
      "ALTER TABLE pipeline_columns ADD COLUMN requires_human_approval TINYINT(1) NOT NULL DEFAULT 0",
      // pipeline_card_runs: campos adicionados para CI polling, review de PR, contexto e rollback
      "ALTER TABLE pipeline_card_runs ADD COLUMN pr_review_json TEXT",
      "ALTER TABLE pipeline_card_runs ADD COLUMN context_summary_json TEXT",
      "ALTER TABLE pipeline_card_runs ADD COLUMN stage_snapshots_json TEXT",
      // pipeline_quality_metrics: nova tabela para rastreabilidade de gates
      `CREATE TABLE IF NOT EXISTS pipeline_quality_metrics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        workspace_id INT NOT NULL,
        run_id INT NOT NULL,
        card_key VARCHAR(500) NOT NULL,
        metric_type VARCHAR(100) NOT NULL,
        value_text TEXT,
        value_num DOUBLE,
        stage_name VARCHAR(255),
        agent_name VARCHAR(255),
        created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
      )`,
    ]
    for (const stmt of alters) {
      try {
        await pool.query(stmt)
      } catch (err: any) {
        if (
          err.code !== 'ER_DUP_FIELDNAME' &&
          err.code !== 'ER_TABLE_EXISTS_ERROR' &&
          !err.message?.includes('Duplicate column name') &&
          !err.message?.includes('already exists')
        ) {
          logger.error({ err, stmt: stmt.slice(0, 120) }, 'Migration 005 statement failed')
          throw err
        }
      }
    }
    await pool.query("INSERT IGNORE INTO schema_migrations (id) VALUES ('005_pipeline_new_columns')")
    logger.info('Migration 005 applied: pipeline requires_human_approval, pr_review_json, context_summary_json, stage_snapshots_json, pipeline_quality_metrics')
  }

  if (!applied.has('006_pipeline_columns_jira_status')) {
    try {
      await pool.query(
        "ALTER TABLE pipeline_columns ADD COLUMN jira_status VARCHAR(255) NULL"
      )
    } catch (err: any) {
      if (err.code !== 'ER_DUP_FIELDNAME' && !err.message?.includes('Duplicate column name')) {
        logger.error({ err }, 'Migration 006 failed')
        throw err
      }
    }
    await pool.query("INSERT IGNORE INTO schema_migrations (id) VALUES ('006_pipeline_columns_jira_status')")
    logger.info('Migration 006 applied: pipeline_columns.jira_status — nome da transição Jira configurável por coluna')
  }
}
