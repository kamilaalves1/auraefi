<div align="center">

# AURA

**Plataforma de Operações de IA**

Implante, monitore e orquestre frotas de agentes de IA a partir de uma única interface.\
Conecte seu backlog (JIRA ou Azure DevOps), defina pipelines em múltiplos estágios e deixe os agentes executar cada etapa de forma autônoma — com visibilidade completa de custo, eventos em tempo real e trilha de auditoria.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-only-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

</div>

---

## O que é

AURA é um dashboard auto-hospedado para equipes que executam fluxos de trabalho com agentes de IA. Funciona como uma aplicação Next.js standalone com banco de dados MySQL — compatível com qualquer instância MySQL 8+.

**Capacidades principais:**

- **Pipeline engine** — monitora JIRA ou Azure DevOps, roteia cards por pipelines em múltiplos estágios, chama LLMs diretamente, posta resultados e avança os cards automaticamente
- **Gestão de frota de agentes** — registre, monitore, configure e agende agentes autônomos; edite soul content, ative modo compacto por agente e acompanhe heartbeats, memória e histórico de execução
- **Modo econômico** — ative por agente um bloco de instruções que reduz verbosidade de output; o dashboard exibe o comparativo de tokens economizados automaticamente
- **Skill viewer** — visualize e edite arquivos `SKILL.md` referenciados no soul content de cada agente diretamente pelo painel
- **Rastreamento de custo** — visibilidade de custo por agente e por modelo a partir do uso de tokens armazenado; gráfico de impacto do modo econômico no overview
- **Eventos em tempo real** — stream SSE entrega mudanças de status de agente, progresso de pipeline e atualizações de tarefa para todos os clientes conectados instantaneamente
- **Multi-workspace** — isolamento completo por tenant; cada workspace tem seus próprios agentes, tarefas, pipelines e dados de custo
- **Segurança hardened** — proteção SSRF, rate limiting com cadeia de proxies confiáveis, CSP com nonces, HSTS, SSE com escopo por workspace e exportação de audit log com escopo por workspace

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                           AURA                                   │
│                      Next.js 16 (App Router)                    │
│                                                                  │
│  ┌───────────────────┐        ┌──────────────────────────────┐  │
│  │    Camada de UI   │        │       API Routes (~150)      │  │
│  │                   │        │                              │  │
│  │  React 19         │        │  Auth + RBAC (3 roles)       │  │
│  │  Tailwind CSS 3   │◀──SSE──│  Rate limiting por IP/agente │  │
│  │  Zustand          │        │  Validação de entrada        │  │
│  │  Recharts         │        │  Audit log automático        │  │
│  └─────────┬─────────┘        └──────────────┬───────────────┘  │
│            │                                  │                  │
│            └──────────────┬───────────────────┘                  │
│                           │                                      │
│                  ┌────────▼────────┐                             │
│                  │   Event Bus     │ (in-process, workspace-scoped)
│                  └────────┬────────┘                             │
│                           │                                      │
│             ┌─────────────▼──────────────┐                      │
│             │    MySQL 8                 │                      │
│             │                            │                      │
│             │  agents       tasks        │                      │
│             │  token_usage  audit_log    │                      │
│             │  pipeline_runs workspaces  │                      │
│             │  webhooks     memory       │                      │
│             └─────────────┬──────────────┘                      │
│                           │                                      │
│             ┌─────────────▼──────────────┐                      │
│             │    Pipeline Engine         │                      │
│             │   (roda no scheduler)      │                      │
│             │                            │                      │
│             │  Monitora JIRA/Azure       │                      │
│             │  Despacha chamadas LLM     │                      │
│             │  Posta comentários         │                      │
│             │  Avança cards              │                      │
│             └─────────────┬──────────────┘                      │
└───────────────────────────┼─────────────────────────────────────┘
                            │
               ┌────────────▼────────────┐
               │     Gateway LLM         │
               │   (configurável)        │
               │  Anthropic · Ollama     │
               └─────────────────────────┘
