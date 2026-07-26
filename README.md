<div align="center">

# Vertex Control Center

**AI Agent Orchestration Dashboard**

Deploy, monitor, and orchestrate fleets of AI agents from a single interface.\
Connect your backlog (JIRA or Azure DevOps), define multi-stage pipelines, and let agents handle each stage autonomously — with full cost visibility, real-time events, and audit trails.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-only-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

</div>

---

## Overview

Vertex Control Center is a self-hosted dashboard for teams running AI agent workflows. It ships as a standalone Next.js application with an embedded SQLite database — no external services required.

**Core capabilities:**

- **Pipeline engine** — polls JIRA or Azure DevOps, routes cards through multi-stage pipelines, calls LLMs directly, posts results back, and advances cards automatically
- **Agent fleet management** — register, monitor, configure, and schedule autonomous agents; track heartbeats, memory, and execution history
- **Cost tracking** — per-agent and per-model cost visibility from stored token usage; downloadable monthly or period reports
- **Real-time events** — Server-Sent Events stream delivers agent status changes, pipeline progress, and task updates to all connected clients instantly
- **Multi-workspace** — full tenant isolation; each workspace has its own agents, tasks, pipelines, and cost data
- **Security hardened** — SSRF protection, rate limiting with trusted-proxy chain, nonce-based CSP, HSTS, workspace-scoped SSE, and audit log export

---

## Architecture

```
                        ┌──────────────────────────────────────────┐
                        │          Vertex Control Center           │
                        │            Next.js 16 (App Router)       │
                        │                                          │
  Browser ─── HTTPS ──▶ │  ┌──────────┐   ┌────────────────────┐  │
                        │  │ UI Layer │   │   API Routes       │  │
  Agent CLI ── REST ──▶ │  │ React 19 │   │   ~150 endpoints   │  │
                        │  │ Tailwind │   │   Role-based auth  │  │
  MCP Client ── MCP ──▶ │  │ Zustand  │   │   Rate limiting    │  │
                        │  └────┬─────┘   └────────┬───────────┘  │
                        │       │ SSE              │               │
                        │  ┌────▼─────────────────▼───────────┐   │
                        │  │          Event Bus (in-process)  │   │
                        │  └────────────────┬─────────────────┘   │
                        │                   │                      │
                        │  ┌────────────────▼─────────────────┐   │
                        │  │       SQLite (WAL mode)          │   │
                        │  │  agents · tasks · token_usage    │   │
                        │  │  pipeline_runs · audit_log       │   │
                        │  │  workspaces · webhooks · memory  │   │
                        │  └──────────────────────────────────┘   │
                        │                                          │
                        │  ┌───────────────────────────────────┐  │
                        │  │      Pipeline Engine (scheduler)  │  │
                        │  │  polls JIRA / Azure DevOps        │  │
                        │  │  dispatches LLM calls directly    │  │
                        │  │  posts comments · moves cards     │  │
                        │  └───────────────────────────────────┘  │
                        └──────────────────────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   LLM Gateway        │
                              │   (configurable)     │
                              │   Anthropic · Ollama │
                              └──────────────────────┘
```

---

## Quick Start

**Prerequisites:** Node.js ≥ 22, pnpm (`corepack enable`)

```bash
git clone https://github.com/kamilaalves1/vertex-control-center.git
cd vertex-control-center
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) — default credentials: `admin` / `admin`.

> **First run:** `AUTH_SECRET` and `API_KEY` are auto-generated and stored in `.data/`. Change the default password immediately in **Settings → Users**.

### Production build

```bash
pnpm build
pnpm start
# or standalone:
node .next/standalone/server.js
```

### Docker (zero-config)

```bash
docker compose up
```

Production hardening overlay (read-only filesystem, internal network, HSTS, strict cookies):

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 — App Router | Server components + route handlers |
| UI | React 19, Tailwind CSS 3 | Client panels with `startTransition` navigation |
| Language | TypeScript 5 | Strict mode, zero `any` in core paths |
| Database | SQLite via `better-sqlite3` | WAL mode, 5 s busy timeout, schema migrations |
| State | Zustand | Client-side panel and filter state |
| Real-time | Server-Sent Events (SSE) | In-process event bus; workspace-scoped delivery |
| Auth | JWT sessions + RBAC | Roles: `viewer` · `operator` · `admin` |
| Package manager | pnpm | Strict, reproducible installs |

---

## Features

### Agent Fleet Management

Register agents via the dashboard, the REST API, or the MCP server. Each agent has:

- **Role** — `coder`, `reviewer`, `tester`, `devops`, `researcher`, `assistant`, `agent`
- **Config** — model override, system prompt, gateway config, dispatch model
- **Memory** — key-value store per agent, searchable
- **Heartbeat** — automatic `idle → offline` transition after timeout
- **Diagnostics** — last-run output, error traces, attribution history
- **Keys** — per-agent API key rotation

```bash
# Self-register from an agent process
curl -X POST http://localhost:3000/api/agents/register \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "code-reviewer", "role": "reviewer", "framework": "custom"}'
```

### Pipeline Engine

Connect your project management backlog and define multi-stage pipelines:

1. **Configure provider** — JIRA Cloud/Server or Azure DevOps (Settings → Work Pipeline)
2. **Map columns** — each board column becomes a pipeline stage
3. **Assign agents** — one or more agents per stage, with optional fallback cascade
4. **Engine polls** — cards entering a trigger column are automatically picked up
5. **LLM executes** — the assigned agent reads the card, generates output, posts a comment
6. **Card advances** — engine transitions the card to the next column

**LLM fallback cascade** — if the primary agent fails, the engine can try alternate models or all configured models in order, ensuring no card is silently dropped.

**Bot mention** — users can reply to a card comment with `@pipeline <instruction>` to trigger re-processing with a new context.

```
JIRA column: "In Review"
  └─ Stage: Code Review
       ├─ Primary agent: senior-reviewer (claude-opus-4-8)
       └─ Fallback: any available reviewer agent
