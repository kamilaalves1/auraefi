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
    id: '003_persona_and_workflow_templates',
    up: async (conn) => {
      // Agent persona fields
      if (!(await hasColumn(conn, 'agents', 'persona_name'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN persona_name VARCHAR(100) DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'agents', 'specialty'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN specialty VARCHAR(50) DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'agents', 'capabilities_json'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN capabilities_json TEXT DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'agents', 'authority_level'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN authority_level TEXT DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'agents', 'constraints_json'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN constraints_json TEXT DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'agents', 'collaboration_agents_json'))) {
        await conn.execute(`ALTER TABLE agents ADD COLUMN collaboration_agents_json TEXT DEFAULT NULL`)
      }

      // Pipeline column enhancements
      if (!(await hasColumn(conn, 'pipeline_columns', 'timeout_seconds'))) {
        await conn.execute(`ALTER TABLE pipeline_columns ADD COLUMN timeout_seconds INT DEFAULT NULL`)
      }
      if (!(await hasColumn(conn, 'pipeline_columns', 'human_checkpoint'))) {
        await conn.execute(`ALTER TABLE pipeline_columns ADD COLUMN human_checkpoint TINYINT(1) DEFAULT 0`)
      }
      if (!(await hasColumn(conn, 'pipeline_columns', 'on_failure'))) {
        await conn.execute(`ALTER TABLE pipeline_columns ADD COLUMN on_failure VARCHAR(50) DEFAULT 'stop'`)
      }

      // Pipeline column templates table
      if (!(await hasTable(conn, 'pipeline_column_templates'))) {
        await conn.execute(`
          CREATE TABLE pipeline_column_templates (
            id INT NOT NULL AUTO_INCREMENT,
            workspace_id INT NOT NULL DEFAULT 0,
            name VARCHAR(191) NOT NULL,
            description TEXT,
            category VARCHAR(100) DEFAULT NULL,
            is_builtin TINYINT(1) DEFAULT 0,
            phases_json MEDIUMTEXT NOT NULL,
            created_by VARCHAR(191) DEFAULT 'system',
            use_count INT DEFAULT 0,
            created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
            updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
            PRIMARY KEY (id),
            INDEX idx_workspace (workspace_id),
            INDEX idx_builtin (is_builtin)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `)

        // Seed built-in templates
        const builtins = [
          {
            name: 'Ciclo de Desenvolvimento',
            description: 'Fluxo completo: desenvolvimento, revisão de código e aprovação humana antes de finalizar.',
            category: 'development',
            phases: [
              { column_name: 'Backlog', column_order: 0, is_trigger: true,  agent_role: null,       instructions: 'Cards de entrada. O agente não processa automaticamente — aguarda triagem manual.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Desenvolvimento', column_order: 1, is_trigger: false, agent_role: 'developer',   instructions: 'Implemente a funcionalidade descrita no card. Siga as convenções do repositório e escreva testes unitários.', timeout_seconds: 7200, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Code Review', column_order: 2, is_trigger: false, agent_role: 'reviewer',    instructions: 'Revise o código implementado. Verifique qualidade, segurança, cobertura de testes e aderência aos padrões.', timeout_seconds: 3600, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Aprovação', column_order: 3, is_trigger: false, agent_role: null,       instructions: 'Ponto de checagem humana. O pipeline pausa aqui aguardando aprovação explícita.', timeout_seconds: null, human_checkpoint: true,  on_failure: 'stop' },
              { column_name: 'Concluído', column_order: 4, is_trigger: false, agent_role: null,       instructions: 'Card finalizado e aprovado.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
            ]
          },
          {
            name: 'Code Review Rápido',
            description: 'Revisão automática de código seguida de aprovação humana. Ideal para PRs.',
            category: 'review',
            phases: [
              { column_name: 'Enviado', column_order: 0, is_trigger: true,  agent_role: null,       instructions: 'PR ou tarefa enviada para revisão.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Revisão Automática', column_order: 1, is_trigger: false, agent_role: 'reviewer', instructions: 'Faça uma revisão detalhada do código. Liste issues por severidade (crítico/médio/baixo). Sugira melhorias concretas.', timeout_seconds: 1800, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Aprovado', column_order: 2, is_trigger: false, agent_role: null,       instructions: 'Revisão concluída e aprovada.', timeout_seconds: null, human_checkpoint: true,  on_failure: 'stop' },
            ]
          },
          {
            name: 'QA Loop',
            description: 'Ciclo de qualidade com testes automáticos, correção e reteste.',
            category: 'qa',
            phases: [
              { column_name: 'Novo', column_order: 0, is_trigger: true,  agent_role: null,    instructions: 'Feature ou bug report aguardando ciclo de QA.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Teste', column_order: 1, is_trigger: false, agent_role: 'qa',   instructions: 'Execute os cenários de teste. Documente resultados, bugs encontrados e cobertura alcançada.', timeout_seconds: 3600, human_checkpoint: false, on_failure: 'continue' },
              { column_name: 'Correção', column_order: 2, is_trigger: false, agent_role: 'developer', instructions: 'Corrija os bugs identificados na fase de teste. Mantenha o escopo mínimo necessário.', timeout_seconds: 3600, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Reteste', column_order: 3, is_trigger: false, agent_role: 'qa',   instructions: 'Valide as correções. Confirme que os bugs foram resolvidos e não há regressões.', timeout_seconds: 1800, human_checkpoint: true,  on_failure: 'stop' },
              { column_name: 'Aprovado', column_order: 4, is_trigger: false, agent_role: null,  instructions: 'QA concluído. Feature aprovada para release.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
            ]
          },
          {
            name: 'Deploy Pipeline',
            description: 'Processo de deploy com staging, aprovação e produção.',
            category: 'devops',
            phases: [
              { column_name: 'Build', column_order: 0, is_trigger: true,  agent_role: null,      instructions: 'Artefato pronto para deploy.', timeout_seconds: null, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Staging', column_order: 1, is_trigger: false, agent_role: 'devops', instructions: 'Faça o deploy em staging. Execute smoke tests básicos. Verifique logs e métricas.', timeout_seconds: 1800, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Aprovação para Produção', column_order: 2, is_trigger: false, agent_role: null,  instructions: 'Ponto de aprovação humana para liberação em produção.', timeout_seconds: null, human_checkpoint: true,  on_failure: 'stop' },
              { column_name: 'Produção', column_order: 3, is_trigger: false, agent_role: 'devops', instructions: 'Deploy em produção. Monitore por 10 minutos após o deploy. Registre a versão deployada.', timeout_seconds: 1200, human_checkpoint: false, on_failure: 'stop' },
            ]
          },
          {
            name: 'Full SDLC',
            description: 'Ciclo completo de desenvolvimento: análise, arquitetura, implementação, QA e deploy.',
            category: 'full',
            phases: [
              { column_name: 'Análise', column_order: 0, is_trigger: true,  agent_role: 'analyst',   instructions: 'Analise o requisito. Esclareça dúvidas, identifique impactos e estime complexidade.', timeout_seconds: 3600, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Arquitetura', column_order: 1, is_trigger: false, agent_role: 'architect',  instructions: 'Proponha a solução técnica. Documente decisões de arquitetura (ADR). Identifique riscos.', timeout_seconds: 7200, human_checkpoint: true,  on_failure: 'stop' },
              { column_name: 'Desenvolvimento', column_order: 2, is_trigger: false, agent_role: 'developer', instructions: 'Implemente seguindo a arquitetura aprovada. Escreva testes. Documente APIs.', timeout_seconds: 14400, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Code Review', column_order: 3, is_trigger: false, agent_role: 'reviewer',   instructions: 'Revise código, testes e documentação. Verifique aderência à arquitetura aprovada.', timeout_seconds: 3600, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'QA', column_order: 4, is_trigger: false, agent_role: 'qa',        instructions: 'Execute testes funcionais, de integração e de regressão. Valide critérios de aceite.', timeout_seconds: 7200, human_checkpoint: false, on_failure: 'stop' },
              { column_name: 'Aprovação Final', column_order: 5, is_trigger: false, agent_role: null,       instructions: 'Checagem final antes do deploy. Aprovação do PO ou Tech Lead.', timeout_seconds: null, human_checkpoint: true,  on_failure: 'stop' },
              { column_name: 'Deploy', column_order: 6, is_trigger: false, agent_role: 'devops',    instructions: 'Execute o deploy conforme o plano. Monitore métricas pós-deploy.', timeout_seconds: 1800, human_checkpoint: false, on_failure: 'stop' },
            ]
          },
        ]

        const now = Math.floor(Date.now() / 1000)
        for (const t of builtins) {
          await conn.execute(
            `INSERT INTO pipeline_column_templates (workspace_id, name, description, category, is_builtin, phases_json, created_by, created_at, updated_at)
             VALUES (0, ?, ?, ?, 1, ?, 'system', ?, ?)`,
            [t.name, t.description, t.category, JSON.stringify(t.phases), now, now]
          )
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