```

---

## Diagramas de Sequência

### Fluxo de Autenticação

```mermaid
sequenceDiagram
    participant U as Usuário/Browser
    participant P as proxy.ts (middleware)
    participant A as /api/auth/login
    participant DB as MySQL

    U->>P: POST /api/auth/login {username, password}
    P->>P: Gera nonce CSP
    P->>A: Repassa com nonce no header
    A->>A: loginLimiter (5 req/min por IP)
    A->>DB: SELECT user WHERE username = ?
    DB-->>A: user row (hash bcrypt)
    A->>A: bcrypt.compare(password, hash)
    alt credenciais válidas
        A->>A: Gera JWT (role, workspace_id, exp)
        A-->>U: Set-Cookie: mc-session=<jwt> + 200 OK
    else inválidas
        A->>DB: logAuditEvent(login_failed)
        A-->>U: 401 Unauthorized
    end
```

### Fluxo de Registro de Agente

```mermaid
sequenceDiagram
    participant AG as Processo Agente
    participant API as /api/agents/register
    participant DB as MySQL
    participant EB as Event Bus
    participant UI as Dashboard (SSE)

    AG->>API: POST {name, role, framework} + Bearer token
    API->>API: requireRole(viewer) — valida JWT/API key
    API->>API: selfRegisterLimiter (5 req/min por IP)
    API->>DB: SELECT agent WHERE name = ? AND workspace_id = ?
    alt agente já existe
        DB-->>API: row existente
        API->>DB: UPDATE status='idle', last_seen=now
        API-->>AG: 200 {registered: false}
    else novo agente
        DB-->>API: null
        API->>DB: INSERT INTO agents (name, role, workspace_id, ...)
        API->>DB: logActivity(agent_created)
        API->>DB: logAuditEvent(agent_self_register)
        API->>EB: broadcast('agent.created', {id, name, workspace_id})
        EB->>UI: SSE event → atualiza lista de agentes
        API-->>AG: 201 {registered: true, agent: {...}}
    end
```

### Fluxo do Pipeline Engine (JIRA/Azure → LLM → Card)

```mermaid
sequenceDiagram
    participant SCH as Scheduler (30s tick)
    participant ENG as Pipeline Engine
    participant JP as JIRA/Azure API
    participant DB as MySQL
    participant LLM as LLM Gateway
    participant EB as Event Bus
    participant UI as Dashboard (SSE)

    SCH->>ENG: tick()
    ENG->>DB: SELECT work_pipelines WHERE enabled = 1
    loop para cada workspace ativo
        ENG->>DB: getWorkPipelineRow(workspaceId)
        ENG->>JP: fetchJiraIssuesByStatus(triggerColumn)
        JP-->>ENG: lista de cards
        loop para cada card não processado
            ENG->>DB: INSERT pipeline_runs (card_key, status='running')
            ENG->>EB: broadcast('pipeline.stage_started', {...})
            EB->>UI: SSE → atualiza painel de pipelines
            loop para cada estágio do pipeline
                ENG->>DB: SELECT agents WHERE stage_id = ?
                ENG->>LLM: POST /v1/messages {system: soul_content, user: card_content}
                LLM-->>ENG: completion + tokens usados
                ENG->>DB: INSERT token_usage (cost_usd, input_tokens, ...)
                ENG->>JP: postJiraComment(card_key, resultado_llm)
                alt agente principal falha
                    ENG->>ENG: fallback cascade → tenta próximo modelo
                end
            end
            ENG->>JP: transitionJiraIssue(card_key, próxima_coluna)
            ENG->>DB: UPDATE pipeline_runs SET status='done'
            ENG->>EB: broadcast('pipeline.run_completed', {...})
            EB->>UI: SSE → atualiza custo e status
        end
    end