```

### Cost Tracking

Every LLM call records input tokens, output tokens, model, and computed cost in USD. The cost tracker panel surfaces:

- **Per-agent cost** — total spend per agent, sorted by cost
- **Per-model breakdown** — cost split by model within each agent
- **Daily trend** — last 5 days of spend (bar chart)
- **Downloadable report** — CSV/Excel export for any date range, accessible from the header toggle

Costs are read from the `cost_usd` column stored at call time — no recalculation at display time means the numbers are always accurate, even for custom or self-hosted models.

### Real-time Events

All clients connect to `/api/events` (SSE). The event bus broadcasts workspace-scoped events:

| Event | Trigger |
|---|---|
| `agent.created` | Agent registered |
| `agent.updated` | Agent config or status change |
| `agent.deleted` | Agent removed |
| `agent.status_changed` | Heartbeat status flip |
| `connection.created` | CLI tool connected |
| `connection.disconnected` | CLI tool disconnected |
| `pipeline.stage_started` | Pipeline stage begins |
| `pipeline.run_completed` | All stages finished |
| `activity.created` | Any activity logged |
| `notification.created` | Notification emitted |
| `chat.message` | Card chat message posted |

### MCP Server

Expose all dashboard capabilities to any MCP-compatible client (Claude Code, etc.):

```bash
claude mcp add vertex-control -- node /path/to/vertex-control-center/scripts/mc-mcp-server.cjs
# Environment:
# MC_URL=http://127.0.0.1:3000
# MC_API_KEY=<your-api-key>
```

Provides ~35 tools: agents, tasks, sessions, memory, soul, comments, tokens, skills, cron, status.

### Webhooks

Outbound webhooks fire on configurable event types. Each delivery is logged with status, response code, and latency. Failed deliveries can be retried manually or via the scheduler.

### Audit Log & Export

Every mutation — login, agent creation, config change, pipeline run — is written to the `audit_log` table, scoped to the workspace of the acting user. Admins can export audit logs, tasks, activities, and pipeline runs as CSV or JSON from `/api/export`.

---

## Security

| Control | Implementation |
|---|---|
| **SSRF protection** | Cloud-metadata hostnames and private CIDRs (RFC 1918, loopback, link-local) are blocked unconditionally before the gateway allowlist — no user config can override |
| **Rate limiting** | Login: 5 req/min · Mutations: 60 req/min · Reads: 120 req/min · Heavy ops: 10 req/min · Agent registration: 5 req/min |
| **IP extraction** | Client IP read from the trusted proxy chain (`MC_TRUSTED_PROXIES`) only; falls back to shared `direct` bucket when no proxies configured, preventing rate-limit bypass via forged headers |
| **CSP** | Nonce-based `script-src` with `'strict-dynamic'`; `'unsafe-eval'` only in development; WebSockets restricted to localhost origins |
| **HSTS** | Enabled when serving over HTTPS or when `MC_ENABLE_HSTS=1`; 2-year max-age with `includeSubDomains; preload` |
| **Permissions-Policy** | Restricts camera, microphone, geolocation, and payment APIs |
| **Workspace isolation** | Every query filters by `workspace_id`; SSE only delivers events matching the subscriber's workspace |
| **RBAC** | Three roles enforced at the route handler level: `viewer` (read-only), `operator` (create/update), `admin` (full) |
| **Audit trail** | All mutations logged with actor, IP, and target; export scoped to workspace by actor subquery |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AUTH_SECRET` | auto-generated | JWT signing secret — rotate to invalidate all sessions |
| `API_KEY` | auto-generated | Master API key for agent/MCP access |
| `AUTH_PASS` | `admin` | Default admin password (change immediately) |
| `MC_TRUSTED_PROXIES` | _(none)_ | Comma-separated IPs of trusted reverse proxies |
| `MC_ENABLE_HSTS` | `0` | Set to `1` to force HSTS even without TLS detection |
| `MC_DISABLE_HSTS` | `0` | Set to `1` to suppress HSTS even when HTTPS detected |
| `MC_COOKIE_SECURE` | `0` | Set to `1` to mark session cookies as Secure |
| `MC_COOKIE_SAMESITE` | `lax` | `lax` or `strict` |
| `MC_ALLOWED_HOSTS` | _(none)_ | Comma-separated allowed Host header values |
| `MISSION_CONTROL_DATA_DIR` | `.data/` | Override the data directory |
| `MISSION_CONTROL_DB_PATH` | `.data/mission-control.db` | Override the database path |
| `MC_DISABLE_RATE_LIMIT` | `0` | Set to `1` to disable non-critical rate limits (testing only) |
| `NEXT_PUBLIC_GATEWAY_OPTIONAL` | `false` | Set to `true` for standalone deployments without a gateway |

