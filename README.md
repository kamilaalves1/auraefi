<div align="center">

# Vertex Control Center

**AI Operations Dashboard — powered by Amy**

Monitor, command, approve, and observe your AI operations platform from a single beautiful interface.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs](https://img.shields.io/badge/PRs-53%20merged-blueviolet)]()
[![Phase](https://img.shields.io/badge/Phase-140-purple)]()
[![Panels](https://img.shields.io/badge/Panels-56-green)]()

</div>

---

## What is this?

Vertex Control Center is the client-facing operations dashboard for **Silver Snow Vertex** — an AI-powered business operations platform. It gives operators and clients real-time visibility into Amy, the AI operations assistant.

### Dashboard Architecture

The dashboard uses a **Progressive Disclosure** design (D087):

- **System Pulse Bar** — one-line at-a-glance health: services, uptime, disk, memory, CPU, alerts
- **12 Hero Panels** — always visible, mission-critical views
- **6 Collapsible Zone Drawers** — click to explore deeper, default collapsed

### Hero Section (always visible)

| # | Panel | Description |
|---|-------|-------------|
| 💚 | **System Pulse** | One-line status: services, uptime, disk%, memory%, CPU, alerts |
| ⏱️ | **Uptime Clock** | Live ticking HH:MM:SS with pulsing green monospace |
| 🔀 | **Gateway Control** | System health, bridge status, total events |
| 💓 | **Ops Heartbeat** | ECG-animated real-time pulse with mood indicator |
| 📰 | **Daily Digest** | Auto-generated executive briefing with natural language |
| 🗺️ | **3D Topology** | Interactive Reagraph WebGL force-directed graph |
| 🏛️ | **Council Insights** | Multi-model AI advisor voting patterns |
| 🧠 | **Intelligence** | Component health scores + knowledge search |
| 📋 | **Ops Report** | One-click downloadable operational summary |
| 🔔 | **Alert Rules** | 6 threshold-based monitors (error rate, silence, volume) |
| 🖥️ | **Service Status** | Real-time health grid for 8 Amy services |
| ⚡ | **Quick Actions** | 5 interactive operational commands |
| 📜 | **Event Timeline** | Chronological live feed from all services |
| 📊 | **Resource Monitor** | CPU, memory, disk gauges with progress bars |

### Zone Drawers (collapsed by default)

| Zone | Panels | What's Inside |
|------|--------|---------------|
| 🔧 Operations | 7 | Scheduler, Task Board, Approval Gate, Notifications, Cron Timeline, Activity Feed, Quick Actions |
| 📊 Analytics | 6 | Session Analytics, Performance Metrics, Activity Heatmap, Scoreboard, Git Pulse, Mission Status |
| 🛡️ Safety | 5 | Safety Rails, Audit Trail, Neural Routes, Council Chamber, Error Tracker |
| 📚 Knowledge | 4 | Knowledge Manager, Vault Search, Config Viewer, Decision Log |
| 📋 Logs | 4 | Log Viewer, Telegram Monitor, Capability Matrix, Keyboard Shortcuts |
| 🏗️ Infrastructure | 8 | Environment Inspector, Storage Monitor, Model Registry, Dependency Map, Network Pulse, Uptime Monitor, ClawBytes Recipes, Ops Heartbeat |

---

## Architecture

```
Vertex Control Center (:3000)         Amy API Bridge (:3100)            Ollama (:11434)
┌───────────────────────────┐    ┌────────────────────────────┐    ┌──────────────┐
│  System Pulse Bar         │    │  51 API endpoints          │    │  llama3.1    │
│  ├── 12 Hero Panels       │    │  ├── 44 GET endpoints      │    │  8b local    │
│  │   ├── Uptime Clock     │    │  ├── 7 POST endpoints      │    └──────┬───────┘
│  │   ├── Gateway Control  │───▶│  │                          │           │
│  │   ├── Ops Heartbeat    │    │  GET /api/status             │    ┌──────▼───────┐
│  │   ├── Daily Digest     │    │  GET /api/heartbeat          │    │  Sovereign   │
│  │   ├── 3D Topology      │    │  GET /api/resources          │    │    Vault     │
│  │   ├── Council Insights │    │  GET /api/event-timeline     │    │  1.7M+ words │
│  │   └── 8 more...        │    │  GET /api/service-status     │    └──────────────┘
│  └── 6 Zone Drawers       │    │  POST /api/quick-action      │
│      ├── Operations (7)   │    │  + 45 more endpoints...      │
│      ├── Analytics (6)    │    └────────────────────────────┘
│      ├── Safety (5)       │
│      ├── Knowledge (4)    │
│      ├── Logs (4)         │
│      └── Infrastructure (8)│
└───────────────────────────┘
```

## Quick Start

### For developers

```bash
git clone https://github.com/X51DRAGON/vertex-control-center.git
cd vertex-control-center
npm install
npm run dev          # → http://localhost:3000
```

### Prerequisites

- **Amy API Bridge** running on `:3100` (provides all data)
- **Ollama** running on `:11434` (for AI chat + neural sync)
- **Node.js 18+** with npm

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (Turbopack) |
| UI | React 19, Tailwind CSS |
| Language | TypeScript 5.7 |
| Database | SQLite (better-sqlite3, WAL mode) |
| State | Zustand |
| AI | Ollama (local LLM) |
| 3D Graphs | Reagraph (WebGL) |
| Flow Diagrams | React Flow |
| Bridge | Python REST API (:3100) — 51 endpoints, 3,762 LOC |
| Streaming | Server-Sent Events (SSE) |

## Bridge Endpoints (51)

### GET Endpoints (44)

| # | Path | Purpose |
|---|------|---------|
| 1 | `/api/health` | System health score + services |
| 2 | `/api/status` | Full system status |
| 3 | `/api/activity` | Recent activity events |
| 4 | `/api/tasks` | Task queue |
| 5 | `/api/approvals` | Pending approval proposals |
| 6 | `/api/notifications` | Notification history |
| 7 | `/api/neurals/status` | Neural sync status |
| 8 | `/api/vault/search` | Search sovereign vault |
| 9 | `/api/knowledge/browse` | List vault domains |
| 10 | `/api/scheduler` | Automation routines |
| 11 | `/api/email/status` | Email lane health |
| 12 | `/api/intelligence` | Intelligence report |
| 13 | `/api/council` | Council cases + votes |
| 14 | `/api/logs` | System log tail |
| 15 | `/api/capabilities` | Capability registry |
| 16 | `/api/decisions` | Architecture decisions |
| 17 | `/api/analytics` | Session metrics |
| 18 | `/api/audit` | Governance audit trail |
| 19 | `/api/telegram` | Telegram bot status |
| 20 | `/api/environment` | Environment overview |
| 21 | `/api/heatmap` | 90-day activity data |
| 22 | `/api/storage` | Disk usage |
| 23 | `/api/models` | Ollama model registry |
| 24 | `/api/cron` | Cron timeline |
| 25 | `/api/errors` | Error tracking |
| 26 | `/api/git` | Git stats |
| 27 | `/api/uptime` | Uptime + bridge clock |
| 28 | `/api/performance` | API throughput |
| 29 | `/api/config` | Platform config |
| 30 | `/api/dependencies` | Module dep graph |
| 31 | `/api/network` | Port scan + latency |
| 32 | `/api/safety-rails` | Safety guardrails |
| 33 | `/api/clawbytes` | ClawBytes recipes |
| 34 | `/api/heartbeat` | Ops heartbeat |
| 35 | `/api/scoreboard` | Performance metrics |
| 36 | `/api/mission-status` | Readiness scores |
| 37 | `/api/daily-digest` | Daily executive brief |
| 38 | `/api/activity-heatmap` | 30-day intensity grid |
| 39 | `/api/council-insights` | Council analytics |
| 40 | `/api/ops-report` | Ops report generator |
| 41 | `/api/alert-rules` | Threshold alerts |
| 42 | `/api/service-status` | Service health grid |
| 43 | `/api/event-timeline` | Chronological feed |
| 44 | `/api/config-viewer` | Config JSON viewer |
| 45 | `/api/resources` | CPU/memory/disk |

### POST Endpoints (7)

| # | Path | Purpose |
|---|------|---------|
| 46 | `/api/tasks` | Submit new task |
| 47 | `/api/approvals/:id/approve` | Approve proposal |
| 48 | `/api/approvals/:id/reject` | Reject proposal |
| 49 | `/api/neurals/approve` | Approve neural sync |
| 50 | `/api/neurals/reject` | Reject neural sync |
| 51 | `/api/knowledge/ingest` | Ingest knowledge |
| 52 | `/api/quick-action` | Trigger operations |

---

## Stats

| Metric | Count |
|--------|-------|
| Dashboard panels | 56 |
| Bridge endpoints | 51 |
| Component files | 55 |
| Dashboard LOC | 10,567 |
| Bridge LOC | 3,762 |
| Architecture decisions | D001–D092 |
| Current phase | 140 |
| VCC PRs merged | 53 |

## Fork Info

Forked from [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) (MIT, 2K ⭐).

SSV customizations:
- Purple theme (h:270) with SSV design tokens
- Amy AI integration (chat, streaming, RAG)
- Progressive Disclosure: Hero + Zone architecture
- 56 custom dashboard panels
- System Pulse status bar
- 51 bridge API endpoints
- Public status page
- Client deployment system

---

<div align="center">

**Silver Snow Vertex** — AI Operations, Sovereign & Local-first

[vertex.silversnowstudios.com](https://vertex.silversnowstudios.com)

</div>