```

### Fluxo de Execução de Tarefa por Agente

```mermaid
sequenceDiagram
    participant AG as Agente Autônomo
    participant API as /api/tasks
    participant DIS as task-dispatch
    participant LLM as LLM Gateway
    participant DB as MySQL
    participant WH as Webhook Engine

    AG->>API: GET /api/tasks?status=assigned&assigned_to=agent-x
    API-->>AG: lista de tarefas pendentes

    AG->>API: PUT /api/tasks/:id {status: 'in_progress'}
    API->>DB: UPDATE tasks SET status='in_progress'
    API->>DB: logActivity(task_status_change)

    AG->>DIS: dispatchTask(task)
    DIS->>DIS: classifyTaskModel(task) → Haiku|Sonnet|Opus
    DIS->>LLM: POST {model, system_prompt, task_content}
    LLM-->>DIS: completion + usage
    DIS->>DB: INSERT token_usage (cost_usd, model, agent_id)

    AG->>API: PUT /api/tasks/:id {status: 'done', output: resultado}
    API->>DB: UPDATE tasks SET status='done'
    API->>WH: dispatchWebhookEvent('task.completed', payload)
    WH->>WH: POST para URLs configuradas
```

### Fluxo de Rastreamento de Custo e Modo Econômico

```mermaid
sequenceDiagram
    participant UI as Overview Dashboard
    participant CMA as /api/tokens/compact-mode
    participant BA as /api/tokens/by-agent
    participant DB as MySQL

    UI->>BA: GET /api/tokens/by-agent?days=30
    BA->>DB: SELECT agent_name, SUM(tokens), SUM(cost_usd) FROM token_usage GROUP BY agent_name
    DB-->>BA: rows por agente
    BA-->>UI: [{agent, total_tokens, total_cost, models}]

    UI->>CMA: GET /api/tokens/compact-mode?days=30
    CMA->>DB: SELECT name, soul_content FROM agents
    CMA->>DB: SELECT agent_name, SUM(output_tokens), COUNT(*) FROM token_usage GROUP BY agent_name
    DB-->>CMA: agentes + uso
    CMA->>CMA: Cruza soul_content com token_usage\nSepara grupos: compact vs standard
    CMA-->>UI: {compact, standard, savings: {pct, tokens_saved}, per_agent}

    UI->>UI: Renderiza gráfico por agente (verde=compacto, cinza=padrão)
    UI->>UI: Exibe KPI: % redução output, tokens poupados
```

### Fluxo SSE (Server-Sent Events)

```mermaid
sequenceDiagram
    participant UI as Browser (EventSource)
    participant SSE as /api/events
    participant EB as Event Bus
    participant ANY as Qualquer Route Handler

    UI->>SSE: GET /api/events (conexão persistente)
    SSE->>SSE: requireRole(viewer) — autentica
    SSE->>SSE: Registra handler no Event Bus (workspace_id filtrado)
    SSE-->>UI: data: {"type":"connected"}\n\n

    loop a cada 30 segundos
        SSE-->>UI: : heartbeat\n\n
    end

    ANY->>EB: broadcast('agent.created', {id, name, workspace_id})
    EB->>EB: Filtra: workspace_id != subscriber → descarta
    EB->>EB: workspace_id == subscriber → entrega
    EB->>SSE: handler(event)
    SSE-->>UI: data: {"type":"agent.created","data":{...}}\n\n
    UI->>UI: Atualiza estado React sem reload de página
```

---

## Quick Start

**Pré-requisitos:** Node.js ≥ 22, pnpm (`corepack enable`), MySQL 8+

```bash
git clone https://github.com/kamilaalves1/vertex-control-center.git
cd vertex-control-center
pnpm install
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000) — credenciais padrão: `admin` / `admin`.

> **Primeiro acesso:** `AUTH_SECRET` e `API_KEY` são gerados automaticamente e salvos em `.data/`. Altere a senha padrão imediatamente em **Configurações → Usuários**.

### Build de produção

```bash
pnpm build
pnpm start
# ou modo standalone:
node .next/standalone/server.js
```

### Docker (zero-config)

```bash
docker compose up
```

Overlay de produção hardened (filesystem read-only, rede interna, HSTS, cookies strict):

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

---

## Stack Técnico

| Camada | Tecnologia | Notas |
|---|---|---|
| Framework | Next.js 16 — App Router | Server components + route handlers |
| UI | React 19, Tailwind CSS 3 | Painéis client com navegação via `startTransition` |
| Linguagem | TypeScript 5 | Modo strict, zero `any` nos caminhos críticos |
| Banco de dados | MySQL 8 via `mysql2` | Pool de conexões, migrações incrementais automáticas |
| Estado | Zustand | Estado client-side de painéis e filtros |
| Tempo real | Server-Sent Events (SSE) | Event bus in-process com entrega por workspace |
| Autenticação | Sessões JWT + RBAC | Roles: `viewer` · `operator` · `admin` |
| Gerenciador de pacotes | pnpm | Instalações estritas e reproduzíveis |