---

## API Reference

The full OpenAPI spec is at `openapi.json`. Interactive docs run at `/docs` when the server is up.

### Authentication

All endpoints require authentication. Pass the API key as a Bearer token or as a session cookie after login:

```bash
# Bearer token (agent/programmatic access)
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $MC_API_KEY"

# Session login
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"username":"admin","password":"admin"}'
```

### Core Endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/agents` | viewer | List agents (filter by status, role) |
| `POST` | `/api/agents` | operator | Create agent |
| `GET` | `/api/agents/:id` | viewer | Agent detail + config |
| `PUT` | `/api/agents/:id` | operator | Update agent config |
| `DELETE` | `/api/agents/:id` | admin | Delete agent |
| `POST` | `/api/agents/register` | viewer | Agent self-registration |
| `GET` | `/api/agents/:id/heartbeat` | viewer | Receive heartbeat |
| `GET` | `/api/agents/:id/memory` | viewer | Agent memory |
| `GET` | `/api/tasks` | viewer | List tasks |
| `POST` | `/api/tasks` | operator | Create task |
| `PUT` | `/api/tasks/:id` | operator | Update task |
| `GET` | `/api/tasks/queue` | viewer | Queue view (pending + assigned) |
| `GET` | `/api/tokens` | viewer | Token usage log |
| `GET` | `/api/tokens/by-agent` | viewer | Cost per agent |
| `GET` | `/api/events` | viewer | SSE stream |
| `POST` | `/api/connect` | operator | Register CLI connection |
| `GET` | `/api/work-pipeline` | admin | Pipeline config |
| `PUT` | `/api/work-pipeline` | admin | Save pipeline config |
| `GET` | `/api/work-pipeline/backlog` | operator | Fetch current backlog |
| `GET` | `/api/pipeline/engine/status` | viewer | Engine status + active runs |
| `GET` | `/api/export` | admin | Export data (CSV/JSON) |
| `GET` | `/api/audit` | admin | Audit log |
| `GET` | `/api/webhooks` | admin | Webhook config |
| `GET` | `/api/sessions` | viewer | Agent session list |
| `GET` | `/api/scheduler` | admin | Scheduler status |
| `GET` | `/api/workspaces` | admin | Workspace list |

---

## Development

```bash
pnpm dev          # start dev server (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright end-to-end
pnpm test:all     # lint + typecheck + test + build + e2e
```

### Project Structure

```
src/
├── app/
│   ├── api/          # ~150 route handlers (Next.js App Router)
│   └── [[...panel]]/ # Single catch-all page — client-side panel navigation
├── components/
│   └── panels/       # Dashboard panels (one file per panel)
└── lib/
    ├── db.ts          # Database connection + schema migrations
    ├── auth.ts        # JWT session handling + RBAC
    ├── rate-limit.ts  # Rate limiters (IP + agent identity)
    ├── csp.ts         # Content Security Policy builder
    ├── event-bus.ts   # In-process SSE broadcast bus
    ├── pipeline-engine.ts  # JIRA/Azure pipeline execution engine
    ├── task-dispatch.ts    # LLM task dispatch + model routing
    ├── scheduler.ts        # Cron-like background scheduler
    └── webhooks.ts         # Outbound webhook delivery

.data/             # Runtime data (gitignored)
├── mission-control.db
└── ...

scripts/
├── mc-mcp-server.cjs  # MCP server binary
└── ...
```

### Database

SQLite in WAL mode. Schema is managed via incremental migrations in `src/lib/migrations.ts`. To reset the database during development:

```bash
rm .data/mission-control.db
pnpm dev   # migrations re-run on next start
```

**When switching Node.js versions**, rebuild the native addon:

```bash
pnpm rebuild better-sqlite3
```

---

## Deployment

### Standalone (single binary-like)

```bash
pnpm build
node .next/standalone/server.js
```

The standalone output is self-contained — it does not require `node_modules` at runtime.

### Docker

```bash
# Development / evaluation
docker compose up

# Production (hardened: read-only FS, internal network, HSTS, strict cookies)
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

The container drops all Linux capabilities except `NET_BIND_SERVICE`, runs with a read-only filesystem (tmpfs for `/tmp` and the Next.js cache), and limits memory to 512 MB.

### Reverse Proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name control.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE: disable buffering
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Set `MC_TRUSTED_PROXIES=127.0.0.1` and `MC_ENABLE_HSTS=1` in your environment.

---

## License

MIT — see [LICENSE](LICENSE).

Forked from [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control).
