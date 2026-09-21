-- Vertex Control Center — MySQL Schema (Aurora MySQL 8.0 compatible)
-- Full consolidated schema — all tables in their final state

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'inbox',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  project_id INT,
  project_ticket_no INT,
  assigned_to VARCHAR(255),
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  due_date INT,
  estimated_hours INT,
  actual_hours INT,
  tags TEXT,
  metadata TEXT,
  outcome VARCHAR(50),
  error_message TEXT,
  resolution TEXT,
  feedback_rating INT,
  feedback_notes TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  completed_at INT,
  dispatch_attempts INT NOT NULL DEFAULT 0,
  github_issue_number INT,
  github_repo VARCHAR(500),
  github_synced_at INT,
  github_branch VARCHAR(255),
  github_pr_number INT,
  github_pr_state VARCHAR(50),
  git_provider VARCHAR(50),
  git_issue_number INT,
  git_repo VARCHAR(500),
  git_synced_at INT,
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role TEXT NOT NULL,
  session_key VARCHAR(255),
  soul_content TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'offline',
  last_seen INT,
  last_activity TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  config TEXT,
  workspace_id INT NOT NULL DEFAULT 1,
  source VARCHAR(50) DEFAULT 'manual',
  content_hash VARCHAR(255),
  workspace_path TEXT,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  working_memory TEXT,
  model VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-6',
  instructions TEXT,
  UNIQUE KEY uq_agents_name_workspace (name, workspace_id),
  UNIQUE KEY uq_agents_session_key (session_key)
);

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  author VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  parent_id INT,
  mentions TEXT,
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id INT NOT NULL,
  actor VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  data TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_type VARCHAR(100),
  source_id INT,
  read_at INT,
  delivered_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_task_subscriptions (task_id, agent_name)
);

CREATE TABLE IF NOT EXISTS standup_reports (
  date VARCHAR(10) NOT NULL PRIMARY KEY,
  report TEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quality_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  reviewer VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gateway_health_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gateway_id INT NOT NULL,
  status VARCHAR(50) NOT NULL,
  latency INT,
  probed_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  error TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(255) NOT NULL,
  from_agent VARCHAR(255) NOT NULL,
  to_agent VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  metadata TEXT,
  read_at INT,
  created_at INT DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  linux_user VARCHAR(100) NOT NULL,
  plan_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  gateway_home TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  gateway_port INT,
  dashboard_port INT,
  config TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  owner_gateway VARCHAR(255),
  UNIQUE KEY uq_tenants_slug (slug),
  UNIQUE KEY uq_tenants_linux_user (linux_user)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  tenant_id INT NOT NULL DEFAULT 1,
  brand VARCHAR(255) NULL,
  isolation VARCHAR(50) NOT NULL DEFAULT 'shared',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_workspaces_slug (slug)
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'operator',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  last_login_at INT,
  provider VARCHAR(50) NOT NULL DEFAULT 'local',
  provider_user_id VARCHAR(255),
  email VARCHAR(255),
  avatar_url TEXT,
  is_approved TINYINT(1) NOT NULL DEFAULT 1,
  approved_by VARCHAR(255),
  approved_at INT,
  workspace_id INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_users_username (username)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(255) NOT NULL,
  user_id INT NOT NULL,
  expires_at INT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  ip_address VARCHAR(255),
  user_agent TEXT,
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT,
  UNIQUE KEY uq_user_sessions_token (token)
);

CREATE TABLE IF NOT EXISTS workflow_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  model VARCHAR(100) NOT NULL DEFAULT 'sonnet',
  task_prompt TEXT NOT NULL,
  timeout_seconds INT NOT NULL DEFAULT 300,
  agent_role TEXT,
  tags TEXT,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  last_used_at INT,
  use_count INT NOT NULL DEFAULT 0,
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  actor_id INT,
  target_type VARCHAR(100),
  target_id INT,
  detail TEXT,
  ip_address VARCHAR(255),
  user_agent TEXT,
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_fired_at INT,
  last_status INT,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1,
  consecutive_failures INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  webhook_id INT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload TEXT NOT NULL,
  status_code INT,
  response_body TEXT,
  error TEXT,
  duration_ms INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1,
  attempt INT NOT NULL DEFAULT 0,
  next_retry_at INT,
  is_retry TINYINT(1) NOT NULL DEFAULT 0,
  parent_delivery_id INT
);