---

## Funcionalidades

### Gestão de Frota de Agentes

Registre agentes via dashboard, API REST ou servidor MCP. Cada agente possui:

- **Role** — `coder`, `reviewer`, `tester`, `devops`, `researcher`, `assistant`, `agent`
- **Soul content** — prompt de sistema lido pelo pipeline engine; editável diretamente pelo painel
- **Modo econômico** — ative "Ativar modo compacto" por agente para inserir instruções de output conciso no soul content; o dashboard compara automaticamente o consumo de tokens
- **Skills inline** — arquivos `SKILL.md` referenciados no soul content aparecem como seções expansíveis e editáveis diretamente no painel do agente
- **Memória** — armazenamento chave-valor por agente, com busca
- **Heartbeat** — transição automática `idle → offline` após timeout
- **Diagnósticos** — saída da última execução, traces de erro, histórico de atribuição
- **Chaves** — rotação de API key por agente

```bash
# Auto-registro a partir de um processo agente
curl -X POST http://localhost:3000/api/agents/register \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "code-reviewer", "role": "reviewer", "framework": "custom"}'
```

### Pipeline Engine

Conecte seu backlog de gerenciamento de projetos e defina pipelines em múltiplos estágios:

1. **Configure o provedor** — JIRA Cloud/Server ou Azure DevOps (Configurações → Work Pipeline)
2. **Mapeie colunas** — cada coluna do board vira um estágio do pipeline
3. **Atribua agentes** — um ou mais agentes por estágio, com cascade de fallback opcional
4. **Engine monitora** — cards que entram em uma coluna gatilho são capturados automaticamente
5. **LLM executa** — o agente atribuído lê o card, gera saída e posta um comentário (usando o `soul_content` do agente como system prompt)
6. **Card avança** — engine transiciona o card para a próxima coluna

**Cascade de fallback** — se o agente principal falhar, o engine pode tentar modelos alternativos ou todos os modelos configurados em ordem, garantindo que nenhum card seja descartado silenciosamente.

**Bot mention** — usuários podem responder a um comentário do card com `@pipeline <instrução>` para disparar reprocessamento com novo contexto.

### Modo Econômico

O modo econômico insere um bloco de instruções compactas no `soul_content` do agente, orientando o LLM a produzir respostas mais curtas sem comprometer a qualidade:

- Ative/desative por agente na aba **Instruções** do painel de detalhes
- O dashboard (Visão Geral) exibe um gráfico comparando tokens de output por requisição entre agentes compactos e padrão
- Calcula automaticamente a % de redução e os tokens poupados no período selecionado

### Skill Viewer

Skills são arquivos `SKILL.md` que os agentes podem referenciar em seu `soul_content` com o padrão `skills/<nome>/SKILL.md`. O painel de detalhes do agente:

- Detecta automaticamente as referências no soul content
- Exibe cada skill como um acordeão expansível
- Permite edição direta do arquivo com botão Salvar/Cancelar (requer role `operator`)

### Rastreamento de Custo

Cada chamada LLM registra tokens de entrada, tokens de saída, modelo e custo calculado em USD. O painel de rastreamento de custo exibe:

- **Custo por agente** — gasto total por agente, ordenado por custo
- **Breakdown por modelo** — divisão de custo por modelo dentro de cada agente
- **Tendência diária** — últimos 5 dias de gasto (gráfico de barras)
- **Relatório exportável** — exportação CSV para qualquer intervalo de datas

Os custos são lidos da coluna `cost_usd` armazenada no momento da chamada — sem recálculo na hora da exibição, garantindo precisão mesmo para modelos customizados ou auto-hospedados.

### Eventos em Tempo Real

Todos os clientes conectam em `/api/events` (SSE). O event bus transmite eventos com escopo por workspace:

