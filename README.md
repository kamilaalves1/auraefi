<div align="center">

# AURA

**Plataforma de Orquestração de Agentes de IA para Squads de Desenvolvimento**

Conecte seu backlog (JIRA ou Azure DevOps), defina pipelines em múltiplos estágios e deixe agentes de IA executar cada etapa de forma autônoma — com commits de código, abertura de MR/PR, comentários no card, harness de validação e visibilidade completa de custo.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![pnpm](https://img.shields.io/badge/pnpm-only-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

</div>

---

## Índice

- [O que é](#o-que-é)
- [Arquitetura](#arquitetura)
- [Pipeline Engine](#pipeline-engine)
- [Harness de Validação](#harness-de-validação)
- [Sistema de Skills](#sistema-de-skills)
- [Repositórios Git e Commits](#repositórios-git-e-commits)
- [Second Brain](#second-brain)
- [Stack Técnico](#stack-técnico)
- [Banco de Dados](#banco-de-dados)
- [Segurança](#segurança)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Quick Start](#quick-start)
- [Deploy](#deploy)
- [API Reference](#api-reference)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Desenvolvimento](#desenvolvimento)

---

## O que é

AURA é uma plataforma auto-hospedada que orquestra agentes de IA ao longo do ciclo de vida do desenvolvimento de software. O sistema monitora cards do JIRA ou Azure DevOps, roteia cada card por um pipeline configurável de estágios, e em cada estágio chama um agente de IA (LLM) com skills especializadas para executar a tarefa — análise de negócio, arquitetura, implementação, revisão de código, QA, segurança, release.

**O que o sistema faz automaticamente:**

- Detecta cards entrando em colunas configuradas como gatilho no JIRA/Azure
- Chama o LLM de cada agente com o contexto do card + soul content + skills + contexto do repositório
- Valida o output via harness antes de executar ações
- Commita código gerado nos repositórios Git configurados (GitLab, GitHub, Bitbucket)
- Abre Pull Requests / Merge Requests automaticamente
- Posta comentários nos cards com o resultado de cada agente
- Avança o card para a próxima coluna quando o estágio é concluído
- Cancela runs automaticamente quando o card é deletado do JIRA

**O que o usuário configura:**

- Pipeline: colunas do board → agentes por coluna → modelo LLM por agente
- Repositórios: URL + token de acesso + branch
- Skills: arquivos `SKILL.md` por papel (arquiteto, developer, QA, etc.)
- Instruções por coluna: comportamento específico para cada estágio

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│                              AURA                                     │
│                        Next.js 16 (App Router)                       │
│                                                                       │
│  ┌──────────────────┐         ┌──────────────────────────────────┐   │
│  │    UI (React 19) │◀──SSE───│       API Routes (~150)          │   │
│  │    Tailwind CSS  │         │  Auth JWT + RBAC (3 roles)       │   │
│  │    Zustand       │         │  Rate limiting por IP/agente     │   │
│  └──────────────────┘         └────────────────┬─────────────────┘   │
│                                                │                      │
│                               ┌────────────────▼─────────────────┐   │
│                               │         Event Bus (SSE)           │   │
│                               │     (in-process, por workspace)  │   │
│                               └────────────────┬─────────────────┘   │
│                                                │                      │
│                               ┌────────────────▼─────────────────┐   │
│                               │           MySQL 8                │   │
│                               │  agents · tasks · token_usage    │   │
│                               │  pipeline_card_runs · workspaces │   │
│                               │  git_repositories · work_pipelines│  │
│                               │  skills · memory · audit_log     │   │
│                               └────────────────┬─────────────────┘   │
│                                                │                      │
│                               ┌────────────────▼─────────────────┐   │
│                               │       Pipeline Engine            │   │
│                               │   (scheduler — tick a cada 10s) │   │
│                               │                                   │   │
│                               │  1. Detecta cards no JIRA/Azure  │   │
│                               │  2. Chama LLM por agente/estágio │   │
│                               │  3. Harness valida output        │   │
│                               │  4. Commita código no Git        │   │
│                               │  5. Abre MR/PR se solicitado     │   │
│                               │  6. Posta comentário no card     │   │
│                               │  7. Avança card para próx. col.  │   │
│                               └────────────────┬─────────────────┘   │
└────────────────────────────────────────────────┼─────────────────────┘
                                                 │
            ┌────────────────────────────────────▼────────────────────┐
            │                  Serviços Externos                       │
            │  JIRA / Azure DevOps  │  GitLab / GitHub / Bitbucket    │
            │  OpenAI / Anthropic   │  Second Brain (EC2, opcional)   │
            └──────────────────────────────────────────────────────────┘
```

---

## Pipeline Engine

O Pipeline Engine é o núcleo do sistema. Roda como uma tarefa de background no scheduler (`tick a cada 10s`) e orquestra todo o ciclo de vida de um card.

### Fluxo de um card

```
Card entra na coluna "Para fazer" (gatilho)
    ↓
discoverNewCards() detecta → cria pipeline_card_run
    ↓
startColumn() — para cada agente da coluna:
    1. Carrega soul_content + skills do agente
    2. Lê contexto do repositório (fetchRepoContext)
    3. Consulta Second Brain se agente é BA/PM
    4. Chama LLM (callAgentLLM)
    5. Harness valida o output
       → Se inválido: posta comentário pedindo intervenção humana → waiting_input
       → Se válido: continua
    6. Detecta blocos ### FILE: → commita no Git
    7. Detecta OPEN_PR: true → abre MR/PR
    8. Posta comentário no card com o resultado
    ↓
advanceToNextColumn() → move card no JIRA/Azure
    ↓
Repete para cada estágio até a última coluna
    ↓
Run concluído → grava aprendizado no Second Brain
```

### Resolução de repositório

O engine resolve o repositório a usar na seguinte ordem de prioridade:

1. `repo_id` definido no dropdown por agente na coluna
2. Primeiro ID válido em `linkedRepoIds` do pipeline (Repositórios do sistema)
3. Primeiro repositório ativo com token no workspace (fallback automático)

Quando um repositório é deletado, o `linkedRepoIds` e os `assignments_json` das colunas são automaticamente limpos para evitar referências inválidas.

### Multi-repositório

Quando há múltiplos repositórios vinculados no pipeline, o agente recebe o contexto de todos eles e usa o formato:

```
### FILE: [nome-do-repo]: caminho/do/arquivo.ext
```

O engine detecta o prefixo `[nome-do-repo]:` e commita cada arquivo no repositório correto.

### Cancelamento automático de cards deletados

Quando um card é deletado do JIRA/Azure e o engine tenta postar um comentário, recebe um 404. O `postCardComment` detecta esse erro, cancela o run automaticamente no banco (`status = 'cancelled'`) e para o processamento.

### Limite de tentativas

O `startColumn` cancela automaticamente runs que excederam 10 tentativas (`run_count > 10`), evitando loops infinitos. O threshold de stale runs é de 30 minutos — qualquer run em `running` há mais de 30 minutos é marcado como `failed`.

---

## Harness de Validação

O harness (`src/lib/agent-harness.ts`) valida o output de cada agente antes de executar qualquer ação (commit, abertura de MR, avanço de card).

### O que é validado

| Validação | Descrição |
|---|---|
| **Resposta vazia** | Agente retornou texto vazio |
| **Resposta muito curta** | Abaixo do mínimo por papel (ex: arquiteto < 400 chars) |
| **Secrets/credenciais** | Detecta tokens, API keys, private keys no código gerado |
| **Gate obrigatório ausente** | Cada papel deve emitir seu gate (ex: `ARCHITECTURE: APPROVED`) |
| **Bloco FILE sem código** | `### FILE:` sem bloco fenced `\`\`\`` subsequente |

### Quando rejeita

Se o harness rejeitar, o sistema:
1. Posta um comentário no card explicando o problema
2. Solicita intervenção humana
3. Marca o run como `waiting_input`
4. O card fica parado até o humano responder `@pipeline reprocessar`

### Gates por papel

| Papel | Gate esperado |
|---|---|
| software architect | `ARCHITECTURE: APPROVED / BLOCKED / CHANGES_REQUESTED` |
| security auditor | `SECURITY: APPROVED / BLOCKED / NOT_APPLICABLE` |
| qa engineer | `VERDICT: APPROVED / CHANGES_REQUESTED / BLOCKED` |
| business analyst | `ANALYSIS: READY / BLOCKED` |
| data engineer | `DATA: APPROVED / BLOCKED / NOT_APPLICABLE` |
| ux designer | `UX: APPROVED / BLOCKED / NOT_APPLICABLE` |
| product manager | `PRODUCT: READY / BLOCKED` |

O gate `NOT_APPLICABLE` permite que um agente passe o card adiante sem bloquear quando a skill não se aplica ao card (ex: UX em uma task técnica sem impacto na interface).

---

## Sistema de Skills

Skills são arquivos `SKILL.md` dentro da pasta `skills/`. Cada skill define o comportamento esperado de um papel de agente — processo, gates, saídas obrigatórias e antipadrões.

### Skills disponíveis

| Skill | Papel | Descrição |
|---|---|---|
| `swe-orchestration-coordination` | Coordenador | Orquestra o card do início ao fim |
| `swe-software-architecture` | Arquiteto | Decisões técnicas, code review arquitetural |
| `swe-implementation-practices` | Developer | Implementação full-stack com qualidade |
| `swe-business-analysis` | BA | Refinamento de requisitos |
| `swe-product-management` | PM/PO | Outcomes, hipóteses, métricas |
| `swe-security-review` | Security Auditor | Revisão de autenticação, autorização, dados |
| `swe-quality-gates` | QA | Validação contra critérios |
| `swe-data-engineering` | Data Engineer | Schemas, migrações, backfill |
| `swe-architecture-and-data` | Arquiteto/Data | Mudanças de dados e integrações |
| `swe-release-operations` | DevOps | Deploy, rollback, observabilidade |
| `swe-ux-research` | UX | Jornadas, estados, acessibilidade |
| `swe-flow-management` | Scrum Master | WIP, aging, bloqueios |
| `swe-backlog-prioritization` | PO | Priorização por valor e risco |
| `swe-discovery-practices` | Discovery | Hipóteses, experimentos, dependências |

### Como skills chegam ao agente

1. O scheduler executa `syncSkillsFromDisk()` — lê os `SKILL.md` e sincroniza a tabela `skills` no banco
2. O `pipeline-engine` chama `loadAgentSkills(workspaceId)` que lê a tabela `skills` e o conteúdo de cada arquivo
3. O conteúdo das skills é injetado no system prompt do agente via `agentSystemPrompt(agent)`

### Formato de entrega de código

Quando o agente gera código para ser commitado, deve usar o formato:

```
### FILE: caminho/relativo/do/arquivo.ext
```linguagem
// conteúdo completo do arquivo
```
COMMIT: tipo(escopo): descrição
```

Para múltiplos repositórios:

```
### FILE: [nome-do-repo]: caminho/arquivo.ext
```

Para solicitar abertura de PR/MR:

```
OPEN_PR: true
```

---

## Repositórios Git e Commits

### Providers suportados

| Provider | Commit | Contexto (fetchRepoContext) | MR/PR |
|---|---|---|---|
| **GitLab** | ✅ API v4 | ✅ | ✅ Merge Request |
| **GitHub** | ✅ Contents API | ✅ | ✅ Pull Request |
| **Bitbucket** | ✅ POST /src | ✅ | ❌ (não implementado) |

### Configuração

1. Acesse **Repositórios Git** no menu lateral
2. Cadastre o repositório com URL, branch padrão e token de acesso
3. No pipeline, adicione o repositório em **Repositórios do sistema**
4. Opcionalmente, selecione o repositório no dropdown de cada agente da coluna

O token de acesso é **obrigatório** ao criar. Ao editar, deixar o campo vazio mantém o token existente — o campo nunca apaga o token anterior silenciosamente.

### Token do GitLab

Use um token com escopo `api` (leitura e escrita em repositórios). O prefixo `glpat-` é esperado para tokens de acesso pessoal do GitLab.

### Contexto do repositório

Antes de chamar o LLM, o engine lê a árvore de arquivos e os fontes do repositório (até 160K chars) e injeta no prompt. O agente vê a estrutura real do projeto antes de gerar código.

---

## Second Brain

O Second Brain é um serviço externo opcional de base de conhecimento semântica por domínio de negócio. Quando configurado (`SECOND_BRAIN_URL`), o sistema:

1. **Antes** de executar agentes BA/PM: busca conhecimento relevante por domínio e injeta no prompt
2. **Após** cada card concluído: grava o título, descrição e domínio do card na base

### Configuração

```env
SECOND_BRAIN_URL=http://seu-ec2.com:8080
```

Se a variável não estiver configurada, o sistema funciona normalmente sem o Second Brain.

### Domínios inferidos automaticamente

O sistema infere o domínio de negócio a partir do título e descrição do card:

| Domínio | Palavras-chave detectadas |
|---|---|
| `cartoes` | cartão, fatura, limite, parcelamento, bandeira |
| `pix` | pix, chave pix, qr code, transferência |
| `cobranca` | boleto, cobrança, vencimento, inadimplência |
| `conta` | conta corrente, saldo, extrato, ted |
| `emprestimo` | empréstimo, crédito pessoal, consignado |
| `geral` | fallback quando nenhum domínio é identificado |

O Second Brain deve ser implantado como um serviço Python (FastAPI + ChromaDB ou pgvector) em um EC2 separado. O código do serviço é mantido em repositório próprio.

---

## Stack Técnico

| Camada | Tecnologia | Notas |
|---|---|---|
| Framework | Next.js 16 — App Router | Server components + route handlers |
| UI | React 19, Tailwind CSS 3 | Painéis client com navegação via `startTransition` |
| Linguagem | TypeScript 5 | Modo strict |
| Banco de dados | MySQL 8 via `mysql2` | Pool de conexões, migrações automáticas |
| Estado | Zustand | Estado client-side de painéis e filtros |
| Tempo real | Server-Sent Events (SSE) | Event bus in-process com escopo por workspace |
| Autenticação | JWT + RBAC | Roles: `viewer` · `operator` · `admin` |
| Gerenciador de pacotes | pnpm 11 | Instalações estritas |
| LLM Providers | OpenAI, Anthropic, Gemini, Groq, OpenRouter, DeepSeek, Ollama | Multi-provider com fallback configurável |
| Git Providers | GitLab, GitHub, Bitbucket | Commits, MR/PR, leitura de contexto |

---

## Banco de Dados

MySQL 8+. O schema é gerenciado via migrações incrementais em `src/lib/migrations.ts`. As migrações rodam automaticamente no startup.

### Tabelas principais

| Tabela | Descrição |
|---|---|
| `agents` | Agentes registrados com soul_content, role, status |
| `tasks` | Tarefas do backlog interno (inbox → assigned → in_progress → review → done) |
| `pipeline_card_runs` | Execuções de cards pelo pipeline engine (um run por card) |
| `pipeline_card_messages` | Histórico de mensagens de cada run (agent→card, card→agent) |
| `pipeline_columns` | Colunas do pipeline com assignments_json (agentes + repo_id + llm_model) |
| `work_pipelines` | Configuração de pipelines (JIRA/Azure + modelos LLM + linkedRepoIds) |
| `git_repositories` | Repositórios Git com URL, branch e access_token |
| `token_usage` | Log de uso de tokens por agente/modelo com custo em USD |
| `skills` | Skills sincronizadas do disco (path → SKILL.md) |
| `memory` | Memória chave-valor por agente |
| `activities` | Log de atividades do sistema |
| `audit_log` | Audit log imutável de todas as mutações |
| `webhooks` | Configuração de webhooks de saída |
| `workspaces` | Tenants (multi-workspace) |

### Migrações

```bash
# As migrações rodam automaticamente ao subir o servidor.
# Para reset em desenvolvimento:
mysql -u root -e "DROP DATABASE IF EXISTS aura; CREATE DATABASE aura;"
pnpm dev
```

---

## Segurança

### Controles implementados

| Controle | Implementação |
|---|---|
| **SSRF** | Hostnames de cloud-metadata e CIDRs privados (RFC 1918, loopback) são bloqueados antes do allowlist |
| **Rate limiting** | Login: 5/min · Mutações: 60/min · Leituras: 120/min · Auto-registro: 5/min |
| **IP real** | Lido da cadeia `MC_TRUSTED_PROXIES` — protege contra bypass via headers forjados |
| **CSP** | `script-src` baseado em nonce com `'strict-dynamic'` |
| **HSTS** | max-age 2 anos com `includeSubDomains; preload` quando HTTPS |
| **Permissions-Policy** | Restringe câmera, microfone, geolocalização, pagamento |
| **Workspace isolation** | Toda query filtra por `workspace_id` — dados nunca vazam entre tenants |
| **RBAC** | `viewer` (leitura), `operator` (criar/atualizar), `admin` (acesso total) |
| **Token masking** | `access_token` de repositórios só retornado para roles `operator/admin/super` |
| **Audit log** | Toda mutação registrada com ator, IP e target |
| **Path traversal** | Endpoints de arquivo validam caminho resolvido contra raiz permitida |
| **Secret detection** | Harness detecta credenciais no output dos agentes antes de commitar |

### Considerações para o arquiteto

**Secrets dos repositórios Git:** os `access_token` são armazenados em plaintext no MySQL. Em produção, considere:
- Criptografia em repouso no banco (MySQL TDE ou AWS RDS encryption)
- Rotação periódica dos tokens
- Uso de tokens com menor escopo possível

**LLM API keys:** armazenadas na tabela `settings` (chave `integration.PROVIDER_API_KEY`). Mesma recomendação acima.

**JWT secret (`AUTH_SECRET`):** gerado automaticamente no primeiro start e salvo em `.data/`. Em produção, defina explicitamente via variável de ambiente e mantenha em um secrets manager.

**Second Brain:** o serviço no EC2 recebe conteúdo de cards (título, descrição). Certifique-se de que a comunicação é via HTTPS e que o EC2 está em VPC privada com acesso restrito ao servidor AURA.

---

## Variáveis de Ambiente

### Banco de dados

| Variável | Padrão | Descrição |
|---|---|---|
| `MYSQL_HOST` | `localhost` | Host do MySQL |
| `MYSQL_PORT` | `3306` | Porta do MySQL |
| `MYSQL_USER` | `root` | Usuário do MySQL |
| `MYSQL_PASSWORD` | _(vazio)_ | Senha do MySQL |
| `MYSQL_DATABASE` | `aura` | Nome do banco |
| `MYSQL_SSL` | `false` | Habilita TLS na conexão MySQL |

### Autenticação

| Variável | Padrão | Descrição |
|---|---|---|
| `AUTH_SECRET` | auto-gerado | Secret JWT — rotacione para invalidar todas as sessões |
| `API_KEY` | auto-gerado | API key mestre para acesso programático |
| `AUTH_USER` | `admin` | Usuário admin padrão |
| `AUTH_PASS` | `admin` | Senha admin — **altere imediatamente em produção** |
| `AUTH_PASS_B64` | _(vazio)_ | Senha em base64 (use quando contém `#`) |

### Segurança de rede

| Variável | Padrão | Descrição |
|---|---|---|
| `MC_TRUSTED_PROXIES` | _(nenhum)_ | IPs dos reverse proxies confiáveis (vírgula separados) |
| `MC_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hosts permitidos no header Host |
| `MC_ALLOW_ANY_HOST` | _(vazio)_ | Defina `1` para desabilitar validação de host |
| `MC_ENABLE_HSTS` | `0` | Força HSTS mesmo sem HTTPS detectado |
| `MC_COOKIE_SECURE` | `0` | Marca cookies como Secure |
| `MC_COOKIE_SAMESITE` | `lax` | `lax` ou `strict` |

### LLM Providers

Configurados via tela de Integrações ou diretamente via variáveis de ambiente:

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic |
| `OPENAI_API_KEY` | Chave da API OpenAI |
| `GEMINI_API_KEY` | Chave da API Google Gemini |
| `GROQ_API_KEY` | Chave da API Groq |
| `OPENROUTER_API_KEY` | Chave da API OpenRouter |
| `DEEPSEEK_API_KEY` | Chave da API DeepSeek |

Os modelos `o1`, `o3` e similares da OpenAI são suportados — o sistema detecta automaticamente que precisam de `max_completion_tokens` em vez de `max_tokens`.

### Second Brain

| Variável | Padrão | Descrição |
|---|---|---|
| `SECOND_BRAIN_URL` | _(vazio)_ | URL do serviço Second Brain (ex: `http://seu-ec2.com:8080`). Se não configurado, o sistema funciona sem o Second Brain. |

### Outros

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor Next.js |
| `LOG_LEVEL` | `info` | Nível de log (pino): `debug`, `info`, `warn`, `error` |
| `MC_RETAIN_PIPELINE_RUNS_DAYS` | `0` | Retenção de runs de pipeline em dias (0 = forever) |

---

## Quick Start

**Pré-requisitos:** Node.js ≥ 22, pnpm (`corepack enable`), MySQL 8+

```bash
git clone <repo>
cd aura
cp .env.example .env
# edite .env com suas configurações de MySQL

pnpm install
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000) — credenciais padrão: `admin` / `admin`.

> **Primeiro acesso:** altere a senha em **Configurações → Usuários** imediatamente.

### Build de produção

```bash
pnpm build
node .next/standalone/server.js
```

### Docker

```bash
# Desenvolvimento
docker compose up

# Produção (hardened: FS read-only, rede interna, HSTS)
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

---

## Deploy

### Pré-requisitos de produção

1. MySQL 8+ com banco `aura` criado
2. Variáveis de ambiente configuradas (especialmente `AUTH_SECRET`, `AUTH_PASS`, `MYSQL_*`)
3. Reverse proxy (nginx/ALB) com TLS terminando na borda
4. `MC_TRUSTED_PROXIES` configurado com o IP do proxy
5. `MC_ENABLE_HSTS=1` ou TLS detectado automaticamente

### Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name aura.suaempresa.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE requer desabilitar buffering
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

### CI/CD (GitLab)

O projeto usa `.gitlab-ci.yml` com três stages:

- `validate` — typecheck + build (roda em MR e push no master)
- `release` — build standalone + empacota `.tar.gz` + publica no S3 (push no master)
- `deploy` — deploy via SSM Run Command na EC2 (manual)

O build usa `node:22-bullseye-slim`. O Debian Bullseye está arquivado — o CI usa `archive.debian.org` para instalar dependências.

---

## API Reference

A especificação OpenAPI completa está em `openapi.json`. Documentação interativa em `/docs` com o servidor rodando.

### Autenticação

```bash
# Login de sessão
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Bearer token (acesso programático)
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $API_KEY"
```

### Endpoints principais

| Método | Caminho | Role | Descrição |
|---|---|---|---|
| `GET/POST` | `/api/agents` | viewer/operator | Lista e cria agentes |
| `GET/PUT/DELETE` | `/api/agents/:id` | viewer/operator/admin | Detalhe, atualiza, remove |
| `GET/PUT` | `/api/workspace/git-repositories` | viewer/operator | Lista e cria repositórios Git |
| `GET/PUT/DELETE` | `/api/workspace/git-repositories/:id` | viewer/operator | Detalhe, atualiza, remove |
| `POST` | `/api/workspace/git-repositories/:id/test` | operator | Testa conexão com o repositório |
| `GET/PUT` | `/api/workspace/work-pipelines` | viewer/operator | Pipelines |
| `GET/PUT` | `/api/workspace/work-pipelines/:id/columns` | viewer/operator | Colunas do pipeline |
| `GET/POST` | `/api/pipeline/engine/runs` | viewer/operator | Lista runs, cancela, reprocessa |
| `GET` | `/api/admin/reset-repos` | admin | Diagnóstico e repair de repositórios |
| `GET` | `/api/workspace/git-repositories/debug` | admin | Estado detalhado dos tokens |
| `GET` | `/api/tasks` | viewer | Lista tarefas |
| `GET` | `/api/tokens/by-agent` | viewer | Custo por agente |
| `GET` | `/api/events` | viewer | Stream SSE |
| `GET` | `/api/audit` | admin | Audit log |
| `GET` | `/api/export` | admin | Exporta dados (CSV/JSON) |
| `GET` | `/api/skills` | viewer | Lista skills |
| `GET` | `/api/scheduler` | admin | Status do scheduler |

---

## Estrutura do Projeto

```
src/
├── app/
│   ├── api/                    # ~150 route handlers
│   │   ├── admin/              # Endpoints administrativos (diagnóstico, repair)
│   │   ├── pipeline/engine/    # Controle do pipeline engine (runs, cancel, reprocess)
│   │   └── workspace/          # Recursos por workspace (repos, pipelines, colunas)
│   └── [[...panel]]/           # Página catch-all — navegação client-side
├── components/
│   └── panels/                 # Painéis do dashboard (um arquivo por painel)
└── lib/
    ├── agent-harness.ts         # Harness de validação de output dos agentes
    ├── auth.ts                  # Sessões JWT + RBAC
    ├── db.ts                    # Conexão MySQL + migrações
    ├── db-pool.ts               # Pool MySQL (mysql2)
    ├── event-bus.ts             # Bus SSE in-process por workspace
    ├── migrations.ts            # Migrações incrementais do schema
    ├── pipeline-engine.ts       # Engine principal de orquestração
    ├── rate-limit.ts            # Rate limiters por IP/agente
    ├── scheduler.ts             # Scheduler background (cron-like)
    ├── second-brain-client.ts   # Cliente HTTP para o serviço Second Brain
    ├── skill-sync.ts            # Sincronização de SKILL.md → tabela skills
    ├── task-dispatch.ts         # Despacho de tarefas LLM (Aegis review, etc.)
    ├── token-pricing.ts         # Cálculo de custo por modelo
    ├── work-pipeline-jira.ts    # Integração JIRA (buscar cards, postar comentários)
    └── work-pipeline-azure.ts   # Integração Azure DevOps

skills/                          # Skills dos agentes (SKILL.md por papel)
├── swe-orchestration-coordination/
├── swe-software-architecture/
├── swe-implementation-practices/
├── swe-business-analysis/
├── swe-product-management/
├── swe-security-review/
├── swe-quality-gates/
├── swe-data-engineering/
├── swe-architecture-and-data/
├── swe-release-operations/
├── swe-ux-research/
├── swe-flow-management/
├── swe-backlog-prioritization/
└── swe-discovery-practices/

.kiro/
└── steering/
    └── product-context.md       # Contexto de produto e domínios de negócio (injetado automaticamente em agentes BA/PM)
```

---

## Desenvolvimento

```bash
pnpm dev          # servidor dev (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # testes unitários vitest
pnpm test:e2e     # testes e2e playwright
pnpm build        # build de produção
```

### Adicionando um novo provider LLM

1. Adicione o case no `switch (provider)` em `dispatchToModel()` em `task-dispatch.ts`
2. Adicione o case em `dispatchLLM()` em `pipeline-engine.ts`
3. Adicione a base URL em `OPENAI_COMPAT_BASES` se for compatível com OpenAI
4. Adicione a integração na tela de Integrações (`integrations-panel.tsx`)

### Adicionando uma nova skill

1. Crie o diretório `skills/seu-skill-name/`
2. Crie o arquivo `skills/seu-skill-name/SKILL.md` com frontmatter:
   ```yaml
   ---
   name: seu-skill-name
   description: Descrição curta do papel e quando usar esta skill.
   ---
   ```
3. O scheduler sincroniza automaticamente para a tabela `skills` no próximo tick

### Configurando o Second Brain

1. Implante o serviço em um EC2 (repositório separado)
2. Configure `SECOND_BRAIN_URL=http://seu-ec2.com:8080` no `.env`
3. Reinicie o servidor AURA

---

## Licença

MIT