CREATE TABLE IF NOT EXISTS workflow_pipelines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  steps TEXT NOT NULL,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  use_count INT NOT NULL DEFAULT 0,
  last_used_at INT,
  workspace_id INT NOT NULL DEFAULT 1,
  client_metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pipeline_id INT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  current_step INT NOT NULL DEFAULT 0,
  steps_snapshot TEXT NOT NULL,
  started_at INT,
  completed_at INT,
  triggered_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(255) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  updated_by VARCHAR(255),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  entity_type VARCHAR(100) NOT NULL,
  condition_field VARCHAR(255) NOT NULL,
  condition_operator VARCHAR(50) NOT NULL,
  condition_value TEXT NOT NULL,
  action_type VARCHAR(100) NOT NULL DEFAULT 'notification',
  action_config TEXT NOT NULL,
  cooldown_minutes INT NOT NULL DEFAULT 60,
  last_triggered_at INT,
  trigger_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NOT NULL DEFAULT 'system',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS provision_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  job_type VARCHAR(50) NOT NULL DEFAULT 'bootstrap',
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  requested_by VARCHAR(255) NOT NULL DEFAULT 'system',
  approved_by VARCHAR(255),
  runner_host VARCHAR(255),
  idempotency_key VARCHAR(255),
  request_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  result_json TEXT,
  error_text TEXT,
  started_at INT,
  completed_at INT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS provision_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'info',
  step_key VARCHAR(255),
  message TEXT NOT NULL,
  data TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS access_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'google',
  email VARCHAR(255) NOT NULL,
  provider_user_id VARCHAR(255),
  display_name VARCHAR(255),
  avatar_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  requested_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  last_attempt_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  attempt_count INT NOT NULL DEFAULT 1,
  reviewed_by VARCHAR(255),
  reviewed_at INT,
  review_note TEXT,
  approved_user_id INT,
  UNIQUE KEY uq_access_requests_email_provider (email, provider)
);

CREATE TABLE IF NOT EXISTS direct_connections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  tool_version VARCHAR(100),
  connection_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'connected',
  last_heartbeat INT,
  metadata TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_direct_connections_id (connection_id)
);

CREATE TABLE IF NOT EXISTS github_syncs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  repo VARCHAR(500) NOT NULL,
  last_synced_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  issue_count INT NOT NULL DEFAULT 0,
  sync_direction VARCHAR(50) NOT NULL DEFAULT 'inbound',
  status VARCHAR(50) NOT NULL DEFAULT 'success',
  error TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1,
  project_id INT,
  changes_pushed INT NOT NULL DEFAULT 0,
  changes_pulled INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS token_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model VARCHAR(100) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  workspace_id INT NOT NULL DEFAULT 1,
  task_id INT,
  cost_usd DOUBLE,
  agent_name VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS claude_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  project_slug VARCHAR(255) NOT NULL,
  project_path TEXT,
  model VARCHAR(100),
  git_branch VARCHAR(255),
  user_messages INT NOT NULL DEFAULT 0,
  assistant_messages INT NOT NULL DEFAULT 0,
  tool_uses INT NOT NULL DEFAULT 0,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  estimated_cost DOUBLE NOT NULL DEFAULT 0,
  first_message_at VARCHAR(100),
  last_message_at VARCHAR(100),
  last_user_prompt TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  scanned_at INT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_claude_sessions_session_id (session_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  ticket_prefix VARCHAR(20) NOT NULL,
  ticket_counter INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  github_repo VARCHAR(500),
  deadline INT,
  color VARCHAR(50),
  metadata TEXT,
  github_sync_enabled TINYINT(1) NOT NULL DEFAULT 0,
  github_labels_initialized TINYINT(1) NOT NULL DEFAULT 0,
  github_default_branch VARCHAR(100) DEFAULT 'main',
  UNIQUE KEY uq_projects_workspace_slug (workspace_id, slug),
  UNIQUE KEY uq_projects_workspace_prefix (workspace_id, ticket_prefix)
);