| Evento | Gatilho |
|---|---|
| `agent.created` | Agente registrado |
| `agent.updated` | Mudança de config ou status do agente |
| `agent.deleted` | Agente removido |
| `agent.status_changed` | Flip de status por heartbeat |
| `connection.created` | Ferramenta CLI conectada |
| `connection.disconnected` | Ferramenta CLI desconectada |
| `pipeline.stage_started` | Estágio do pipeline iniciado |
| `pipeline.run_completed` | Todos os estágios concluídos |
| `activity.created` | Qualquer atividade registrada |
| `notification.created` | Notificação emitida |
| `chat.message` | Mensagem de chat do card postada |

### Webhooks

Webhooks de saída disparam em tipos de evento configuráveis. Cada entrega é registrada com status, código de resposta e latência. Entregas com falha podem ser reprocessadas manualmente ou via scheduler.

### Audit Log e Exportação

Toda mutação — login, criação de agente, mudança de config, execução de pipeline — é escrita na tabela `audit_log`, com escopo para o workspace do usuário atuante. Admins podem exportar audit logs, tarefas, atividades e execuções de pipeline como CSV ou JSON em `/api/export`.

---

## Segurança

| Controle | Implementação |
|---|---|
| **Proteção SSRF** | Hostnames de cloud-metadata e CIDRs privados (RFC 1918, loopback, link-local) são bloqueados incondicionalmente antes do allowlist de gateway — nenhuma configuração de usuário pode sobrescrever |
| **Rate limiting** | Login: 5 req/min · Mutações: 60 req/min · Leituras: 120 req/min · Ops pesadas: 10 req/min · Auto-registro de agente: 5 req/min |
| **Extração de IP** | IP do cliente lido da cadeia de proxies confiáveis (`MC_TRUSTED_PROXIES`); cai de volta para bucket compartilhado `direct` quando sem proxies configurados, prevenindo bypass via headers forjados |
| **CSP** | `script-src` baseado em nonce com `'strict-dynamic'`; `'unsafe-eval'` apenas em desenvolvimento; WebSockets restritos às origens localhost |
| **HSTS** | Habilitado ao servir via HTTPS ou quando `MC_ENABLE_HSTS=1`; max-age 2 anos com `includeSubDomains; preload` |
| **Permissions-Policy** | Restringe APIs de câmera, microfone, geolocalização e pagamento |
| **Isolamento por workspace** | Toda query filtra por `workspace_id`; SSE entrega apenas eventos do workspace do subscriber |
| **RBAC** | Três roles impostos no nível do route handler: `viewer` (somente leitura), `operator` (criar/atualizar), `admin` (acesso total) |
| **Trilha de auditoria** | Todas as mutações registradas com ator, IP e target; exportação com escopo por workspace via subquery de actor_id |
| **Path traversal** | Endpoints que servem arquivos do projeto (project-skills) validam o caminho resolvido contra a raiz permitida antes de qualquer leitura/escrita |

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `MYSQL_HOST` | `localhost` | Host do MySQL |
| `MYSQL_PORT` | `3306` | Porta do MySQL |
| `MYSQL_USER` | `root` | Usuário do MySQL |
| `MYSQL_PASSWORD` | _(vazio)_ | Senha do MySQL |
| `MYSQL_DATABASE` | `aura` | Nome do banco de dados |
| `MYSQL_SSL` | `false` | Defina como `true` para habilitar TLS na conexão MySQL |
| `AUTH_SECRET` | auto-gerado | Segredo de assinatura JWT — rotacione para invalidar todas as sessões |
| `API_KEY` | auto-gerado | API key mestre para acesso de agente/MCP |
| `AUTH_PASS` | `admin` | Senha padrão do admin (altere imediatamente) |
| `MC_TRUSTED_PROXIES` | _(nenhum)_ | IPs separados por vírgula dos reverse proxies confiáveis |
| `MC_ENABLE_HSTS` | `0` | Defina como `1` para forçar HSTS mesmo sem detecção de TLS |
| `MC_DISABLE_HSTS` | `0` | Defina como `1` para suprimir HSTS mesmo quando HTTPS detectado |
| `MC_COOKIE_SECURE` | `0` | Defina como `1` para marcar cookies de sessão como Secure |
| `MC_COOKIE_SAMESITE` | `lax` | `lax` ou `strict` |
| `MC_ALLOWED_HOSTS` | _(nenhum)_ | Valores permitidos do header Host separados por vírgula |
| `MISSION_CONTROL_DATA_DIR` | `.data/` | Sobrescreve o diretório de dados |
| `MC_DISABLE_RATE_LIMIT` | `0` | Defina como `1` para desabilitar rate limits não-críticos (apenas testes) |
| `NEXT_PUBLIC_GATEWAY_OPTIONAL` | `false` | Defina como `true` para deployments standalone sem gateway |

