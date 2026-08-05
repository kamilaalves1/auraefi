-- Vertex Control Center — Complete MySQL Schema
-- Consolidated from all SQLite migrations; target: Aurora MySQL 3.x (MySQL 8.0 compatible)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── Migration tracking ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(191) NOT NULL,
  applied_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Workspaces & Tenants ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(191) NOT NULL,
  display_name TEXT NOT NULL,
  linux_user VARCHAR(191) NOT NULL,
  plan_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  gateway_home TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  gateway_port INT,
  dashboard_port INT,
  config TEXT NOT NULL DEFAULT ('{}'),
  created_by TEXT NOT NULL DEFAULT ('system'),
  owner_gateway TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug),
  UNIQUE KEY uq_tenants_linux_user (linux_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspaces (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(191) NOT NULL,
  name TEXT NOT NULL,
  tenant_id INT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspaces_slug (slug),
  KEY idx_workspaces_tenant_id (tenant_id),
  CONSTRAINT fk_workspaces_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Users & Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  username VARCHAR(191) NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'operator',
  provider VARCHAR(50) NOT NULL DEFAULT 'local',
  provider_user_id TEXT,
  email TEXT,
  avatar_url TEXT,
  is_approved INT NOT NULL DEFAULT 1,
  approved_by TEXT,
  approved_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  last_login_at INT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_workspace_id (workspace_id),
  KEY idx_users_provider (provider),
  KEY idx_users_email (email(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT,
  token VARCHAR(191) NOT NULL,
  user_id INT NOT NULL,
  expires_at INT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  ip_address TEXT,
  user_agent TEXT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sessions_token (token),
  KEY idx_user_sessions_user_id (user_id),
  KEY idx_user_sessions_expires_at (expires_at),
  KEY idx_user_sessions_workspace_id (workspace_id),
  KEY idx_user_sessions_tenant_id (tenant_id),
  KEY idx_user_sessions_workspace_tenant (workspace_id, tenant_id),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_requests (
  id INT NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL DEFAULT 'google',
  email VARCHAR(191) NOT NULL,
  provider_user_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  requested_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  last_attempt_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  attempt_count INT NOT NULL DEFAULT 1,
  reviewed_by TEXT,
  reviewed_at INT,
  review_note TEXT,
  approved_user_id INT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_requests_email_provider (email, provider),
  KEY idx_access_requests_status (status),
  CONSTRAINT fk_access_requests_user FOREIGN KEY (approved_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  key_prefix VARCHAR(50) NOT NULL,
  key_hash VARCHAR(191) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  scopes TEXT,
  expires_at INT,
  last_used_at INT,
  last_used_ip TEXT,
  is_revoked INT NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_key_hash (key_hash),
  KEY idx_api_keys_user_id (user_id),
  KEY idx_api_keys_workspace_id (workspace_id),
  KEY idx_api_keys_prefix (key_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name VARCHAR(191) NOT NULL,
  role TEXT NOT NULL,
  session_key VARCHAR(191),
  soul_content MEDIUMTEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'offline',
  last_seen INT,
  last_activity TEXT,
  config MEDIUMTEXT,
  source VARCHAR(50) DEFAULT 'manual',
  content_hash TEXT,
  workspace_path TEXT,
  hidden INT NOT NULL DEFAULT 0,
  working_memory MEDIUMTEXT,
  model TEXT,
  instructions MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agents_name (name),
  UNIQUE KEY uq_agents_session_key (session_key),
  KEY idx_agents_workspace_id (workspace_id),
  KEY idx_agents_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id INT NOT NULL AUTO_INCREMENT,
  agent_id INT NOT NULL,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INT,
  revoked_at INT,
  last_used_at INT,
  created_by TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_api_keys_ws_hash (workspace_id, key_hash(191)),
  KEY idx_agent_api_keys_agent_id (agent_id),
  KEY idx_agent_api_keys_workspace_id (workspace_id),
  KEY idx_agent_api_keys_expires_at (expires_at),
  KEY idx_agent_api_keys_revoked_at (revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_trust_scores (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_name VARCHAR(191) NOT NULL,
  trust_score DOUBLE NOT NULL DEFAULT 1.0,
  auth_failures INT NOT NULL DEFAULT 0,
  injection_attempts INT NOT NULL DEFAULT 0,
  rate_limit_hits INT NOT NULL DEFAULT 0,
  secret_exposures INT NOT NULL DEFAULT 0,
  successful_tasks INT NOT NULL DEFAULT 0,
  failed_tasks INT NOT NULL DEFAULT 0,
  last_anomaly_at INT,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_trust_agent_ws (agent_name, workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  slug VARCHAR(191) NOT NULL,
  description TEXT,
  ticket_prefix VARCHAR(50) NOT NULL,
  ticket_counter INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  github_repo TEXT,
  deadline INT,
  color TEXT,
  metadata MEDIUMTEXT,
  github_sync_enabled INT NOT NULL DEFAULT 0,
  github_labels_initialized INT NOT NULL DEFAULT 0,
  github_default_branch TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_ws_slug (workspace_id, slug),
  UNIQUE KEY uq_projects_ws_prefix (workspace_id, ticket_prefix),
  KEY idx_projects_workspace_status (workspace_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_agent_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NOT NULL,
  agent_name VARCHAR(191) NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  assigned_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_paa_project_agent (project_id, agent_name),
  KEY idx_paa_project (project_id),
  KEY idx_paa_agent (agent_name),
  CONSTRAINT fk_paa_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  project_id INT,
  project_ticket_no INT,
  title TEXT NOT NULL,
  description MEDIUMTEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'inbox',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  assigned_to TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  outcome TEXT,
  error_message TEXT,
  resolution TEXT,
  feedback_rating INT,
  feedback_notes TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  dispatch_attempts INT NOT NULL DEFAULT 0,
  completed_at INT,
  due_date INT,
  estimated_hours INT,
  actual_hours INT,
  tags MEDIUMTEXT,
  metadata MEDIUMTEXT,
  github_issue_number INT,
  github_repo TEXT,
  github_synced_at INT,
  github_branch TEXT,
  github_pr_number INT,
  github_pr_state TEXT,
  git_provider TEXT,
  git_issue_number INT,
  git_repo TEXT,
  git_synced_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_tasks_workspace_id (workspace_id),
  KEY idx_tasks_workspace_project (workspace_id, project_id),
  KEY idx_tasks_outcome (outcome),
  KEY idx_tasks_completed_at (completed_at),
  KEY idx_tasks_workspace_outcome (workspace_id, outcome, completed_at),
  KEY idx_tasks_stale_inprogress (status, updated_at),
  KEY idx_tasks_workspace_id2 (workspace_id),
  KEY idx_tasks_github_issue (workspace_id, github_repo(191), github_issue_number),
  KEY idx_tasks_git_issue (workspace_id, git_provider(50), git_repo(191), git_issue_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  task_id INT NOT NULL,
  author TEXT NOT NULL,
  content MEDIUMTEXT NOT NULL,
  parent_id INT,
  mentions MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_comments_workspace_id (workspace_id),
  KEY idx_comments_task_id (task_id),
  CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_subscriptions (
  id INT NOT NULL AUTO_INCREMENT,
  task_id INT NOT NULL,
  agent_name VARCHAR(191) NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_subscriptions (task_id, agent_name),
  CONSTRAINT fk_task_subscriptions_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quality_reviews (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  task_id INT NOT NULL,
  reviewer TEXT NOT NULL,
  status TEXT NOT NULL,
  notes MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_quality_reviews_task_id (task_id),
  KEY idx_quality_reviews_reviewer (reviewer(191)),
  KEY idx_quality_reviews_workspace_id (workspace_id),
  CONSTRAINT fk_quality_reviews_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Activities & Notifications ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INT NOT NULL,
  actor TEXT NOT NULL,
  description TEXT NOT NULL,
  data MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_activities_workspace_id (workspace_id),
  KEY idx_activities_actor (actor(191)),
  KEY idx_activities_entity (entity_type(50), entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  recipient TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_type TEXT,
  source_id INT,
  read_at INT,
  delivered_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_notifications_workspace_id (workspace_id),
  KEY idx_notifications_read_at (read_at),
  KEY idx_notifications_recipient_read (recipient(191), read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS standup_reports (
  date VARCHAR(20) NOT NULL,
  workspace_id INT NOT NULL DEFAULT 1,
  report MEDIUMTEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (date),
  KEY idx_standup_reports_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  conversation_id VARCHAR(191) NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT,
  content MEDIUMTEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  metadata MEDIUMTEXT,
  read_at INT,
  created_at INT DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_messages_workspace_id (workspace_id),
  KEY idx_messages_conversation (conversation_id, created_at),
  KEY idx_messages_agents (from_agent(191), to_agent(191)),
  KEY idx_messages_read_at (read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Audit & Settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id INT NOT NULL AUTO_INCREMENT,
  action VARCHAR(100) NOT NULL,
  actor TEXT NOT NULL,
  actor_id INT,
  target_type TEXT,
  target_id INT,
  detail MEDIUMTEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_audit_log_action (action),
  KEY idx_audit_log_actor (actor(191)),
  KEY idx_audit_log_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(191) NOT NULL,
  value MEDIUMTEXT NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  updated_by TEXT,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (`key`),
  KEY idx_settings_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Webhooks ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL,
  enabled INT NOT NULL DEFAULT 1,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_fired_at INT,
  last_status INT,
  created_by TEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_webhooks_workspace_id (workspace_id),
  KEY idx_webhooks_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  webhook_id INT NOT NULL,
  event_type TEXT NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  status_code INT,
  response_body MEDIUMTEXT,
  error TEXT,
  duration_ms INT,
  attempt INT NOT NULL DEFAULT 0,
  next_retry_at INT,
  is_retry INT NOT NULL DEFAULT 0,
  parent_delivery_id INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_webhook_deliveries_webhook_id (webhook_id),
  KEY idx_webhook_deliveries_created_at (created_at),
  KEY idx_webhook_deliveries_workspace_id (workspace_id),
  KEY idx_webhook_deliveries_retry (next_retry_at),
  CONSTRAINT fk_webhook_deliveries_webhook FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Workflow / Pipeline ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_templates (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  model TEXT NOT NULL DEFAULT 'sonnet',
  task_prompt MEDIUMTEXT NOT NULL,
  timeout_seconds INT NOT NULL DEFAULT 300,
  agent_role TEXT,
  tags TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  last_used_at INT,
  use_count INT NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_workflow_templates_name (name(191)),
  KEY idx_workflow_templates_created_by (created_by(191)),
  KEY idx_workflow_templates_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_pipelines (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  steps MEDIUMTEXT NOT NULL,
  client_metadata_json MEDIUMTEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  last_used_at INT,
  use_count INT NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_workflow_pipelines_name (name(191)),
  KEY idx_workflow_pipelines_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  pipeline_id INT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  current_step INT NOT NULL DEFAULT 0,
  steps_snapshot MEDIUMTEXT NOT NULL,
  started_at INT,
  completed_at INT,
  triggered_by TEXT NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_pipeline_runs_pipeline_id (pipeline_id),
  KEY idx_pipeline_runs_status (status),
  KEY idx_pipeline_runs_workspace_id (workspace_id),
  CONSTRAINT fk_pipeline_runs_pipeline FOREIGN KEY (pipeline_id) REFERENCES workflow_pipelines(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Alert Rules ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  enabled INT NOT NULL DEFAULT 1,
  entity_type TEXT NOT NULL,
  condition_field TEXT NOT NULL,
  condition_operator TEXT NOT NULL,
  condition_value TEXT NOT NULL,
  action_type TEXT NOT NULL DEFAULT 'notification',
  action_config MEDIUMTEXT NOT NULL,
  cooldown_minutes INT NOT NULL DEFAULT 60,
  last_triggered_at INT,
  trigger_count INT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_alert_rules_workspace_id (workspace_id),
  KEY idx_alert_rules_enabled (enabled),
  KEY idx_alert_rules_entity_type (entity_type(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Provisioning ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provision_jobs (
  id INT NOT NULL AUTO_INCREMENT,
  tenant_id INT NOT NULL,
  job_type VARCHAR(50) NOT NULL DEFAULT 'bootstrap',
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  dry_run INT NOT NULL DEFAULT 1,
  requested_by TEXT NOT NULL DEFAULT 'system',
  approved_by TEXT,
  runner_host TEXT,
  idempotency_key TEXT,
  request_json MEDIUMTEXT NOT NULL,
  plan_json MEDIUMTEXT NOT NULL,
  result_json MEDIUMTEXT,
  error_text MEDIUMTEXT,
  started_at INT,
  completed_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_provision_jobs_tenant_id (tenant_id),
  KEY idx_provision_jobs_status (status),
  KEY idx_provision_jobs_created_at (created_at),
  CONSTRAINT fk_provision_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provision_events (
  id INT NOT NULL AUTO_INCREMENT,
  job_id INT NOT NULL,
  level VARCHAR(10) NOT NULL DEFAULT 'info',
  step_key TEXT,
  message TEXT NOT NULL,
  data MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_provision_events_job_id (job_id),
  KEY idx_provision_events_created_at (created_at),
  CONSTRAINT fk_provision_events_job FOREIGN KEY (job_id) REFERENCES provision_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Direct Connections ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS direct_connections (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_id INT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT,
  connection_id VARCHAR(191) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'connected',
  last_heartbeat INT,
  metadata MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_direct_connections_cid (connection_id),
  KEY idx_direct_connections_agent_id (agent_id),
  KEY idx_direct_connections_connection_id (connection_id),
  KEY idx_direct_connections_status (status),
  KEY idx_direct_connections_workspace_id (workspace_id),
  CONSTRAINT fk_direct_connections_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Git & GitHub Sync ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS github_syncs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  repo TEXT NOT NULL,
  last_synced_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  issue_count INT NOT NULL DEFAULT 0,
  sync_direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  project_id INT,
  changes_pushed INT NOT NULL DEFAULT 0,
  changes_pulled INT NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_github_syncs_repo (repo(191)),
  KEY idx_github_syncs_created_at (created_at),
  KEY idx_github_syncs_workspace_id (workspace_id),
  KEY idx_github_syncs_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS git_repositories (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  name TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  is_active INT NOT NULL DEFAULT 1,
  access_token TEXT,
  base_url TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_git_repositories_workspace (workspace_id),
  CONSTRAINT fk_git_repositories_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS git_syncs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  flow_id INT,
  provider VARCHAR(50) NOT NULL DEFAULT 'github',
  repo TEXT NOT NULL,
  last_synced_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  changes_pulled INT NOT NULL DEFAULT 0,
  changes_pushed INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_git_syncs_workspace (workspace_id),
  KEY idx_git_syncs_flow (flow_id),
  KEY idx_git_syncs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Token Usage ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS token_usage (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  model TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_name TEXT,
  task_id INT,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd DOUBLE,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_token_usage_session_id (session_id(191)),
  KEY idx_token_usage_created_at (created_at),
  KEY idx_token_usage_model (model(100)),
  KEY idx_token_usage_workspace_id (workspace_id),
  KEY idx_token_usage_task_id (task_id),
  KEY idx_token_usage_workspace_task_time (workspace_id, task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Claude Sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS claude_sessions (
  id INT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(191) NOT NULL,
  project_slug TEXT NOT NULL,
  project_path TEXT,
  model TEXT,
  git_branch TEXT,
  user_messages INT NOT NULL DEFAULT 0,
  assistant_messages INT NOT NULL DEFAULT 0,
  tool_uses INT NOT NULL DEFAULT 0,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  estimated_cost DOUBLE NOT NULL DEFAULT 0,
  first_message_at TEXT,
  last_message_at TEXT,
  last_user_prompt MEDIUMTEXT,
  is_active INT NOT NULL DEFAULT 0,
  scanned_at INT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_claude_sessions_session_id (session_id),
  KEY idx_claude_sessions_active (is_active),
  KEY idx_claude_sessions_project (project_slug(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Adapter Configs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adapter_configs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  framework TEXT NOT NULL,
  config MEDIUMTEXT,
  enabled INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_adapter_configs_ws_fw (workspace_id, framework(100)),
  CONSTRAINT fk_adapter_configs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Skills ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id INT NOT NULL AUTO_INCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  content_hash TEXT,
  registry_slug TEXT,
  registry_version TEXT,
  security_status TEXT DEFAULT 'unchecked',
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skills_source_name (source(100), name(191)),
  KEY idx_skills_name (name(191)),
  KEY idx_skills_source (source(100)),
  KEY idx_skills_registry_slug (registry_slug(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Security Events ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  source TEXT,
  agent_name TEXT,
  detail MEDIUMTEXT,
  ip_address TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_security_events_event_type (event_type(100)),
  KEY idx_security_events_severity (severity(20)),
  KEY idx_security_events_created_at (created_at),
  KEY idx_security_events_agent_name (agent_name(191)),
  KEY idx_security_events_workspace_id (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mcp_call_log (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_name TEXT,
  mcp_server TEXT,
  tool_name TEXT,
  success INT NOT NULL DEFAULT 1,
  duration_ms INT,
  error TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_mcp_call_log_agent_name (agent_name(191)),
  KEY idx_mcp_call_log_created_at (created_at),
  KEY idx_mcp_call_log_tool_name (tool_name(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Evals ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_runs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_name TEXT NOT NULL,
  eval_layer TEXT NOT NULL,
  score DOUBLE,
  passed INT,
  detail MEDIUMTEXT,
  golden_dataset_id INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_eval_runs_agent_name (agent_name(191)),
  KEY idx_eval_runs_eval_layer (eval_layer(100)),
  KEY idx_eval_runs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eval_golden_sets (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  name VARCHAR(191) NOT NULL,
  description TEXT,
  entries MEDIUMTEXT NOT NULL,
  created_by TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_eval_golden_sets_name_ws (name, workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eval_traces (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_name TEXT NOT NULL,
  task_id INT,
  trace MEDIUMTEXT NOT NULL,
  convergence_score DOUBLE,
  total_steps INT,
  optimal_steps INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_eval_traces_agent_name (agent_name(191)),
  KEY idx_eval_traces_task_id (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Spawn History & Runs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spawn_history (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL DEFAULT 1,
  agent_id INT,
  agent_name TEXT NOT NULL,
  spawn_type TEXT NOT NULL DEFAULT 'claude-code',
  session_id TEXT,
  trigger_text TEXT,
  status TEXT NOT NULL DEFAULT 'started',
  exit_code INT,
  error TEXT,
  duration_ms INT,
  finished_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_spawn_history_agent (agent_name(191)),
  KEY idx_spawn_history_created (created_at),
  KEY idx_spawn_history_status (status(50)),
  CONSTRAINT fk_spawn_history_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(191) NOT NULL,
  workspace_id INT DEFAULT 1,
  agent_id TEXT NOT NULL,
  agent_name TEXT,
  model TEXT,
  provider TEXT,
  runtime TEXT DEFAULT 'mission-control',
  runtime_version TEXT,
  trigger_type TEXT,
  parent_run_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  outcome TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INT,
  steps MEDIUMTEXT,
  tools_available MEDIUMTEXT,
  cost_input_tokens INT DEFAULT 0,
  cost_output_tokens INT DEFAULT 0,
  cost_cache_read_tokens INT,
  cost_cache_write_tokens INT,
  cost_usd DOUBLE,
  cost_model TEXT,
  run_hash TEXT,
  parent_run_hash TEXT,
  lineage MEDIUMTEXT,
  model_version TEXT,
  config_hash TEXT,
  provenance_runtime TEXT,
  signed_by TEXT,
  signature TEXT,
  provenance_created_at TEXT,
  eval_task_type TEXT,
  eval_layer TEXT,
  eval_pass INT,
  eval_score DOUBLE,
  eval_detail MEDIUMTEXT,
  eval_metrics MEDIUMTEXT,
  eval_benchmark_id TEXT,
  error TEXT,
  git_branch TEXT,
  git_commit TEXT,
  tags MEDIUMTEXT,
  metadata MEDIUMTEXT,
  spawn_history_id INT,
  created_at INT DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_runs_agent_id (agent_id(191)),
  KEY idx_runs_status (status(50)),
  KEY idx_runs_created_at (created_at),
  KEY idx_runs_workspace (workspace_id),
  KEY idx_runs_run_hash (run_hash(191)),
  KEY idx_runs_task_id (task_id(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Gateway Health ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gateway_health_logs (
  id INT NOT NULL AUTO_INCREMENT,
  gateway_id INT NOT NULL,
  status TEXT NOT NULL,
  latency INT,
  probed_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  error TEXT,
  PRIMARY KEY (id),
  KEY idx_gateway_health_logs_gateway_id (gateway_id),
  KEY idx_gateway_health_logs_probed_at (probed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Work Pipelines (Kanban Flow) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_clients_workspace (workspace_id),
  CONSTRAINT fk_clients_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_pipelines (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  client_id INT,
  name TEXT NOT NULL DEFAULT 'Esteira',
  provider TEXT NOT NULL DEFAULT 'none',
  enabled INT NOT NULL DEFAULT 0,
  config_json MEDIUMTEXT NOT NULL,
  secret_blob MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_work_pipelines_workspace (workspace_id),
  KEY idx_work_pipelines_client (client_id),
  CONSTRAINT fk_work_pipelines_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_work_pipelines_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipeline_columns (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  pipeline_id INT NOT NULL,
  column_name TEXT NOT NULL,
  column_order INT NOT NULL DEFAULT 0,
  is_trigger INT NOT NULL DEFAULT 0,
  agent_id INT,
  skill_id INT,
  instructions MEDIUMTEXT,
  assignments_json MEDIUMTEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_pipeline_columns_pipeline (pipeline_id),
  CONSTRAINT fk_pipeline_columns_pipeline FOREIGN KEY (pipeline_id) REFERENCES work_pipelines(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipeline_columns_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_pipeline_columns_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  CONSTRAINT fk_pipeline_columns_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipeline_card_runs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  provider TEXT NOT NULL,
  card_key TEXT NOT NULL,
  card_title TEXT NOT NULL,
  card_description MEDIUMTEXT,
  card_url TEXT,
  current_stage_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  task_id INT,
  last_comment_ts INT DEFAULT 0,
  cost_usd DOUBLE NOT NULL DEFAULT 0,
  run_count INT NOT NULL DEFAULT 1,
  llm_models TEXT NOT NULL,
  pr_check_json MEDIUMTEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pcr_ws_provider_card (workspace_id, provider(50), card_key(191)),
  KEY idx_pcr_workspace (workspace_id, status(50)),
  KEY idx_pcr_card (provider(50), card_key(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipeline_card_messages (
  id INT NOT NULL AUTO_INCREMENT,
  run_id INT NOT NULL,
  direction TEXT NOT NULL,
  stage_id TEXT,
  body MEDIUMTEXT NOT NULL,
  external_comment_id TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_pcm_run (run_id, created_at),
  CONSTRAINT fk_pcm_run FOREIGN KEY (run_id) REFERENCES pipeline_card_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_pipeline_configs (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'none',
  enabled INT NOT NULL DEFAULT 0,
  config_json MEDIUMTEXT NOT NULL,
  secret_blob MEDIUMTEXT,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_work_pipeline_configs_ws (workspace_id),
  KEY idx_work_pipeline_workspace (workspace_id),
  CONSTRAINT fk_work_pipeline_configs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Delivery Flows ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_delivery_flows (
  workspace_id INT NOT NULL,
  definition_json MEDIUMTEXT NOT NULL,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by TEXT,
  PRIMARY KEY (workspace_id),
  KEY idx_workspace_delivery_flows_updated (updated_at),
  CONSTRAINT fk_wdf_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delivery_flows (
  id INT NOT NULL AUTO_INCREMENT,
  workspace_id INT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Fluxo principal',
  git_provider TEXT,
  git_repo_url TEXT,
  git_branch TEXT NOT NULL DEFAULT 'main',
  is_active INT NOT NULL DEFAULT 1,
  definition_json MEDIUMTEXT NOT NULL,
  git_repository_id INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by TEXT,
  PRIMARY KEY (id),
  KEY idx_delivery_flows_workspace (workspace_id),
  CONSTRAINT fk_delivery_flows_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_flows_git_repo FOREIGN KEY (git_repository_id) REFERENCES git_repositories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_parameters (
  workspace_id INT NOT NULL,
  values_json MEDIUMTEXT NOT NULL,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by TEXT,
  PRIMARY KEY (workspace_id),
  KEY idx_workspace_parameters_updated (updated_at),
  CONSTRAINT fk_workspace_parameters FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_squad_state (
  workspace_id INT NOT NULL,
  squad_active INT NOT NULL DEFAULT 0,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by TEXT,
  PRIMARY KEY (workspace_id),
  KEY idx_workspace_squad_state_updated (updated_at),
  CONSTRAINT fk_workspace_squad_state FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Memory FTS (replaces SQLite FTS5) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_fts (
  id INT NOT NULL AUTO_INCREMENT,
  path TEXT NOT NULL,
  title TEXT,
  content MEDIUMTEXT,
  PRIMARY KEY (id),
  FULLTEXT KEY ft_memory (path(255), title(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS memory_fts_meta (
  `key` VARCHAR(191) NOT NULL,
  value TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