CREATE TABLE IF NOT EXISTS project_agent_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  assigned_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_paa (project_id, agent_name)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(50) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  scopes TEXT,
  expires_at INT,
  last_used_at INT,
  last_used_ip VARCHAR(255),
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT NOT NULL DEFAULT 1,
  is_revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_api_keys_hash (key_hash)
);

CREATE TABLE IF NOT EXISTS security_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL DEFAULT 'info',
  source VARCHAR(100),
  agent_name VARCHAR(255),
  detail TEXT,
  ip_address VARCHAR(255),
  workspace_id INT NOT NULL DEFAULT 1,
  tenant_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS agent_trust_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_name VARCHAR(255) NOT NULL,
  trust_score DOUBLE NOT NULL DEFAULT 1.0,
  auth_failures INT NOT NULL DEFAULT 0,
  injection_attempts INT NOT NULL DEFAULT 0,
  rate_limit_hits INT NOT NULL DEFAULT 0,
  secret_exposures INT NOT NULL DEFAULT 0,
  successful_tasks INT NOT NULL DEFAULT 0,
  failed_tasks INT NOT NULL DEFAULT 0,
  last_anomaly_at INT,
  workspace_id INT NOT NULL DEFAULT 1,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_agent_trust (agent_name, workspace_id)
);

CREATE TABLE IF NOT EXISTS mcp_call_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_name VARCHAR(255),
  mcp_server VARCHAR(255),
  tool_name VARCHAR(255),
  success TINYINT(1) NOT NULL DEFAULT 1,
  duration_ms INT,
  error TEXT,
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_name VARCHAR(255) NOT NULL,
  eval_layer VARCHAR(100) NOT NULL,
  score DOUBLE,
  passed TINYINT(1),
  detail TEXT,
  golden_dataset_id INT,
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS eval_golden_sets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entries TEXT NOT NULL,
  created_by VARCHAR(255),
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_eval_golden (name, workspace_id)
);

CREATE TABLE IF NOT EXISTS eval_traces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_name VARCHAR(255) NOT NULL,
  task_id INT,
  trace TEXT NOT NULL,
  convergence_score DOUBLE,
  total_steps INT,
  optimal_steps INT,
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS agent_api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  workspace_id INT NOT NULL DEFAULT 1,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(50) NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INT,
  revoked_at INT,
  last_used_at INT,
  created_by VARCHAR(255),
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_agent_api_keys (workspace_id, key_hash)
);

CREATE TABLE IF NOT EXISTS spawn_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT,
  agent_name VARCHAR(255) NOT NULL,
  spawn_type VARCHAR(100) NOT NULL DEFAULT 'claude-code',
  session_id VARCHAR(255),
  `trigger` TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'started',
  exit_code INT,
  error TEXT,
  duration_ms INT,
  workspace_id INT NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  finished_at INT
);