---

## Referência de API

A especificação OpenAPI completa está em `openapi.json`. Documentação interativa disponível em `/docs` com o servidor rodando.

### Autenticação

Todos os endpoints requerem autenticação. Passe a API key como Bearer token ou como cookie de sessão após o login:

```bash
# Bearer token (acesso programático/agente)
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $MC_API_KEY"

# Login de sessão
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"username":"admin","password":"admin"}'
```

### Endpoints Principais

| Método | Caminho | Role | Descrição |
|---|---|---|---|
| `GET` | `/api/agents` | viewer | Lista agentes (filtra por status, role) |
| `POST` | `/api/agents` | operator | Cria agente |
| `GET` | `/api/agents/:id` | viewer | Detalhe do agente + config |
| `PUT` | `/api/agents/:id` | operator | Atualiza config do agente |
| `DELETE` | `/api/agents/:id` | admin | Remove agente |
| `PUT` | `/api/agents/:id/soul` | operator | Salva soul_content do agente |
| `POST` | `/api/agents/register` | viewer | Auto-registro de agente |
| `GET` | `/api/agents/:id/heartbeat` | viewer | Recebe heartbeat |
| `GET` | `/api/agents/:id/memory` | viewer | Memória do agente |
| `GET` | `/api/project-skills` | viewer | Lê arquivo SKILL.md do projeto |
| `PUT` | `/api/project-skills` | operator | Salva arquivo SKILL.md do projeto |
| `GET` | `/api/tasks` | viewer | Lista tarefas |
| `POST` | `/api/tasks` | operator | Cria tarefa |
| `PUT` | `/api/tasks/:id` | operator | Atualiza tarefa |
| `GET` | `/api/tasks/queue` | viewer | Visão de fila (pendentes + atribuídas) |
| `GET` | `/api/tokens` | viewer | Log de uso de tokens |
| `GET` | `/api/tokens/by-agent` | viewer | Custo por agente |
| `GET` | `/api/tokens/compact-mode` | viewer | Comparativo de tokens: modo compacto vs padrão |
| `GET` | `/api/events` | viewer | Stream SSE |
| `POST` | `/api/connect` | operator | Registra conexão CLI |
| `GET` | `/api/work-pipeline` | admin | Config do pipeline |
| `PUT` | `/api/work-pipeline` | admin | Salva config do pipeline |
| `GET` | `/api/work-pipeline/backlog` | operator | Busca backlog atual |
| `GET` | `/api/pipeline/engine/status` | viewer | Status do engine + execuções ativas |
| `GET` | `/api/export` | admin | Exporta dados (CSV/JSON) |
| `GET` | `/api/audit` | admin | Audit log |
| `GET` | `/api/webhooks` | admin | Config de webhooks |
| `GET` | `/api/sessions` | viewer | Lista de sessões de agente |
| `GET` | `/api/scheduler` | admin | Status do scheduler |
| `GET` | `/api/workspaces` | admin | Lista de workspaces |

---

## Desenvolvimento

```bash
pnpm dev          # inicia servidor dev (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # testes unitários vitest
pnpm test:e2e     # testes end-to-end playwright
pnpm test:all     # lint + typecheck + test + build + e2e
```

### Estrutura do Projeto