CREATE TABLE IF NOT EXISTS runs (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(255) NOT NULL,
  agent_name VARCHAR(255),
  model VARCHAR(100),
  provider VARCHAR(50),
  runtime VARCHAR(50) DEFAULT 'mission-control',
  runtime_version VARCHAR(50),
  trigger_type VARCHAR(100),
  parent_run_id VARCHAR(255),
  task_id VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  outcome VARCHAR(50),
  started_at VARCHAR(100) NOT NULL,
  ended_at VARCHAR(100),
  duration_ms INT,
  steps TEXT,
  tools_available TEXT,
  cost_input_tokens INT DEFAULT 0,
  cost_output_tokens INT DEFAULT 0,
  cost_cache_read_tokens INT,
  cost_cache_write_tokens INT,
  cost_usd DOUBLE,
  cost_model VARCHAR(100),
  run_hash VARCHAR(255),
  parent_run_hash VARCHAR(255),
  lineage TEXT,
  model_version VARCHAR(100),
  config_hash VARCHAR(255),
  provenance_runtime VARCHAR(100),
  signed_by VARCHAR(255),
  signature TEXT,
  provenance_created_at VARCHAR(100),
  eval_task_type VARCHAR(100),
  eval_layer VARCHAR(100),
  eval_pass TINYINT(1),
  eval_score DOUBLE,
  eval_detail TEXT,
  eval_metrics TEXT,
  eval_benchmark_id VARCHAR(255),
  error TEXT,
  git_branch VARCHAR(255),
  git_commit VARCHAR(255),
  workspace_id INT DEFAULT 1,
  tags TEXT,
  metadata TEXT,
  spawn_history_id INT,
  created_at INT DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS adapter_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  framework VARCHAR(100) NOT NULL,
  config TEXT,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_adapter_configs (workspace_id, framework)
);

CREATE TABLE IF NOT EXISTS skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source VARCHAR(255) NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  content_hash VARCHAR(255),
  registry_slug VARCHAR(255),
  registry_version VARCHAR(100),
  security_status VARCHAR(50) DEFAULT 'unchecked',
  installed_at VARCHAR(100) NOT NULL DEFAULT '',
  updated_at VARCHAR(100) NOT NULL DEFAULT '',
  UNIQUE KEY uq_skills (source, name)
);

CREATE TABLE IF NOT EXISTS work_pipeline_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  provider VARCHAR(100) NOT NULL DEFAULT 'none',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  secret_blob TEXT,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE KEY uq_work_pipeline_configs (workspace_id)
);

CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS work_pipelines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  client_id INT,
  name VARCHAR(255) NOT NULL DEFAULT 'Esteira',
  provider VARCHAR(100) NOT NULL DEFAULT 'none',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  secret_blob TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS pipeline_columns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pipeline_id INT NOT NULL,
  workspace_id INT NOT NULL,
  column_name VARCHAR(255) NOT NULL,
  column_order INT NOT NULL DEFAULT 0,
  is_trigger TINYINT(1) NOT NULL DEFAULT 0,
  agent_id INT,
  skill_id INT,
  instructions TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  assignments_json TEXT NOT NULL,
  requires_human_approval TINYINT(1) NOT NULL DEFAULT 0,
  jira_status VARCHAR(255) NULL COMMENT 'Nome da transição no Jira. Se preenchido, usa este nome ao mover o card. Se vazio, usa o column_name.'
);

CREATE TABLE IF NOT EXISTS workspace_delivery_flows (
  workspace_id INT NOT NULL PRIMARY KEY,
  definition_json TEXT NOT NULL,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS git_repositories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL,
  branch VARCHAR(255) NOT NULL DEFAULT 'main',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  access_token TEXT,
  base_url TEXT
);

CREATE TABLE IF NOT EXISTS delivery_flows (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'Fluxo principal',
  git_provider VARCHAR(50),
  git_repo_url TEXT,
  git_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by VARCHAR(255),
  git_repository_id INT
);