```
src/
├── app/
│   ├── api/          # ~150 route handlers (Next.js App Router)
│   └── [[...panel]]/ # Página catch-all única — navegação de painel client-side
├── components/
│   └── panels/       # Painéis do dashboard (um arquivo por painel)
└── lib/
    ├── db.ts               # Conexão com banco + migrações de schema
    ├── db-pool.ts          # Pool MySQL (mysql2)
    ├── auth.ts             # Sessões JWT + RBAC
    ├── rate-limit.ts       # Rate limiters (por IP + identidade de agente)
    ├── csp.ts              # Builder de Content Security Policy
    ├── event-bus.ts        # Bus SSE in-process de broadcast
    ├── pipeline-engine.ts  # Engine de execução de pipeline JIRA/Azure
    ├── task-dispatch.ts    # Despacho de tarefas LLM + roteamento de modelo
    ├── scheduler.ts        # Scheduler de background estilo cron
    └── webhooks.ts         # Entrega de webhooks de saída

skills/            # Arquivos SKILL.md por domínio (editáveis pelo dashboard)
├── swe-orchestration-coordination/SKILL.md
└── ...

.data/             # Dados de runtime (no .gitignore)
└── ...

scripts/
├── mc-mcp-server.cjs  # Binário do servidor MCP
└── ...
```

### Banco de Dados

MySQL 8. O schema é gerenciado via migrações incrementais em `src/lib/migrations-mysql.ts`. Para resetar o banco durante o desenvolvimento:

```bash
# Drope e recrie o banco no MySQL
mysql -u root -e "DROP DATABASE IF EXISTS aura; CREATE DATABASE aura;"
pnpm dev   # migrações são reaplicadas no próximo start
```

---

## Deploy

### Standalone

```bash
pnpm build
node .next/standalone/server.js
```

O output standalone é autossuficiente — não requer `node_modules` em runtime.

### Docker

```bash
# Desenvolvimento / avaliação
docker compose up

# Produção (hardened: FS read-only, rede interna, HSTS, cookies strict)
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

O container remove todas as capabilities Linux exceto `NET_BIND_SERVICE`, roda com filesystem read-only (tmpfs para `/tmp` e cache do Next.js) e limita memória a 512 MB.

### Reverse Proxy (exemplo nginx)

```nginx
server {
    listen 443 ssl;
    server_name aura.suaempresa.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE: desabilita buffering
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Configure `MC_TRUSTED_PROXIES=127.0.0.1` e `MC_ENABLE_HSTS=1` no seu ambiente.

---

## Arquitetura AWS — Modelo C4

### Nível 1 — Contexto do Sistema

```mermaid
C4Context
    title Contexto do Sistema — AURA

    Person(operador, "Operador / Admin", "Acessa o dashboard via browser para configurar pipelines, monitorar agentes e analisar custos")
    Person(agente, "Processo Agente", "Agente autônomo que se registra, recebe tarefas e reporta resultados via REST API")

    System(vcc, "AURA", "Plataforma de operações de IA. Gerencia frota de agentes, pipelines, custos e eventos em tempo real.")

    System_Ext(jira, "JIRA / Azure DevOps", "Backlog de projetos. A AURA lê cards, posta comentários e transiciona status automaticamente.")
    System_Ext(github, "GitHub", "Repositórios de código. A AURA cria PRs, posta comentários e atualiza status de CI.")
    System_Ext(llm, "LLM Provider", "API de modelos de linguagem (Anthropic, Ollama, etc). A AURA envia prompts e recebe completions.")

    Rel(operador, vcc, "Acessa via HTTPS", "Browser")
    Rel(agente, vcc, "Registra, heartbeat, reporta tarefas", "HTTPS REST")
    Rel(vcc, jira, "Lê cards, posta comentários, transiciona status", "HTTPS REST API")
    Rel(vcc, github, "Lê/cria PRs, branches e comentários", "HTTPS REST API")
    Rel(vcc, llm, "Envia tarefas, recebe completions", "HTTPS")
```

### Nível 2 — Containers (Deploy AWS)

```mermaid
C4Container
    title Containers — Deploy AWS

    Person(operador, "Operador", "Acessa via browser")
    Person(agente, "Processo Agente", "Integração via REST")

    Boundary(aws, "AWS — Conta de Produção") {

        Boundary(vpc, "VPC (10.0.0.0/16)") {

            Boundary(pub, "Subnet Pública") {
                Container(alb, "Application Load Balancer", "AWS ALB", "Termina TLS (ACM), roteia tráfego para ECS. Expõe porta 443.")
            }

            Boundary(priv, "Subnet Privada") {
                Container(ecs, "ECS Fargate Task", "Docker · Next.js 16 · Node 22", "Aplicação principal. Porta 3000.")
                ContainerDb(rds, "Aurora MySQL 8", "AWS Aurora MySQL", "Banco de dados principal — multi-AZ, serverless v2 em produção")
                Container(nat, "NAT Gateway", "AWS NAT Gateway", "Permite saída à internet (JIRA, GitHub, LLM API) sem expor IP privado")
            }
        }

        Container(secrets, "Secrets Manager", "AWS Secrets Manager", "Armazena AUTH_SECRET, API_KEY, credenciais MySQL, JIRA token, GitHub token, LLM API key")
        Container(ecr, "ECR", "AWS Elastic Container Registry", "Repositório privado da imagem Docker da aplicação")
        Container(cw, "CloudWatch", "AWS CloudWatch", "Logs de container, métricas de CPU/memória e alarmes")
        Container(r53, "Route 53", "AWS Route 53", "DNS: aura.suaempresa.com → ALB")
        Container(acm, "ACM", "AWS Certificate Manager", "Certificado TLS para o domínio — renovação automática")
    }

    System_Ext(jira, "JIRA / Azure DevOps", "Backlog externo")
    System_Ext(github, "GitHub", "Repositórios de código")
    System_Ext(llm, "LLM Provider API", "Modelos de linguagem")

    Rel(operador, r53, "HTTPS", "Browser")
    Rel(agente, alb, "HTTPS REST", "Bearer token")
    Rel(r53, alb, "Resolve DNS", "A record")
    Rel(alb, ecs, "HTTP :3000", "Target Group")
    Rel(ecs, rds, "MySQL :3306", "VPC privada — Aurora endpoint")
    Rel(ecs, secrets, "GetSecretValue", "IAM + TLS")
    Rel(ecs, cw, "PutLogEvents", "IAM + TLS")
    Rel(ecs, nat, "Saída internet", "TCP")
    Rel(nat, jira, "HTTPS REST API", "Porta 443")
    Rel(nat, github, "HTTPS REST API", "Porta 443")
    Rel(nat, llm, "HTTPS", "Porta 443")
    Rel(ecr, ecs, "Pull imagem", "IAM + TLS")
```

---

### Permissões Necessárias

#### IAM — Task Role do ECS

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsRead",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:aura/*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:REGION:ACCOUNT_ID:log-group:/ecs/aura:*"
    },
    {
      "Sid": "ECRPull",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ],
      "Resource": "*"
    }
  ]
}
```

#### GitHub — Permissões do GitHub App

Crie um **GitHub App** com as seguintes permissões de repositório:

| Permissão | Nível | Para que serve |
|---|---|---|
| `Contents` | Read & Write | Ler código, criar/commitar arquivos, criar branches |
| `Pull requests` | Read & Write | Criar, revisar e mergear PRs |
| `Issues` | Read & Write | Criar issues, postar comentários |
| `Commit statuses` | Read & Write | Atualizar status de CI/CD em commits |
| `Actions` | Read | Ler resultados de workflows |
| `Metadata` | Read | Obrigatório pelo GitHub |
| `Checks` | Read & Write | Criar check runs com resultados de agentes |

#### JIRA — Permissões da API Token

| Permissão | Para que serve |
|---|---|
| Browse Projects | Ler cards e estrutura do board |
| Create Issues | Criar cards quando necessário |
| Edit Issues | Atualizar campos dos cards |
| Transition Issues | Mover cards entre colunas do pipeline |
| Add Comments | Postar resultados dos agentes nos cards |
| View Read-only Workflow | Ler a configuração de colunas do board |
| Assign Issues | Atribuir cards a membros da equipe |

---

## Licença

MIT — veja [LICENSE](LICENSE).
Derivado de [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control)
Desenvolvido por Kamila ALVES