CREATE TABLE IF NOT EXISTS git_syncs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flow_id INT,
  workspace_id INT NOT NULL DEFAULT 1,
  provider VARCHAR(50) NOT NULL DEFAULT 'github',
  repo VARCHAR(500) NOT NULL,
  last_synced_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  changes_pulled INT NOT NULL DEFAULT 0,
  changes_pushed INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'success',
  error TEXT,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS workspace_parameters (
  workspace_id INT NOT NULL PRIMARY KEY,
  values_json TEXT NOT NULL,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS workspace_squad_state (
  workspace_id INT NOT NULL PRIMARY KEY,
  squad_active TINYINT(1) NOT NULL DEFAULT 0,
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS pipeline_card_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  provider VARCHAR(100) NOT NULL,
  card_key VARCHAR(500) NOT NULL,
  card_title VARCHAR(500) NOT NULL DEFAULT '',
  card_description TEXT,
  card_url VARCHAR(2000) DEFAULT '',
  current_stage_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  task_id INT,
  last_comment_ts INT DEFAULT 0,
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  cost_usd DOUBLE NOT NULL DEFAULT 0,
  run_count INT NOT NULL DEFAULT 1,
  llm_models VARCHAR(500) NOT NULL DEFAULT '',
  pr_check_json TEXT,
  pr_review_json TEXT,
  context_summary_json TEXT,
  stage_snapshots_json TEXT,
  UNIQUE KEY uq_pipeline_card_runs (workspace_id, provider, card_key)
);

CREATE TABLE IF NOT EXISTS pipeline_quality_metrics (
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
);

CREATE TABLE IF NOT EXISTS pipeline_card_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  direction VARCHAR(50) NOT NULL,
  stage_id VARCHAR(255),
  body TEXT NOT NULL,
  external_comment_id VARCHAR(255),
  created_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

CREATE TABLE IF NOT EXISTS memory_fts_meta (
  `key` VARCHAR(255) NOT NULL PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at INT NOT NULL DEFAULT (UNIX_TIMESTAMP())
);

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_tasks_workspace_id ON tasks(workspace_id);
CREATE INDEX idx_tasks_workspace_project ON tasks(workspace_id, project_id);
CREATE INDEX idx_tasks_outcome ON tasks(outcome);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_workspace_id ON agents(workspace_id);
CREATE INDEX idx_agents_source ON agents(source);
CREATE INDEX idx_comments_task_id ON comments(task_id);
CREATE INDEX idx_comments_workspace_id ON comments(workspace_id);
CREATE INDEX idx_activities_created_at ON activities(created_at);
CREATE INDEX idx_activities_type ON activities(type);
CREATE INDEX idx_activities_workspace_id ON activities(workspace_id);
CREATE INDEX idx_activities_actor ON activities(actor);
CREATE INDEX idx_notifications_recipient ON notifications(recipient);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_workspace_id ON notifications(workspace_id);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);
CREATE INDEX idx_gateway_health_logs_gateway_id ON gateway_health_logs(gateway_id);
CREATE INDEX idx_gateway_health_logs_probed_at ON gateway_health_logs(probed_at);
CREATE INDEX idx_messages_workspace_id ON messages(workspace_id);
CREATE INDEX idx_messages_read_at ON messages(read_at);
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_workspaces_tenant_id ON workspaces(tenant_id);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_workspace_id ON users(workspace_id);
CREATE INDEX idx_users_provider ON users(provider);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_user_sessions_token ON user_sessions(token);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_workspace_id ON user_sessions(workspace_id);
CREATE INDEX idx_user_sessions_tenant_id ON user_sessions(tenant_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_webhooks_enabled ON webhooks(enabled);
CREATE INDEX idx_webhooks_workspace_id ON webhooks(workspace_id);
CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
CREATE INDEX idx_webhook_deliveries_workspace_id ON webhook_deliveries(workspace_id);
CREATE INDEX idx_settings_category ON settings(category);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX idx_alert_rules_entity_type ON alert_rules(entity_type);
CREATE INDEX idx_alert_rules_workspace_id ON alert_rules(workspace_id);
CREATE INDEX idx_provision_jobs_tenant_id ON provision_jobs(tenant_id);
CREATE INDEX idx_provision_jobs_status ON provision_jobs(status);
CREATE INDEX idx_provision_events_job_id ON provision_events(job_id);
CREATE INDEX idx_access_requests_status ON access_requests(status);
CREATE INDEX idx_direct_connections_agent_id ON direct_connections(agent_id);
CREATE INDEX idx_direct_connections_status ON direct_connections(status);
CREATE INDEX idx_direct_connections_workspace_id ON direct_connections(workspace_id);
CREATE INDEX idx_github_syncs_repo ON github_syncs(repo);
CREATE INDEX idx_github_syncs_workspace_id ON github_syncs(workspace_id);
CREATE INDEX idx_token_usage_session_id ON token_usage(session_id);
CREATE INDEX idx_token_usage_created_at ON token_usage(created_at);
CREATE INDEX idx_token_usage_model ON token_usage(model);
CREATE INDEX idx_token_usage_workspace_id ON token_usage(workspace_id);
CREATE INDEX idx_token_usage_task_id ON token_usage(task_id);
CREATE INDEX idx_claude_sessions_project ON claude_sessions(project_slug);
CREATE INDEX idx_projects_workspace_status ON projects(workspace_id, status);
CREATE INDEX idx_paa_project ON project_agent_assignments(project_id);
CREATE INDEX idx_paa_agent ON project_agent_assignments(agent_name);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_workspace_id ON api_keys(workspace_id);
CREATE INDEX idx_security_events_event_type ON security_events(event_type);
CREATE INDEX idx_security_events_severity ON security_events(severity);
CREATE INDEX idx_security_events_created_at ON security_events(created_at);
CREATE INDEX idx_security_events_workspace_id ON security_events(workspace_id);
CREATE INDEX idx_mcp_call_log_agent_name ON mcp_call_log(agent_name);
CREATE INDEX idx_mcp_call_log_created_at ON mcp_call_log(created_at);
CREATE INDEX idx_eval_runs_agent_name ON eval_runs(agent_name);
CREATE INDEX idx_eval_runs_created_at ON eval_runs(created_at);
CREATE INDEX idx_eval_traces_agent_name ON eval_traces(agent_name);
CREATE INDEX idx_eval_traces_task_id ON eval_traces(task_id);
CREATE INDEX idx_agent_api_keys_agent_id ON agent_api_keys(agent_id);
CREATE INDEX idx_agent_api_keys_workspace_id ON agent_api_keys(workspace_id);
CREATE INDEX idx_spawn_history_agent ON spawn_history(agent_name);
CREATE INDEX idx_spawn_history_created ON spawn_history(created_at);
CREATE INDEX idx_spawn_history_status ON spawn_history(status);
CREATE INDEX idx_runs_agent_id ON runs(agent_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created_at ON runs(created_at);
CREATE INDEX idx_runs_workspace ON runs(workspace_id);
CREATE INDEX idx_runs_run_hash ON runs(run_hash);
CREATE INDEX idx_runs_task_id ON runs(task_id);
CREATE INDEX idx_git_repositories_workspace ON git_repositories(workspace_id);
CREATE INDEX idx_delivery_flows_workspace ON delivery_flows(workspace_id);
CREATE INDEX idx_git_syncs_workspace ON git_syncs(workspace_id);
CREATE INDEX idx_git_syncs_flow ON git_syncs(flow_id);
CREATE INDEX idx_git_syncs_created ON git_syncs(created_at);
CREATE INDEX idx_work_pipelines_workspace ON work_pipelines(workspace_id);
CREATE INDEX idx_work_pipelines_client ON work_pipelines(client_id);
CREATE INDEX idx_pipeline_columns_pipeline ON pipeline_columns(pipeline_id);
CREATE INDEX idx_pipeline_card_runs_workspace ON pipeline_card_runs(workspace_id, status);
CREATE INDEX idx_pipeline_card_runs_card ON pipeline_card_runs(provider, card_key);
CREATE INDEX idx_pcm_run ON pipeline_card_messages(run_id, created_at);
CREATE INDEX idx_clients_workspace ON clients(workspace_id);

-- Add columns to workspaces if they don't exist yet (for existing DBs)
ALTER TABLE workspaces ADD COLUMN brand VARCHAR(255) NULL;
ALTER TABLE workspaces ADD COLUMN isolation VARCHAR(50) NOT NULL DEFAULT 'shared';

-- Default workspace (tenant_id seeded separately at runtime)
INSERT IGNORE INTO workspaces (id, slug, name, tenant_id, created_at, updated_at)
VALUES (1, 'default', 'Default Workspace', 1, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
