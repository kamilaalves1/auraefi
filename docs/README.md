# AURA — Documentação Completa

> **AURA** (AI-powered Unified Release Architecture) é uma plataforma de orquestração de agentes de IA para squads de desenvolvimento de software. Ela monitora seu board do Jira ou Azure DevOps e, quando um card entra numa coluna configurada como gatilho, assume o processo de forma autônoma: analisa o card, aciona cada agente especializado na sequência correta, commita o código gerado no repositório do projeto, abre o PR, monitora o CI e avança o card — sem intervenção humana, a menos que um bloqueio real exija decisão do time.
>
> O AURA **não é um chatbot**. Não há uma interface de conversa. A interação humana acontece pelo próprio Jira: sempre que necessário, o time pode comentar diretamente no card e os agentes respondem na sequência.

---

## Índice

1. [Visão de Produto](#1-visão-de-produto)
2. [Conceitos Fundamentais](#2-conceitos-fundamentais)
3. [Arquitetura Geral](#3-arquitetura-geral)
4. [Stack Tecnológica](#4-stack-tecnológica)
5. [Banco de Dados](#5-banco-de-dados)
6. [Como um Agente é Criado](#6-como-um-agente-é-criado)
7. [Skills — O Cérebro dos Agentes](#7-skills--o-cérebro-dos-agentes)
8. [O Motor do Pipeline](#8-o-motor-do-pipeline)
9. [Integração com Jira](#9-integração-com-jira)
10. [Integração com GitHub / GitLab](#10-integração-com-github--gitlab)
11. [Chamada ao LLM](#11-chamada-ao-llm)
12. [Harness de Qualidade](#12-harness-de-qualidade)
13. [SSE — Eventos em Tempo Real](#13-sse--eventos-em-tempo-real)
14. [Autenticação e Multitenancy](#14-autenticação-e-multitenancy)
15. [Diagrama de Sequência — Fluxo Completo de um Card](#15-diagrama-de-sequência--fluxo-completo-de-um-card)
16. [Diagrama de Componentes](#16-diagrama-de-componentes)
17. [Diagrama de Banco de Dados](#17-diagrama-de-banco-de-dados)
18. [Estrutura de Pastas](#18-estrutura-de-pastas)
19. [Como Instalar e Configurar](#19-como-instalar-e-configurar)
20. [Referência de Configuração](#20-referência-de-configuração)

---

## 1. Visão de Produto

### O problema que o AURA resolve

Squads de desenvolvimento gastam horas em trabalho repetitivo e de coordenação: refinamento de requisitos, decisões de arquitetura, abertura de PRs, revisão de segurança, validação de qualidade. Cada uma dessas atividades tem um protocolo conhecido — mas seguir o protocolo consistentemente, para todos os cards, é humanamente caro.

O AURA automatiza esse protocolo. Cada card que entra no board passa por agentes de IA especializados, cada um com um papel bem definido, que produzem análises, tomam decisões, commitam código e registram evidências — tudo rastreável no próprio Jira.

### O que o AURA **não é**

- **Não é um chatbot.** Não há interface de conversa com o AURA. O sistema trabalha de forma autônoma, monitorando o board e executando os agentes sem que ninguém precise pedir.
- **Não substitui o time humano.** Bloqueia e aguarda aprovação quando encontra decisões fora da autoridade dos agentes — ambiguidade de requisito, risco de segurança sem aceite, ausência de informação.
- **Não é um sistema de CI/CD.** Integra com a CI existente (GitHub Actions, GitLab CI), monitora o resultado e tenta corrigir falhas automaticamente até 3 vezes antes de escalar.

### Como o time interage com o AURA

A interação acontece **diretamente nos comentários do card no Jira**. Quando o pipeline está aguardando intervenção (`waiting_input`), qualquer membro do time pode comentar:

| Comentário no card | O que acontece |
|---|---|
| `@pipeline reprocessar` | Reexecuta a etapa atual, com o motivo do bloqueio injetado no prompt |
| `@pipeline reprocessar tudo` | Reinicia o pipeline do início |
| `@pipeline avançar` | Força avanço para a próxima etapa (ignora bloqueio de gate) |
| `@pipeline cancelar` | Cancela o run permanentemente |
| `@pipeline explique o bloqueio` | Instrução livre — o agente da coluna responde |
| `@nomeDoAgente revise o critério X` | Direciona a instrução para um agente específico pelo nome |
| Qualquer comentário sem `@` | Encaminhado como contexto para o agente da coluna atual |

O AURA lê comentários novos a cada 10 segundos (mesmo polling interval do pipeline). Comentários do próprio bot são identificados por um ID externo e ignorados para evitar loops.

### Fluxo de valor simplificado

```
PO cria card no Jira
        ↓
AURA detecta (polling 10s)
        ↓
Orchestrator valida Definition of Ready
        ↓
BA refina requisitos → ANALYSIS: READY
        ↓
Arquiteto decide solução técnica → ARCHITECTURE: APPROVED
        ↓
Developer implementa, commita, abre PR → IMPLEMENTATION: READY_FOR_REVIEW
        ↓
CI roda — AURA monitora e corrige falhas automaticamente
        ↓
QA valida → VERDICT: APPROVED
        ↓
Security revisa → SECURITY: APPROVED
        ↓
DevOps faz deploy → RELEASE: SUCCESS
        ↓
Card movido para Done, conhecimento gravado no Second Brain (se configurado)
```

---

## 2. Conceitos Fundamentais

### Workspace

Unidade de isolamento. Cada time / produto tem um workspace. Usuários, agentes, pipelines e tasks pertencem a um workspace. Worksaces pertencem a um tenant.

### Pipeline

Configuração da esteira de um workspace. Define:
- O provedor de board (Jira ou Azure DevOps)
- As colunas (estágios) em ordem
- Qual coluna é o gatilho (trigger column)
- Quais agentes executam em cada coluna

### Coluna (Stage)

Cada coluna do pipeline mapeia para um status do Jira. Quando o AURA move um card para a coluna, ele executa os agentes atribuídos a ela, na ordem configurada.

Uma coluna pode ter:
- Nenhum agente → pausa e aguarda ação manual
- Um agente → executa e avança
- Múltiplos agentes → executa em sequência, cada um vê o output dos anteriores

### Agente

Um agente é uma entidade com:
- **Nome** — como aparece nos comentários do Jira
- **Role** — o papel (developer, qa engineer, software architect, etc.)
- **Soul** — instrução base de personalidade (soul_content no banco)
- **Skill** — arquivo SKILL.md com o protocolo do papel
- **Harness** — arquivo harness.json com regras de validação do output
- **Modelo** — qual LLM usar (claude, gpt-4o, gemini, ollama, etc.)

### Gate

Toda skill define um token obrigatório no output. O harness verifica se o token está presente antes de avançar o card. Exemplos:
- BA → `ANALYSIS: READY`
- Arquiteto → `ARCHITECTURE: APPROVED`
- Developer → `IMPLEMENTATION: READY_FOR_REVIEW`
- QA → `VERDICT: APPROVED`

Se o gate estiver ausente ou for `BLOCKED`, o pipeline para e aguarda intervenção humana.

### Run

Uma execução de um card na esteira. Fica registrada na tabela `pipeline_card_runs`. Cada mensagem trocada entre o pipeline e o card fica em `pipeline_card_messages`. O histórico de decisões de cada agente fica em `context_summary_json`.

---

## 3. Arquitetura Geral

O AURA é uma aplicação **Next.js 16 monolítica** — o frontend (React 19), o backend (API Routes) e o motor de pipeline rodam no mesmo processo Node.js.

Não há worker separado. O motor do pipeline roda dentro do processo do Next.js, acionado pelo scheduler interno a cada 10 segundos.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Process                          │
│                                                                 │
│  ┌──────────────┐    ┌────────────────┐    ┌────────────────┐  │
│  │   React UI   │    │   API Routes   │    │   Scheduler    │  │
│  │  (App Router)│◄──►│  /api/**       │    │  (setInterval) │  │
│  └──────────────┘    └───────┬────────┘    └───────┬────────┘  │
│         ▲                    │                      │           │
│         │ SSE                │                      │ 10s tick  │
│         │            ┌───────▼──────────────────────▼────────┐ │
│         └────────────│          Pipeline Engine              │ │
│                      │   discoverNewCards() → startColumn()  │ │
│                      └───────────────────┬───────────────────┘ │
│                                          │                      │
└──────────────────────────────────────────┼─────────────────────┘
                                           │
              ┌────────────────────────────┼──────────────────────┐
              │                            │                      │
              ▼                            ▼                      ▼
        ┌──────────┐               ┌──────────────┐        ┌──────────┐
        │  MySQL   │               │  Jira /      │        │  LLM API │
        │  (RDS /  │               │  Azure DevOps│        │ Anthropic│
        │  Aurora) │               └──────────────┘        │ OpenAI   │
        └──────────┘                                        │ Gemini   │
                                                            │ Ollama   │
                                                            └──────────┘
```

### Fluxo de dados de alto nível

O diagrama abaixo mostra o caminho completo de um card desde a detecção no Jira até o merge e o card movido para Done. Cada passo é executado pelo processo Node.js do AURA sem intervenção humana, exceto quando um gate retorna BLOCKED.

```
Jira                    Scheduler (10s)         Pipeline Engine          LLM API            GitHub
 │                           │                        │                    │                   │
 │  Card entra em            │                        │                    │                   │
 │  "Para fazer"             │                        │                    │                   │
 │                           │  tickPipelineEngine()  │                    │                   │
 │                           │───────────────────────►│                    │                   │
 │                           │                        │                    │                   │
 │◄───────────────────────────────────────────────────│ GET /search/jql    │                   │
 │  [{ key, title, desc }] ──────────────────────────►│                    │                   │
 │                           │                        │                    │                   │
 │                           │                INSERT pipeline_card_runs    │                   │
 │                           │                        │                    │                   │
 │                           │              startColumn(run, col_1)        │                   │
 │                           │                        │                    │                   │
 │                           │           ┌── Monta prompt completo ──┐    │                   │
 │                           │           │ 1. fetchRepoContext()     │    │                   │
 │                           │           │    → Git tree + src files  │    │                   │
 │                           │           │ 2. context_summary_json   │    │                   │
 │                           │           │    (decisões anteriores)   │    │                   │
 │                           │           │ 3. correctionContext       │    │                   │
 │                           │           │    (rejeição harness)      │    │                   │
 │                           │           │ 4. searchKnowledge()      │    │                   │
 │                           │           │    → Second Brain          │    │                   │
 │                           │           │ 5. buildKnowledgeContext() │    │                   │
 │                           │           │    → Jira/Miro/Confluence  │    │                   │
 │                           │           │ 6. describeAttachmentImages│    │                   │
 │                           │           │    → imagens do card       │    │                   │
 │                           │           │ 7. loadAgentSkills()       │    │                   │
 │                           │           │    → SKILL.md do disco     │    │                   │
 │                           │           │ 8. agentSystemPrompt()     │    │                   │
 │                           │           │    → soul + persona + skills│    │                   │
 │                           │           └───────────────────────────┘    │                   │
 │                           │                        │                    │                   │
 │                           │                        │ POST /v1/messages  │                   │
 │                           │                        │───────────────────►│                   │
 │                           │                        │  { system, user }  │                   │
 │                           │                        │◄───────────────────│                   │
 │                           │                        │   LLM output       │                   │
 │                           │                        │                    │                   │
 │                           │           validateAgentOutput() (harness)   │                   │
 │                           │                        │                    │                   │
 │                  OK?      │                        │                    │                   │
 │ ◄──── NÃO ────────────────────────────────────────│                    │                   │
 │  🛑 Intervenção humana    │           waiting_input│                    │                   │
 │                           │                        │                    │                   │
 │                           │                   SIM  │                    │                   │
 │◄───────────────────────────────────────────────────│ POST /comment (ADF)│                   │
 │  🤖 Agente postou output  │                        │                    │                   │
 │                           │                        │                    │                   │
 │                           │           appendContextSummary()            │                   │
 │                           │           INSERT pipeline_quality_metrics   │                   │
 │                           │           INSERT token_usage                │                   │
 │                           │                        │                    │                   │
 │  (se Developer gerou      │              extractFilesFromLLMOutput()    │                   │
 │   ### FILE: blocks)       │                        │───────────────────────────────────────►│
 │                           │                        │  PUT /contents/*   │  commits na branch│
 │                           │                        │◄───────────────────────────────────────│
 │                           │                        │  POST /pulls       │                   │
 │                           │                        │───────────────────────────────────────►│
 │                           │                        │  PR #42 aberto     │                   │
 │                           │                        │◄───────────────────────────────────────│
 │                           │                        │  pr_check_json salvo                   │
 │                           │                        │                    │                   │
 │  (próximo tick)            │   checkAndAdvancePRCI()│                    │                   │
 │                           │◄───────────────────────────────────────────────────────────────│
 │                           │                        │ GET /check-runs    │  CI passou ✅      │
 │                           │                        │                    │                   │
 │◄───────────────────────────────────────────────────│ POST /transitions  │                   │
 │  Card movido → próxima    │                        │  → "QA"            │                   │
 │  coluna                   │                        │                    │                   │
```

#### Detalhamento dos 8 contextos montados no prompt

Antes de chamar o LLM, `startColumn()` monta o prompt em camadas. A ordem importa — contextos mais específicos ficam mais próximos da instrução final:

| Ordem | Função | O que injeta | Para quais roles |
|---|---|---|---|
| 1 | `outputParts` (memória da coluna) | Outputs dos outros agentes já executados na mesma coluna | Todos |
| 2 | `formatContextSummary()` | Gates emitidos por cada agente em etapas anteriores (`ANALYSIS: READY`, `ARCHITECTURE: APPROVED`...) | Todos |
| 3 | `correctionContext` | Motivo da última rejeição do harness para este agente nesta etapa | Todos (quando há rejeição anterior) |
| 4 | `searchKnowledge()` | Cards anteriores do mesmo domínio de negócio (Second Brain) | BA, PM, PO |
| 5 | `buildKnowledgeContext()` | Conteúdo de Jira histórico, Miro, Confluence, SharePoint (URLs na skill) | BA, PM, PO, Arquiteto, UX, Discovery |
| 6 | `describeAttachmentImages()` | Descrição textual de wireframes/screenshots do card | Developer, BA, UX |
| 7 | `fetchRepoContext()` | Árvore de arquivos + código-fonte do(s) repositório(s) Git | Todos com repo vinculado |
| 8 | `buildPrompt()` | Card (key, título, descrição, URL), instrução do agente, instrução da coluna | Todos |

---

## 4. Stack Tecnológica

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework web | Next.js | 16.2.10 |
| Runtime | Node.js | ≥ 22 |
| Linguagem | TypeScript | 5.9.3 |
| Gerenciador de pacotes | pnpm | 11.15.1 |
| Banco de dados | MySQL / Aurora MySQL | 8.0 |
| Driver MySQL | mysql2 | 3.14.2 |
| UI | React | 19.2.7 |
| Estado global | Zustand | 5.0.14 |
| Visualização de fluxo | @xyflow/react | 12.11.2 |
| Gráficos | Recharts | 3.9.2 |
| Internacionalização | next-intl | 4.13.2 |
| Estilo | Tailwind CSS | 3.4.19 |
| Validação de schema | Zod | 4.4.3 |
| Logging | Pino | 10.3.1 |
| WebSocket | ws | 8.21.1 |
| Testes unitários | Vitest | 2 |
| Testes E2E | Playwright | 1.61.1 |

### Por que Next.js monolítico?

A escolha elimina a necessidade de um processo worker separado para o pipeline. O scheduler roda dentro do processo do Next.js usando `setInterval`. Isso simplifica o deploy — um único container Docker serve o frontend, as APIs e o motor do pipeline.

A desvantagem é que uma chamada LLM lenta (até 90s de timeout) bloqueia o tick do scheduler para aquele pipeline. O flag `_running` garante que apenas um tick de processamento rode por vez, mas a descoberta de novos cards acontece sempre.

---

## 5. Banco de Dados

O AURA usa **MySQL 8.0** (compatível com Aurora MySQL). O schema completo está em `src/lib/schema-mysql.sql`. Migrations incrementais são aplicadas por `src/lib/migrations-mysql.ts` na inicialização do servidor.

### Tabelas do Pipeline

#### `pipeline_card_runs`
Registra cada execução de um card na esteira.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | INT PK | ID interno |
| `workspace_id` | INT | Workspace dono do run |
| `provider` | VARCHAR | `'jira'` ou `'azure_devops'` |
| `card_key` | VARCHAR | Ex: `PROJ-123` |
| `card_title` | VARCHAR | Título do card no momento da detecção |
| `card_description` | TEXT | Descrição do card (até 4000 chars) |
| `current_stage_id` | VARCHAR | ID da `pipeline_columns` atual |
| `status` | VARCHAR | `running`, `waiting_input`, `done`, `cancelled`, `failed` |
| `task_id` | INT | ID da task criada para este run (se aplicável) |
| `last_comment_ts` | INT | Timestamp do último comentário lido (em segundos) |
| `cost_usd` | DOUBLE | Custo total acumulado em USD |
| `run_count` | INT | Número de vezes que a etapa foi reprocessada |
| `pr_check_json` | TEXT | JSON com info do PR para polling de CI |
| `pr_review_json` | TEXT | JSON com info do PR para polling de aprovação humana |
| `context_summary_json` | TEXT | JSON com decisões de cada agente (para injetar no prompt) |
| `stage_snapshots_json` | TEXT | Snapshots de estado para rollback |

#### `pipeline_card_messages`
Histórico de todas as mensagens trocadas no card.

| Campo | Tipo | Descrição |
|---|---|---|
| `run_id` | INT | FK para `pipeline_card_runs` |
| `direction` | VARCHAR | `'agent_to_card'` ou `'card_to_agent'` |
| `stage_id` | VARCHAR | ID da coluna onde a mensagem aconteceu |
| `body` | TEXT | Conteúdo da mensagem |
| `external_comment_id` | VARCHAR | ID do comentário no Jira/Azure (para deduplicação) |

#### `pipeline_columns`
Configuração das colunas de um pipeline.

| Campo | Tipo | Descrição |
|---|---|---|
| `pipeline_id` | INT | FK para `work_pipelines` |
| `column_name` | VARCHAR | Nome que deve bater com o status no Jira |
| `column_order` | INT | Ordem de execução |
| `is_trigger` | TINYINT | 1 = coluna gatilho (onde o pipeline começa) |
| `instructions` | TEXT | Instrução livre que vai no prompt de todos os agentes da coluna |
| `assignments_json` | TEXT | JSON array com `[{ agent_id, role, order, llm_model, repo_id }]` |
| `requires_human_approval` | TINYINT | 1 = pausa e aguarda aprovação antes de executar |

#### `agents`
Cadastro de agentes.

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | VARCHAR | Nome único por workspace |
| `role` | TEXT | Papel (developer, qa engineer, etc.) |
| `soul_content` | TEXT | Instrução base de personalidade (system prompt) |
| `model` | VARCHAR | Modelo padrão (ex: `claude-sonnet-4-6`) |
| `instructions` | TEXT | Instrução adicional (legado, substituído pelo soul_content) |
| `config` | TEXT | JSON com persona, tools, sandbox, collaborators |
| `status` | VARCHAR | `idle`, `busy`, `offline` |

#### `skills`
Skills sincronizadas do disco para o banco.

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | VARCHAR | Nome da skill (ex: `swe-business-analysis`) |
| `source` | VARCHAR | Origem (`workspace`, `gateway`, `user-agents`) |
| `path` | TEXT | Caminho absoluto do diretório no disco |
| `content_hash` | VARCHAR | SHA256 do SKILL.md (para detectar mudanças) |

---

## 6. Como um Agente é Criado

Um agente no AURA não é apenas um registro no banco. É uma entidade com identidade, personalidade, habilidades e modelo de linguagem que, quando acionada pelo pipeline, monta um prompt especializado, chama o LLM e produz output rastreável.

### As três origens de um agente

O campo `source` na tabela `agents` indica como ele chegou ao sistema:

| source | Origem | Como é criado |
|---|---|---|
| `manual` | UI do AURA | Via formulário em **Agentes** → botão novo agente |
| `gateway` | Processo externo (Gateway daemon) | O Gateway faz heartbeat para `POST /api/gateways` e registra/atualiza agentes automaticamente |
| `local` | Disco local | `local-agent-sync.ts` escaneia `~/.agents/` e `~/.claude/agents/` a cada 10s |

Para o pipeline de cards (o uso principal do AURA), os agentes são criados manualmente pela UI ou importados do Gateway. A origem `local` serve para integração com o ecossistema Claude local.

### Como um agente é criado via UI

```
Painel "Agentes" → botão "+ Novo Agente"
  │
  ▼
POST /api/agents
  Body: {
    name:         "Ana Flávia",
    role:         "business analyst",
    soul_content: "Você é Ana Flávia, BA sênior...",
    model:        "anthropic:claude-sonnet-4-6",
    instructions: "(opcional — complementa o soul_content)",
    template:     "(opcional — preenche config automaticamente)"
  }
  │
  ▼ src/app/api/agents/route.ts
  → requireRole(request, 'operator')   ← requer papel operator ou admin
  → validateBody(createAgentSchema)     ← validação Zod
  → createMcAgent(ctx, body)
  │
  ▼ src/lib/create-mc-agent.ts
  → Se template: getTemplate() + buildAgentConfig()
    (preenche persona, sandbox, tools, collaborators adequados ao papel)
  → SELECT id FROM agents WHERE name = ? AND workspace_id = ?
    (verifica unicidade — nome único por workspace)
  → INSERT INTO agents (name, role, soul_content, model, config, workspace_id, ...)
  → eventBus.broadcast('agent.created', agent)
    (notifica o frontend em tempo real via SSE)
  → Opcional: writeAgentToConfig()
    (persiste no arquivo de config do Gateway se GATEWAY_CONFIG_PATH configurado)
```

### O que compõe um agente tecnicamente

```
┌────────────────────────────────────────────────────────────────────┐
│ Agente (linha na tabela `agents`)                                  │
│                                                                    │
│  name: "Ana Flávia"          ← aparece nos comentários do Jira    │
│  role: "business analyst"    ← define a skill e o harness         │
│  model: "anthropic:claude-sonnet-4-6"  ← LLM padrão              │
│  status: idle/busy/offline   ← atualizado pelo pipeline           │
│                                                                    │
│  soul_content:               ← SYSTEM PROMPT (layer 1)            │
│   "Você é Ana Flávia, BA sênior especializada em pagamentos..."   │
│                                                                    │
│  config (JSON):              ← SYSTEM PROMPT (layers 2-5)         │
│  {                                                                 │
│    "persona": {                                                    │
│      "authority_level": "Pode bloquear cards sem BA aprovado",    │
│      "restrictions": ["Nunca inventa regras de negócio"],         │
│      "capabilities": ["Lê Jira", "Consulta Confluence"],          │
│      "collaborators": ["Carlos (arquiteto)", "Roberto (dev)"]     │
│    },                                                              │
│    "model": { "primary": "claude-sonnet-4-6", "fallbacks": [] }, │
│    "identity": { "theme": "business analyst", "emoji": "📊" },   │
│    "tools": { "allow": ["read_file", "bash"], "deny": [] },       │
│    "sandbox": { "mode": "docker", "workspaceAccess": "read" }    │
│  }                                                                 │
└────────────────────────────────────────────────────────────────────┘
```

### Como o system prompt é montado quando o agente executa

A função `agentSystemPrompt(agent)` em `pipeline-engine.ts` combina todos os layers:

```
LAYER 1: soul_content
  "Você é Ana Flávia, BA sênior especializada em pagamentos..."

LAYER 2: Nível de autoridade (persona.authority_level)
  "Pode bloquear cards sem BA aprovado, pode redirecionar para PM..."

LAYER 3: Restrições (persona.restrictions)
  "- Nunca inventa regras de negócio
   - Sempre consulta o Jira antes de bloquear
   ..."

LAYER 4: Capacidades (persona.capabilities)
  "- Lê Jira e épicos relacionados
   - Consulta Confluence via Knowledge Context
   ..."

LAYER 5: Colaboradores (persona.collaborators)
  "Carlos (software architect), Roberto (developer)..."

LAYER 6: Skills (agent._skills — injetado pelo pipeline antes da chamada)
  "### Skill: swe-business-analysis
   # Refinar requisitos de negócio
   ## Missão: Transformar o problema aprovado em comportamento implementável...
   ...
   ### Skill: swe-software-architecture
   ..."
```

A skill é lida do disco (`SKILL.md`) a cada execução e injetada como layer 6. Isso significa que editar o `SKILL.md` de um agente via UI tem efeito imediato na próxima execução — sem restart.

### Como criar um agente via UI — passo a passo

1. Acesse o AURA → painel **Agentes** (ícone de pessoas na barra lateral)
2. Clique em **+ Novo Agente**
3. Preencha:
   - **Nome**: nome que aparecerá nos comentários do Jira (ex: `Ana Flávia`)
   - **Role**: papel que define qual skill será usada (ex: `business analyst`)
   - **Soul**: instrução de personalidade — quem é este agente, seus valores, tom de voz
   - **Modelo**: selecione o LLM (ex: `anthropic:claude-sonnet-4-6`) ou deixe no padrão do pipeline
4. Clique em **Salvar**
5. Vá para o painel **Work Pipeline** → edite a coluna desejada → adicione o agente
6. Defina a **ordem de execução** (número) e o **modelo por coluna** (opcional — sobrescreve o modelo padrão do agente)

---

## 7. Skills — O Cérebro dos Agentes

A skill define **o que o agente faz e como ele faz**. É um arquivo Markdown (`SKILL.md`) com o protocolo completo do papel: missão, processo, comunicação obrigatória, gates, antipadrões e saída esperada.

### Onde editar uma skill na UI

1. Acesse **Agentes** → clique no agente desejado → aba **Skill**
2. O conteúdo do `SKILL.md` aparece editável no painel
3. Há também o campo **Soul** (personalidade) na mesma aba
4. Após editar, clique em **Salvar** — a mudança é gravada no arquivo físico em disco
5. Na próxima execução do agente (próximo card), a skill atualizada já será usada

O mesmo painel exibe o `harness.json` editável — o arquivo que define as regras de validação do output desse agente.

### Estrutura física no disco

```
skills/
├── swe-business-analysis/
│   ├── SKILL.md        ← Instrução do papel (injetada no system prompt)
│   └── harness.json    ← Regras de validação do output
├── swe-software-architecture/
│   ├── SKILL.md
│   └── harness.json
├── swe-implementation-practices/
│   ├── SKILL.md        (1508 linhas — a mais extensa)
│   └── harness.json
└── ... (13 skills no total)
```

### Ciclo de vida: disco → banco → system prompt

```
┌──────────────────────────────────────────────────────┐
│  SKILL.md no disco                                   │
│  (editado via painel Agentes → aba Skill, ou direto  │
│   no arquivo em skills/{nome}/SKILL.md)              │
└──────────────────────┬───────────────────────────────┘
                       │
                       │  scheduler: syncSkillsFromDisk() a cada 10s
                       │  src/lib/skill-sync.ts
                       │  → Calcula SHA256 do arquivo
                       │  → UPDATE skills SET content_hash = ? WHERE name = ?
                       ▼
┌──────────────────────────────────────────────────────┐
│  Tabela `skills` no banco MySQL                      │
│  (name, path, content_hash, source, description)     │
└──────────────────────┬───────────────────────────────┘
                       │
                       │  loadAgentSkills() em pipeline-engine.ts
                       │  → SELECT name, path FROM skills
                       │  → readFileSync(join(path, 'SKILL.md'))
                       │  → Concatena todos os SKILL.md como um bloco
                       │  → Cache de 30s em memória
                       ▼
┌──────────────────────────────────────────────────────┐
│  agent._skills (string em memória)                   │
│  "### Skill: swe-business-analysis\n# Refinar...\n  │
│   ### Skill: swe-software-architecture\n..."         │
└──────────────────────┬───────────────────────────────┘
                       │
                       │  agentSystemPrompt(agent)
                       │  → Adiciona como LAYER 6 do system prompt
                       ▼
┌──────────────────────────────────────────────────────┐
│  System Prompt enviado ao LLM                        │
│  (soul_content + persona + skills de todos os papéis)│
└──────────────────────────────────────────────────────┘
```

> **Nota importante:** todas as skills são injetadas no system prompt de todos os agentes. O agente não recebe apenas a skill do seu papel — ele recebe o conjunto completo. Isso é intencional: permite que um BA, por exemplo, entenda o que o Developer espera receber para colaborar melhor.

### harness.json — regras de qualidade

Cada skill tem um `harness.json` no mesmo diretório:

```json
{
  "description": "Business Analyst — análise de requisitos de negócio",
  "min_response_length": 200,
  "gate_pattern": "ANALYSIS\\s*:\\s*(?:READY|BLOCKED|NOT_APPLICABLE)",
  "is_coordination_role": false
}
```

| Campo | Descrição |
|---|---|
| `min_response_length` | Mínimo de caracteres na resposta — abaixo disso, harness bloqueia |
| `gate_pattern` | Regex do token obrigatório que deve aparecer no output |
| `is_coordination_role` | Se `true`, bloqueia qualquer `### FILE:` ou `OPEN_PR: true` no output |

O `harness.json` também é editável via painel Agentes → aba Skill.

---

## 8. O Motor do Pipeline

O coração do AURA. Arquivo: `src/lib/pipeline-engine.ts` (~4500 linhas).

### Ciclo de execução (10 segundos)

```
scheduler.ts: setInterval(tick, 10_000)
                     │
                     ▼
tickPipelineEngine()
  │
  ├─ Cancela runs travados em 'running' por > 2h
  ├─ Cancela runs em 'waiting_input' com PR por > 7 dias
  │
  ├─ getActivePipelines()  ← SELECT * FROM work_pipelines WHERE enabled = 1
  │
  ├─ Para cada pipeline:
  │    discoverNewCards()  ← Busca cards na coluna trigger do Jira/Azure
  │
  └─ Se não está rodando (_running = false):
       Para cada pipeline:
         checkRunningRuns()  ← Processa runs ativas (comments, CI polling)
```

### `discoverNewCards(pipeline)`

```
1. Identifica trigger column (is_trigger = 1)
2. fetchJiraIssuesByStatus(cfg, secrets, triggerColumn.column_name)
   → GET /rest/api/3/search/jql?jql=project=KEY AND status in (statusId)
3. Para cada card retornado:
   a. Verifica se já existe run ativa no banco
      SELECT id, status FROM pipeline_card_runs
      WHERE card_key = ? AND status NOT IN ('done','cancelled','failed','waiting_input')
   b. Se não existe: upsertRun() → INSERT INTO pipeline_card_runs
   c. startColumn(run, firstColumnWithAgents, cfg, secrets)
```

### `startColumn(run, column, cfg, secrets)`

Esta é a função mais complexa do sistema. Executa todos os agentes de uma coluna em sequência:

```
1. Guard: run_count > 10? Cancela com mensagem
2. Carrega assignments (agentes da coluna) ordenados por `order`
3. Identifica agentes já concluídos (via pipeline_card_messages)
4. Para cada agente pendente:
   a. Busca motivo de rejeição anterior (pipeline_quality_metrics)
   b. Carrega skills via loadAgentSkills()
   c. Injeta contexto do Second Brain (BA, PM, PO)
   d. Injeta Knowledge Context (Jira histórico, Miro, Confluence, SharePoint)
   e. Injeta contexto visual (imagens do card)
   f. Resolve repositório ativo (assignment.repo_id > linkedRepoIds > workspace)
   g. Monta prompt = contextSoFar + contextSummary + correctionContext
                   + secondBrainContext + knowledgeContext + visualContext
                   + buildPrompt(run, column, previousMessages, ...)
   h. callAgentLLM(agent, prompt, cfg, model)
      → Determina provider pelo modelo
      → Chama callAnthropicLLM() / callGeminiLLM() / callOpenAICompatLLM() / callOllamaLLM()
   i. validateAgentOutput(llmResult.text, { agentRole, cardKey, hasRepo, skillPath })
      → Se BLOCKED: posta mensagem no Jira, status = waiting_input, RETURN
      → Se OK: continua
   j. appendContextSummary() → atualiza context_summary_json no run
   k. pushFilesToRepos() se há FILE: blocks e tem repositório
   l. runSandboxTests() se há TEST_CMD:
   m. openPR() se há OPEN_PR: true
   n. outputParts.push(agentOutput) para passar contexto ao próximo agente

5. Após todos os agentes:
   a. Verifica gate BLOCKED nos outputParts
      → Se BLOCKED: posta mensagem, status = waiting_input, RETURN
   b. Se QA reprovado (REPROVADO no output): volta para coluna developer
   c. advanceToNextColumn() → transitionJiraIssue() + startColumn() próxima coluna
```

### Montagem do Prompt

O user prompt é construído por `buildPrompt()` com as seguintes seções, em ordem:

```
## Outputs anteriores nesta etapa
(output dos agentes anteriores da mesma coluna)

## Histórico de decisões deste card
(context_summary_json: gates emitidos por cada agente em etapas anteriores)

## ⚠️ Contexto de rejeição anterior
(se o agente foi bloqueado pelo harness na tentativa anterior)

## Conhecimento do Second Brain
(aprendizados de cards anteriores do mesmo domínio)

## 📚 Contexto de conhecimento externo
(Jira histórico, Miro, Confluence, SharePoint — se configurados na skill)

## 🖼️ Contexto visual
(descrição de imagens/wireframes anexados ao card)

# Card: PROJ-123 — Título do card
URL: https://...

## Descrição do card
(descrição completa)

Você é **Ana Flávia**, business analyst.

## Contexto dos agentes anteriores
(últimas 3 mensagens agent_to_card)

[contexto do repositório — tree de arquivos e arquivos relevantes]

[instrução de formato de entrega de código — ### FILE:, COMMIT:, OPEN_PR:]

## Suas instruções
(column.instructions — com marcação "prioridade absoluta")
```

O **system prompt** é separado e construído por `agentSystemPrompt()`:

```
{soul_content do agente}

## Nível de autoridade
{persona.authority_level}

## Restrições
{persona.restrictions}

## Capacidades
{persona.capabilities}

## Agentes colaboradores
{persona.collaborators}

## Suas skills

### Skill: swe-business-analysis
{conteúdo completo do SKILL.md}

### Skill: swe-software-architecture
{conteúdo completo do SKILL.md}

... (todas as skills)
```

---

## 9. Integração com Jira

Arquivo: `src/lib/work-pipeline-jira.ts`

### Autenticação

```
HTTP Basic Auth: base64(jiraAccountEmail:jiraApiToken)
Header: Authorization: Basic <base64>
```

Credenciais armazenadas em `work_pipelines.secret_blob` (criptografado com AES-256-GCM, chave derivada de `SECRET_KEY` do ambiente).

### Busca de cards (polling)

```typescript
// 1. Resolve o ID do status pelo nome da coluna
GET /rest/api/3/project/{projectKey}/statuses

// 2. Busca cards naquele status
GET /rest/api/3/search/jql?jql=project={KEY} AND status in ({statusId})
                            &maxResults=50
                            &fields=summary,description,status,issuetype
```

### Movimentação de card entre colunas

```typescript
// 1. Lista transições disponíveis
GET /rest/api/3/issue/{issueKey}/transitions

// 2. Encontra a transição pelo nome (case-insensitive)
// 3. Executa a transição
POST /rest/api/3/issue/{issueKey}/transitions
Body: { "transition": { "id": "123" } }
```

### Postagem de comentário

O AURA usa o formato **ADF (Atlassian Document Format)** para comentários:

```typescript
POST /rest/api/3/issue/{issueKey}/comment
Body: {
  "body": {
    "version": 1,
    "type": "doc",
    "content": [{
      "type": "paragraph",
      "content": [{ "type": "text", "text": "🤖 **Ana Flávia** ..." }]
    }]
  }
}
```

### Leitura de comentários novos e interação humana

O AURA lê comentários novos do card a cada 10 segundos via `processInboundComments()`. A leitura filtra pelo `last_comment_ts` para não processar o mesmo comentário duas vezes. Comentários gerados pelo próprio AURA são identificados pelo `external_comment_id` armazenado em `pipeline_card_messages` e ignorados para evitar loops.

```typescript
GET /rest/api/3/issue/{issueKey}/comment?orderBy=created&maxResults=50
// Filtra: comment.createdMs > run.last_comment_ts * 1000
// Deduplicação: SELECT 1 FROM pipeline_card_messages WHERE external_comment_id = ?
```

O sistema reconhece os seguintes padrões (configurável via `cfg.botMention`, padrão `@pipeline`):

```
@pipeline reprocessar       → reexecuta etapa atual (com contexto do erro anterior no prompt)
@pipeline reprocessar tudo  → reinicia o pipeline do início
@pipeline avançar           → força avanço de etapa (ignora gate BLOCKED)
@pipeline cancelar          → cancela o run
@pipeline <instrução livre> → executa com o primeiro agente da coluna
@nomeDoAgente <instrução>   → direciona para agente específico pelo nome
(comentário sem @)          → encaminhado como contexto para o agente da coluna
```

### Leitura de imagens anexadas (Screenshot-to-Code)

```typescript
GET /rest/api/3/issue/{issueKey}?fields=attachment
// Filtra: mimeType em {image/png, image/jpeg, image/gif, image/webp}
// Limite: até 3 imagens por execução, máximo 10MB cada
// Baixa como base64 → descreve via LLM configurado na coluna → injeta no prompt
```

Detalhes na seção [Screenshot-to-Code](#screenshot-to-code--imagens-do-card).

---

## 10. Integração com GitHub / GitLab

### GitHub — Commit e PR

**Arquivo:** `src/lib/pipeline-engine.ts` — funções `pushCodeToGitHub()` e `openPullRequest()`

**Formato de código no output do LLM:**

```
### FILE: src/services/UserService.ts
```typescript
export class UserService {
  // conteúdo completo
}
```
COMMIT: feat(auth): implement user authentication service
OPEN_PR: true
```

**Fluxo de push:**

```
1. extractFilesFromLLMOutput(llmText)
   → Regex: /###\s*(?:FILE|ARQUIVO):\s*([^\n]+)\n```[^\n]*\n([\s\S]*?)```/gi
   → Para multi-repo: extrai prefixo [nome-do-repo]:

2. toBranchSlug(cardKey, cardTitle)
   → "PROJ-123" + "Implement user auth" → "feat/proj-123-implement-user-auth"

3. pushCodeToGitHub(repoId, cardKey, cardTitle, llmOutput):
   a. GET /api.github.com/repos/{owner}/{repo}/git/ref/heads/{baseBranch}
      → SHA do commit base
   b. POST /api.github.com/repos/{owner}/{repo}/git/refs
      → Cria branch "feat/proj-123-..."
   c. Para cada arquivo:
      PUT /api.github.com/repos/{owner}/{repo}/contents/{path}
      Body: { message, content: base64(conteúdo), branch, sha? }
      → sha: necessário se o arquivo já existe (para update)

4. openPullRequest(repoId, cardKey, cardTitle, llmOutput):
   a. GET .../pulls?head={branch}&state=open  (evita PR duplicado)
   b. POST .../pulls
      Body: { title: "feat(proj-123): ...", body: "...", head: branch, base: "main" }
```

### GitLab — Commit e MR

**Arquivo:** `src/lib/pipeline-engine.ts` — funções `pushCodeToGitLab()` e `openMergeRequestGitLab()`

```
1. Verifica/cria branch:
   POST /api/v4/projects/{id}/repository/branches
   Body: { branch: "feat/proj-123-...", ref: "main" }
   Auth: Header PRIVATE-TOKEN: {token}

2. Commit com múltiplos arquivos:
   POST /api/v4/projects/{id}/repository/commits
   Body: {
     branch: "feat/...",
     commit_message: "feat(proj-123): ...",
     actions: [
       { action: "create"|"update", file_path: "...", content: base64, encoding: "base64" }
     ]
   }

3. Abre MR:
   POST /api/v4/projects/{id}/merge_requests
   Body: { source_branch: "feat/...", target_branch: "main", title: "...", description: "..." }
```

### Screenshot-to-Code — Imagens do Card

Quando um card do Jira ou Azure DevOps tem wireframes ou screenshots anexados, o AURA os processa automaticamente para o Developer e o BA antes de executar.

**Função:** `describeAttachmentImages()` em `pipeline-engine.ts`

**Nenhum provider ou modelo é hardcoded.** A função usa exatamente o mesmo mecanismo de `resolveProviderAndModel(cfg, assignmentModel, 'simple')` que qualquer outra chamada do pipeline — o LLM que descreve as imagens é o mesmo configurado para o agente na coluna.

```
Fluxo:
1. fetchJiraAttachments() → GET /issue/{key}?fields=attachment
   → Filtra: image/png, image/jpeg, image/gif, image/webp, image/svg+xml
   → Limite: até 3 imagens, máx 10MB cada

2. Resolve provider/modelo via resolveProviderAndModel(cfg, assignmentModel, 'simple')
   (o mesmo modelo do agente que está executando — sem hardcode)

3. Para cada imagem:
   a. downloadJiraAttachment() → base64
   b. Monta prompt de visão: "Descreva esta imagem de UI/wireframe..."
   c. Chama o LLM com a imagem no formato do provider:
      - Anthropic: { type: "image", source: { type: "base64", media_type, data } }
      - OpenAI/OpenRouter: { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
      - Gemini: { inline_data: { mime_type, data } }
      - Venice/NVIDIA/etc (sem suporte nativo a visão):
        → Não envia a imagem, lista o nome do arquivo para análise manual

4. Resultado injetado no prompt do agente como:
   ## 🖼️ Contexto visual
   ### nome-do-arquivo.png
   *Fonte: Jira — PROJ-123*
   Layout: header com navegação lateral...
   Componentes: formulário com 3 campos...
```

Roles que recebem contexto visual: `developer`, `business analyst`, `frontend`, `fullstack`, `ui`, `ux`.

### CI Polling (GitHub Actions)

Após abrir o PR, o AURA monitora automaticamente o CI a cada tick de 10s.

**Importante:** quem corrige falhas de CI é o **agente com role `developer`** — não o DevOps Engineer. A lógica é: o Developer escreveu o código que quebrou o CI, portanto é ele que tem o contexto para corrigir. O DevOps Engineer foca em deploy e rollout, não em corrigir testes unitários. Esse comportamento é hardcoded no motor (`checkAndAdvancePRCI()` busca `role === 'developer'` em todas as colunas do pipeline).

```
pipeline_card_runs.pr_check_json = {
  repoId, owner, repo, prNumber, stageId, ci_fix_count
}

A cada tick (10s) — checkAndAdvancePRCI():
  1. GET /repos/{owner}/{repo}/pulls/{prNumber}  → SHA do commit
  2. GET /repos/{owner}/{repo}/commits/{sha}/check-runs  → status de cada check
  3. Para cada check-run falhado:
     - Busca annotations estruturadas do check-run
     - Busca logs reais dos jobs (últimos 2KB de stdout/stderr via Actions API)
  4. Resultado:
     - pending → aguarda próximo tick
     - passed  → advanceToNextColumn()
     - failed  → auto-correção pelo Developer (máx 3 tentativas):
         a. Monta prompt com: erros do CI + logs + contexto do repositório + histórico do card
         b. Developer gera correção → push na mesma branch
         c. PR atualizado → CI roda novamente
         d. Tentativa 4: dá up → posta no card, waiting_input para humano
```

---

## 11. Chamada ao LLM

Arquivo: `src/lib/pipeline-engine.ts`

### Roteamento por provider

A função `callAgentLLM(agent, prompt, cfg, assignmentModel, complexity)` resolve provider e modelo:

```
Prioridade do modelo:
1. assignmentModel (dropdown por agente na coluna) — formato "provider:model"
2. classifyCardComplexity(title, description) → simple/medium/complex
3. cfg.llm_complex / cfg.llm_medium / cfg.llm_simple
4. agent.model (campo no banco)
5. Fallback: anthropic + claude-sonnet-4-6

O provider é extraído do prefixo:
"anthropic:claude-opus-4-5" → provider=anthropic, model=claude-opus-4-5
"openai:gpt-4o" → provider=openai, model=gpt-4o
"gemini:gemini-1.5-pro" → provider=gemini, model=gemini-1.5-pro
Sem prefixo → infere pelo nome do modelo
```

### Provedores suportados

| Provider | Base URL | Autenticação | Função |
|---|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1/messages` | `x-api-key: {key}` | `callAnthropicLLM()` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `x-goog-api-key: {key}` | `callGeminiLLM()` |
| `openai` | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `openrouter` | `https://openrouter.ai/api/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `venice` | `https://api.venice.ai/api/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `nvidia` | `https://integrate.api.nvidia.com/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `moonshot` | `https://api.moonshot.cn/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `deepseek` | `https://api.deepseek.com/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `groq` | `https://api.groq.com/openai/v1/chat/completions` | `Authorization: Bearer {key}` | `callOpenAICompatLLM()` |
| `ollama` | `{ollamaHost}/api/chat` | Sem auth | `callOllamaLLM()` |

### Timeout e Fallback

- Timeout padrão: **90 segundos** por chamada LLM (`AbortSignal.timeout(90_000)`)
- Fallback automático: configurável via `llm_fallback_mode: 'fixed' | 'cascade' | 'none'`
  - `fixed`: usa modelo específico `llm_fallback_model` em caso de falha
  - `cascade`: tenta modelos em ordem de complexidade decrescente

### Resolução da API Key

```typescript
// 1. process.env.{PROVIDER}_API_KEY
// 2. SELECT value FROM settings WHERE key = 'integration.{PROVIDER}_API_KEY'
// 3. ~/{gateway_home}/.env (para setups com gateway)
```

---

## 12. Harness de Qualidade

Arquivo: `src/lib/agent-harness.ts`

O harness é uma camada de validação que roda entre o output do LLM e qualquer ação de efeito colateral (commit, PR, avanço de coluna).

### As 6 verificações (em ordem)

```
1. RESPOSTA VAZIA
   → text.trim() === '' → BLOCKED

2. RESPOSTA MUITO CURTA
   → text.length < min_response_length → BLOCKED
   Defaults: architect=400, security=300, qa=250, ba=200, developer=150

3. SECRETS NO CÓDIGO
   → Só se hasRepo=true (tem repositório vinculado)
   → Regex: password=, token=, AKIA..., -----BEGIN PRIVATE KEY-----
   → BLOCKED (impede commit de credenciais)

4. PAPEL DE COORDENAÇÃO GERANDO CÓDIGO
   → Se is_coordination_role=true E output contém ### FILE: ou OPEN_PR: true
   → BLOCKED (orchestrator, PM, Scrum Master não devem commitar)

5. GATE OBRIGATÓRIO AUSENTE
   → Regex do gate_pattern não encontrado no output
   → BLOCKED com exemplo do gate esperado

6. FILE SEM BLOCO FENCED
   → Só se hasRepo=true
   → ### FILE: caminho\n sem ``` a seguir → BLOCKED
```

### Configuração hierárquica

```
harness.json da skill  >  defaults hardcoded em agent-harness.ts
```

Se `harness.json` não existe ou o campo não está presente, usa o default.

### O que acontece quando o harness rejeita

```
1. formatHarnessRejection(reason, agentName, cardKey)
   → Formata mensagem markdown com emojis e instruções

2. postCardComment(provider, cfg, secrets, cardKey, rejectionMsg)
   → Posta no Jira como comentário ADF

3. updateRun(run.id, { status: 'waiting_input', last_comment_ts: now })
   → Pausa o pipeline

4. INSERT INTO pipeline_quality_metrics (metric_type='gate_rejected', ...)
   → Registra para análise e para injetar contexto no retry

5. RETURN  ← para a execução desta coluna
```

### Retry com contexto corretivo

Na próxima execução (após `@pipeline reprocessar`), o agente recebe no prompt:

```markdown
## ⚠️ Contexto de rejeição anterior

Na tentativa anterior, o harness de qualidade bloqueou sua resposta pelo seguinte motivo:

> O agente **developer** não emitiu o gate obrigatório na resposta.
> Esperado: `IMPLEMENTATION: READY_FOR_REVIEW` ...

Corrija este problema específico na sua próxima resposta.
```

---

## 12b. Second Brain e Knowledge Context

### Knowledge Context — Fontes externas nas skills

O Knowledge Context é o mecanismo principal de contexto externo do AURA. Não requer serviço adicional — funciona lendo URLs diretamente do `SKILL.md` do agente.

**Como configurar:** edite a seção `## Fontes de conhecimento` na skill de um agente (via tela de Agentes no AURA). O pipeline detecta as URLs automaticamente antes de executar o agente.

```markdown
## Fontes de conhecimento
- Jira: histórico de cards concluídos da mesma épica e cards similares
- Miro: https://miro.com/app/board/<ID_DO_BOARD>/
- Confluence: https://<empresa>.atlassian.net/wiki/spaces/<ESPACO>
- SharePoint: https://<empresa>.sharepoint.com/sites/<site>/docs
```

**Tokens necessários em Integrações:** `MIRO_TOKEN`, `CONFLUENCE_TOKEN`, `SHAREPOINT_TOKEN`.
O Jira histórico usa automaticamente as credenciais do pipeline — sem token extra.

**Agentes que recebem Knowledge Context:** `business analyst`, `product manager`, `product owner`, `software architect`, `ux designer`, `discovery`.

**Arquivo:** `src/lib/knowledge-context.ts` — função `buildKnowledgeContext()` executa todas as fontes em paralelo com timeout de 30s.

### Second Brain — Memória semântica de cards anteriores

O Second Brain é um serviço **opcional e separado** (FastAPI + ChromaDB). Quando configurado, acumula aprendizados de cada card concluído e injeta contexto relevante nos próximos cards do mesmo domínio.

**É opcional.** Se `SECOND_BRAIN_URL` não estiver configurado, o sistema funciona normalmente sem ele — as funções retornam vazio silenciosamente.

**Arquivo:** `src/lib/second-brain-client.ts`

**Como funciona:**

```
Quando um card CONCLUI:
  addKnowledge({
    content: "Card PROJ-123 concluído: <título>\n<descrição>",
    domain: inferDomain(title, description),  ← "cartoes", "pix", "cobranca", etc.
    source: "card:PROJ-123",
  })

Quando um BA/PM/PO executa no PRÓXIMO card:
  searchKnowledge(cardTitle + cardDescription, domain, 5)
  → GET {SECOND_BRAIN_URL}/knowledge/search?query=...&domain=...&n_results=5
  → Retorna os 5 chunks mais similares (busca vetorial)
  → Injetado no prompt como:
    ## Conhecimento do Second Brain — domínio: cartoes
    ---
    **Card anterior: Implementar contestação de transação**
    (fonte: card:PROJ-98)
    O domínio de contestação usa o serviço X, as regras Y...
```

**Limitação atual:** o `addKnowledge()` grava apenas o título e a descrição do card, não os outputs estruturados dos agentes (ANALYSIS: READY, decisões arquiteturais, etc.). Os blocos `[SECOND_BRAIN: RECORD]` nas skills são instruções para o agente incluir no output — mas o código não os extrai e grava automaticamente ainda.

**Para configurar:** `SECOND_BRAIN_URL=http://seu-servidor:8080` em Integrações ou `.env`.

---

## 13. SSE — Eventos em Tempo Real

### EventBus (`src/lib/event-bus.ts`)

Singleton Node.js `EventEmitter` guardado em `globalThis.__eventBus` para sobreviver ao HMR do Next.js em desenvolvimento.

```typescript
// Emitindo um evento (dentro do pipeline-engine, por exemplo)
eventBus.broadcast('pipeline.stage_started', {
  run_id: 42,
  card_key: 'PROJ-123',
  stage: 'Análise',
  agent: 'Ana Flávia',
  workspace_id: 1
})

// O broadcast internamente faz:
this.emit('server-event', { type: 'pipeline.stage_started', data: payload, timestamp: Date.now() })
```

### Tipos de eventos disponíveis (31 tipos)

| Tipo | Quando |
|---|---|
| `pipeline.stage_started` | Início de execução de uma coluna |
| `pipeline.agent_output` | Agente concluiu e gerou output |
| `pipeline.run_completed` | Card concluído |
| `pipeline.loop_detected` | Loop semântico detectado |
| `pipeline.ci_passed` | CI do PR passou |
| `pipeline.ci_failed` | CI falhou |
| `agent.created` | Novo agente criado |
| `agent.status_changed` | Status do agente mudou |
| `task.created` | Nova task criada |
| `task.updated` | Task atualizada |
| `run.updated` | Run de agente atualizado |

### Rota SSE (`GET /api/events`)

```typescript
// Cliente conecta com EventSource
const events = new EventSource('/api/events')
events.onmessage = (e) => {
  const event = JSON.parse(e.data)
  // { type: 'pipeline.stage_started', data: {...}, timestamp: 1700000000000 }
}

// Servidor (src/app/api/events/route.ts):
// - ReadableStream nativo do Node.js
// - Heartbeat a cada 30s: ": heartbeat\n\n"
// - Filtragem por workspace_id do usuário autenticado
// - Headers: Content-Type: text/event-stream, X-Accel-Buffering: no
```

---

## 14. Autenticação e Multitenancy

### Hierarquia de entidades

```
Tenant (organização)
  └── Workspace (time/produto)
        ├── Users
        ├── Agents
        ├── Tasks
        ├── Pipelines
        └── Skills
```

### Autenticação — 4 métodos em ordem de prioridade

**1. Proxy Auth** (para SSO corporativo)
```
Env: MC_PROXY_AUTH_HEADER=X-Auth-User
     MC_PROXY_AUTH_TRUSTED_IPS=10.0.0.1,10.0.0.2
→ Pega username do header X-Auth-User (somente de IPs confiáveis)
→ Auto-provisiona usuário se MC_PROXY_AUTH_DEFAULT_ROLE configurado
```

**2. Session Cookie** (login web)
```
Cookie: mc_session={token_hex_64}
→ Token hashed SHA256 antes de armazenar em user_sessions
→ SELECT u.*, s.workspace_id FROM user_sessions s JOIN users u ...
   WHERE s.token = SHA256(cookie) AND s.expires_at > now()
→ Sessão dura 7 dias
```

**3. API Key Global** (automação / scripts)
```
Header: X-Api-Key: {key}
ou Authorization: Bearer {key}
→ Comparação constant-time (timingSafeEqual) contra:
   1. settings.security.api_key
   2. process.env.API_KEY
→ Role: admin
```

**4. Agent-scoped API Keys** (agentes autônomos)
```
Header: X-Api-Key: {key}
→ SHA256 do key consultado em agent_api_keys
→ Tem scopes, expires_at, revoked_at
→ Role limitado aos scopes
```

### Resolução de workspace_id

Todo request autenticado tem um `workspace_id`. Todas as queries incluem `AND workspace_id = ?`. Não há cross-workspace por design.

### Senhas

Algoritmo: PBKDF2-SHA256 com salt aleatório + hash em formato `hash:salt`.

Rehash progressivo: se a senha usa algoritmo mais antigo, faz rehash no próximo login sem interromper o fluxo.

---

## 15. Diagrama de Sequência — Fluxo Completo de um Card

```plantuml
@startuml
title AURA — Fluxo completo de um card no pipeline

actor "Product Owner" as PO
participant "Jira" as JIRA
participant "Scheduler (10s)" as SCHED
participant "Pipeline Engine" as ENGINE
participant "LLM API" as LLM
participant "Harness" as HARNESS
participant "GitHub" as GH
participant "EventBus + SSE" as SSE
participant "Frontend AURA" as UI

PO -> JIRA: Cria card PROJ-123\nem "Para fazer"

== Detecção (a cada 10s) ==

SCHED -> ENGINE: tickPipelineEngine()
ENGINE -> JIRA: GET /rest/api/3/search/jql\njql=project=PROJ AND status in (id_da_coluna)
JIRA --> ENGINE: [{ key: "PROJ-123", summary, description }]
ENGINE -> ENGINE: upsertRun() → INSERT pipeline_card_runs\nstatus='running'
ENGINE -> SSE: broadcast('pipeline.stage_started')
SSE --> UI: { type: 'pipeline.stage_started', ... }

== Execução — Orchestrator (Antônio) ==

ENGINE -> ENGINE: startColumn(run, coluna_triagem)
ENGINE -> ENGINE: loadAgentSkills() → lê SKILL.md do disco
ENGINE -> ENGINE: buildPrompt(run, column, previousMessages)
ENGINE -> LLM: POST /v1/messages\nsystem: soul+skills\nuser: card+instrução
LLM --> ENGINE: "Analisei o card. Definition of Ready completo..."
ENGINE -> HARNESS: validateAgentOutput(text, { role: 'orchestrator' })
note right: gate_pattern=null\nis_coordination_role=true\nVerifica que não há ### FILE:
HARNESS --> ENGINE: { ok: true }
ENGINE -> JIRA: POST /comment "🤖 **Antônio** — card validado..."
ENGINE -> ENGINE: appendContextSummary() → atualiza context_summary_json
ENGINE -> ENGINE: advanceToNextColumn() → transitionJiraIssue("Análise")
ENGINE -> JIRA: POST /transitions { id: "trans_id" }

== Execução — Business Analyst (Ana) ==

ENGINE -> ENGINE: startColumn(run, coluna_analise)
ENGINE -> LLM: POST /v1/messages (com contexto do Orchestrator)
LLM --> ENGINE: "ANALYSIS: READY\nRegras identificadas..."
ENGINE -> HARNESS: validateAgentOutput(text, { role: 'business analyst' })
HARNESS --> ENGINE: { ok: true } ← gate ANALYSIS: READY encontrado
ENGINE -> JIRA: POST /comment "🤖 **Ana Flávia** ..."
ENGINE -> ENGINE: advanceToNextColumn() → "Arquitetura"

== Execução — Arquiteto (Carlos) ==

ENGINE -> ENGINE: startColumn(run, coluna_arquitetura)
ENGINE -> LLM: POST /v1/messages
LLM --> ENGINE: "ARCHITECTURE: APPROVED\n[ARCHITECTURE: DECISION]\n..."
ENGINE -> HARNESS: validateAgentOutput(...)
HARNESS --> ENGINE: { ok: true }
ENGINE -> JIRA: POST /comment
ENGINE -> ENGINE: advanceToNextColumn() → "Implementação"

== Execução — Developer (Roberto) ==

ENGINE -> ENGINE: startColumn(run, coluna_implementacao)
ENGINE -> ENGINE: fetchRepoContext(repoId) → GET /repos/.../git/trees
ENGINE -> LLM: POST /v1/messages (com árvore do repositório)
LLM --> ENGINE: "### FILE: src/auth.ts\n```\nconst...\n```\nCOMMIT: feat\nOPEN_PR: true\nIMPLEMENTATION: READY_FOR_REVIEW"
ENGINE -> HARNESS: validateAgentOutput(...)
HARNESS --> ENGINE: { ok: true }
ENGINE -> GH: GET /repos/.../git/ref/heads/main → SHA
ENGINE -> GH: POST /repos/.../git/refs → cria branch feat/proj-123-...
ENGINE -> GH: PUT /repos/.../contents/src/auth.ts → commit
ENGINE -> GH: POST /repos/.../pulls → PR #42
ENGINE -> JIRA: POST /comment "✅ **Código commitado** | ✅ PR #42 aberto"
ENGINE -> ENGINE: pr_check_json = { owner, repo, prNumber: 42, ... }
ENGINE -> ENGINE: updateRun(status='waiting_input')

== CI Polling ==

SCHED -> ENGINE: tickPipelineEngine() (próximo tick)
ENGINE -> GH: GET /repos/.../commits/{sha}/check-runs
GH --> ENGINE: [{ name: "tests", status: "completed", conclusion: "success" }]
ENGINE -> ENGINE: advanceToNextColumn() → "QA"

== QA + Security + Release (mesmo padrão) ==

note over ENGINE: QA, Security e DevOps seguem\no mesmo padrão de execução

ENGINE -> ENGINE: advanceToNextColumn() → "Done"
ENGINE -> JIRA: POST /transitions → "Done"
ENGINE -> ENGINE: updateRun(status='done')
ENGINE -> SSE: broadcast('pipeline.run_completed')
SSE --> UI: { type: 'pipeline.run_completed', ... }

@enduml
```

---

## 16. Diagrama de Componentes

```plantuml
@startuml
title AURA — Diagrama de Componentes

package "Next.js Process" {
  package "Frontend (React 19)" {
    [agent-squad-panel] as ASP
    [work-pipeline-panel] as WPP
    [task-board] as TB
    [SSE hook\n(EventSource)] as SSE_HOOK
  }

  package "API Routes (/api/**)" {
    [POST /api/agents] as API_AGENTS
    [GET /api/events] as API_EVENTS
    [GET/POST /api/pipeline/**] as API_PIPELINE
    [POST /api/auth/login] as API_AUTH
    [GET /api/skills] as API_SKILLS
  }

  package "Core Libraries" {
    [pipeline-engine.ts\n(4500 linhas)] as PE
    [agent-harness.ts] as AH
    [event-bus.ts\n(singleton)] as EB
    [scheduler.ts\n(10s tick)] as SCHED
    [auth.ts] as AUTH
    [skill-sync.ts] as SS
    [work-pipeline-jira.ts] as JIRA_LIB
    [work-pipeline-azure.ts] as AZURE_LIB
    [knowledge-context.ts] as KC
    [second-brain-client.ts] as SB
  }
}

database "MySQL 8.0" {
  [agents]
  [pipeline_card_runs]
  [pipeline_columns]
  [skills]
  [users / user_sessions]
  [settings]
}

cloud "LLM APIs" {
  [Anthropic Claude]
  [OpenAI GPT]
  [Google Gemini]
  [Ollama (local)]
}

cloud "Jira / Azure DevOps" {
  [Jira REST API v3]
  [Azure DevOps API]
}

cloud "Git Providers" {
  [GitHub API v3]
  [GitLab API v4]
}

cloud "Knowledge Sources" {
  [Miro API v2]
  [Confluence REST API]
  [SharePoint (Graph API)]
  [Second Brain\n(FastAPI + ChromaDB)]
}

' Frontend connections
ASP --> API_AGENTS
WPP --> API_PIPELINE
SSE_HOOK --> API_EVENTS

' API to libs
API_AGENTS --> PE
API_EVENTS --> EB
API_PIPELINE --> PE
API_AUTH --> AUTH

' Scheduler drives engine
SCHED --> PE

' Engine connections
PE --> AH
PE --> EB
PE --> JIRA_LIB
PE --> AZURE_LIB
PE --> KC
PE --> SB
PE --> AUTH

' DB connections
PE --> [pipeline_card_runs]
PE --> [pipeline_columns]
PE --> [agents]
SS --> [skills]
AUTH --> [users / user_sessions]

' External calls
PE --> [Anthropic Claude]
PE --> [OpenAI GPT]
PE --> [Google Gemini]
PE --> [Ollama (local)]

JIRA_LIB --> [Jira REST API v3]
AZURE_LIB --> [Azure DevOps API]
PE --> [GitHub API v3]
PE --> [GitLab API v4]

KC --> [Miro API v2]
KC --> [Confluence REST API]
KC --> [SharePoint (Graph API)]
SB --> [Second Brain\n(FastAPI + ChromaDB)]

@enduml
```

---

## 17. Diagrama de Banco de Dados

```plantuml
@startuml
title AURA — Modelo de Dados (tabelas principais)

entity "workspaces" as WS {
  * id : INT PK
  --
  slug : VARCHAR
  name : VARCHAR
  tenant_id : INT FK
}

entity "agents" as AG {
  * id : INT PK
  --
  name : VARCHAR
  role : TEXT
  soul_content : TEXT
  model : VARCHAR
  status : VARCHAR
  config : TEXT (JSON)
  workspace_id : INT FK
}

entity "work_pipelines" as WP {
  * id : INT PK
  --
  workspace_id : INT FK
  provider : VARCHAR
  enabled : TINYINT
  config_json : TEXT
  secret_blob : TEXT (criptografado)
}

entity "pipeline_columns" as PC {
  * id : INT PK
  --
  pipeline_id : INT FK
  column_name : VARCHAR
  column_order : INT
  is_trigger : TINYINT
  instructions : TEXT
  assignments_json : TEXT (JSON)
  requires_human_approval : TINYINT
}

entity "pipeline_card_runs" as CR {
  * id : INT PK
  --
  workspace_id : INT FK
  card_key : VARCHAR
  card_title : VARCHAR
  card_description : TEXT
  current_stage_id : VARCHAR
  status : VARCHAR
  last_comment_ts : INT
  cost_usd : DOUBLE
  run_count : INT
  pr_check_json : TEXT
  context_summary_json : TEXT
  stage_snapshots_json : TEXT
}

entity "pipeline_card_messages" as CM {
  * id : INT PK
  --
  run_id : INT FK
  direction : VARCHAR
  stage_id : VARCHAR
  body : TEXT
  external_comment_id : VARCHAR
}

entity "skills" as SK {
  * id : INT PK
  --
  name : VARCHAR
  source : VARCHAR
  path : TEXT
  content_hash : VARCHAR
}

entity "git_repositories" as GR {
  * id : INT PK
  --
  workspace_id : INT FK
  name : VARCHAR
  provider : VARCHAR
  repo_url : TEXT
  branch : VARCHAR
  access_token : TEXT
}

entity "token_usage" as TU {
  * id : INT PK
  --
  model : VARCHAR
  agent_name : VARCHAR
  input_tokens : INT
  output_tokens : INT
  cost_usd : DOUBLE
  workspace_id : INT FK
}

entity "pipeline_quality_metrics" as QM {
  * id : INT PK
  --
  workspace_id : INT FK
  run_id : INT FK
  card_key : VARCHAR
  metric_type : VARCHAR
  value_text : TEXT
  value_num : DOUBLE
  stage_name : VARCHAR
  agent_name : VARCHAR
}

WS ||--o{ AG : "1 workspace\n tem N agentes"
WS ||--o{ WP : "1 workspace\n tem N pipelines"
WP ||--o{ PC : "1 pipeline\n tem N colunas"
WP ||--o{ CR : "1 pipeline\n tem N card runs"
CR ||--o{ CM : "1 run\n tem N mensagens"
CR ||--o{ QM : "1 run\n tem N métricas"
WS ||--o{ GR : "1 workspace\n tem N repos"

@enduml
```

---

## 18. Estrutura de Pastas

```
c:\DevProjects\aura\
├── src/
│   ├── app/                         → Next.js App Router
│   │   ├── api/                     → 65+ namespaces de API Routes
│   │   │   ├── agents/              → CRUD de agentes (POST /api/agents)
│   │   │   ├── events/              → SSE stream (GET /api/events)
│   │   │   ├── pipeline/            → engine, quality-metrics, stream
│   │   │   ├── pipelines/           → CRUD de pipelines
│   │   │   ├── skills/              → listagem e edição de skills
│   │   │   ├── project-skills/      → leitura de SKILL.md e harness.json
│   │   │   ├── auth/                → login, logout, session
│   │   │   ├── tasks/               → CRUD de tarefas
│   │   │   ├── workspace/           → work-pipelines, delivery-flows
│   │   │   ├── integrations/        → tokens de API (Jira, GitHub, etc.)
│   │   │   └── ...
│   │   ├── [[...panel]]/            → Shell SPA (página única)
│   │   │   └── page.tsx             → Router de painéis
│   │   ├── login/                   → Tela de login
│   │   └── layout.tsx               → Root layout com next-intl
│   │
│   ├── components/                  → Componentes React
│   │   ├── panels/                  → Painéis principais da UI
│   │   │   ├── agent-squad-panel-phase3.tsx  → Gestão de agentes
│   │   │   ├── work-pipeline-panel.tsx       → Configuração do pipeline
│   │   │   ├── task-board-panel.tsx          → Kanban de tasks
│   │   │   └── ...
│   │   ├── ui/                      → Componentes base (button, modal, input)
│   │   ├── dashboard/               → Widgets do dashboard
│   │   └── modals/                  → Modais globais
│   │
│   ├── lib/                         → Lógica de negócio e infraestrutura
│   │   ├── pipeline-engine.ts       → *** Motor central do pipeline (4500+ linhas)
│   │   ├── agent-harness.ts         → Validação de outputs dos agentes
│   │   ├── event-bus.ts             → Singleton de eventos SSE
│   │   ├── scheduler.ts             → Cron interno (10s tick)
│   │   ├── auth.ts                  → Autenticação e sessão
│   │   ├── db.ts                    → Inicialização e helpers MySQL
│   │   ├── db-pool.ts               → Pool de conexões MySQL2
│   │   ├── schema-mysql.sql         → DDL completo do banco
│   │   ├── migrations-mysql.ts      → Migrations incrementais
│   │   ├── skill-sync.ts            → Sincronização disco → DB
│   │   ├── work-pipeline-jira.ts    → Client Jira REST API
│   │   ├── work-pipeline-azure.ts   → Client Azure DevOps API
│   │   ├── gitlab.ts                → Client GitLab API
│   │   ├── knowledge-context.ts     → Busca em Miro, Confluence, SharePoint
│   │   ├── second-brain-client.ts   → Client do serviço Second Brain
│   │   ├── token-pricing.ts         → Cálculo de custo por modelo
│   │   ├── workspaces.ts            → Multitenancy
│   │   └── ...                      → (100+ módulos)
│   │
│   ├── store/                       → Zustand stores (estado global React)
│   └── types/                       → Tipos TypeScript globais
│
├── skills/                          → Skills dos agentes (lidas pelo pipeline)
│   ├── swe-business-analysis/
│   │   ├── SKILL.md                 → Instrução do papel
│   │   └── harness.json             → Regras de validação
│   ├── swe-software-architecture/
│   ├── swe-implementation-practices/
│   ├── swe-quality-gates/
│   ├── swe-security-review/
│   ├── swe-data-engineering/
│   ├── swe-product-management/
│   ├── swe-backlog-prioritization/
│   ├── swe-flow-management/
│   ├── swe-ux-research/
│   ├── swe-release-operations/
│   ├── swe-orchestration-coordination/
│   └── swe-discovery-practices/
│
├── docs/                            → Documentação
│   ├── README.md                    → Este arquivo
│   ├── diagrams/                    → Diagramas PlantUML
│   ├── deployment.md                → Guia de deploy
│   └── quickstart.md                → Setup rápido
│
├── public/                          → Assets estáticos
├── messages/
│   └── pt.json                      → Traduções PT-BR
├── Dockerfile                       → Build Docker
├── docker-compose.yml               → Dev local com MySQL
├── .env.example                     → Variáveis de ambiente
└── package.json
```

---

## 19. Como Instalar e Configurar

### Pré-requisitos

- Node.js ≥ 22
- pnpm 11.15.1 (`npm install -g pnpm`)
- MySQL 8.0 (local ou Aurora)

### Setup local com Docker

```bash
# 1. Clone o repositório
git clone <url-do-repo>
cd aura

# 2. Suba o MySQL local
docker-compose up -d mysql

# 3. Instale dependências
pnpm install

# 4. Configure variáveis de ambiente
cp .env.example .env
# Edite .env com os valores corretos (ver seção abaixo)

# 5. Inicie o servidor
pnpm dev
# Acesse: http://localhost:3000
```

### Variáveis de ambiente obrigatórias

```bash
# Banco de dados
DATABASE_URL=mysql://aura:senha@localhost:3306/aura

# Segurança (string aleatória de 32+ chars)
SECRET_KEY=sua-chave-aleatoria-aqui
API_KEY=chave-admin-da-api

# LLM (pelo menos um obrigatório)
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=...

# Opcional: SSO corporativo
# MC_PROXY_AUTH_HEADER=X-Auth-User
# MC_PROXY_AUTH_TRUSTED_IPS=10.0.0.1
```

### Configuração via UI (após login)

1. **Integrações** → Configure tokens: Jira, GitHub/GitLab, Anthropic/OpenAI/Gemini
2. **Agentes** → Crie agentes com nome, role, soul e modelo
3. **Work Pipeline** → Configure o pipeline: provedor (Jira), projeto, colunas
4. **Repositórios** → Vincule o repositório Git com token de acesso
5. Skills dos agentes são lidas automaticamente do diretório `skills/`

### Deploy em produção

```bash
# Build standalone
pnpm build

# Inicia o servidor (0.0.0.0:3000)
pnpm start
```

Ver `docs/deployment.md` para configuração de nginx, SSL e variáveis de produção.

---

## 19b. Painéis do AURA — Guia de Configuração

O AURA tem uma interface de painel único (SPA). A barra lateral contém todos os módulos. Aqui estão os painéis relevantes para configurar e operar o pipeline:

### Painel: Agentes

**O que faz:** lista todos os agentes do workspace com status em tempo real (🟢 idle, 🟡 busy, ⚫ offline). Permite criar, editar e remover agentes.

**Como usar para o pipeline:**
1. Clique em um agente existente → veja suas tasks ativas e histórico
2. Clique em **Editar** → aba **Skill**: edite o `SKILL.md` e o `harness.json` diretamente
3. Aba **Soul**: edite a personalidade base do agente
4. Aba **Configuração**: modelo LLM padrão, persona (authority_level, restrictions), sandbox

### Painel: Work Pipeline

**O que faz:** configura a conexão com Jira/Azure e define as colunas da esteira com seus agentes.

**Como configurar do zero:**
1. Escolha o **provedor** (Jira ou Azure DevOps)
2. Preencha URL base, project key, e-mail e token de API
3. Defina os modelos LLM por complexidade:
   - Simples: cards curtos/descritivos — use modelo mais barato (ex: claude-haiku)
   - Médio: cards normais — modelo balanceado (ex: claude-sonnet)
   - Complexo: cards longos com muito contexto — modelo mais capaz (ex: claude-opus)
4. Configure o `botMention` (padrão: `@pipeline`)
5. Clique em **Colunas** → adicione colunas na ordem do Jira:
   - Para cada coluna: nome (deve bater exatamente com o status no Jira), marque a **coluna gatilho**
   - Arraste agentes para a coluna, defina a ordem e o modelo por agente
6. Em **Repositórios**: vincule o(s) repositório(s) Git com o token de acesso

### Painel: Pipeline — Runs Ativos

**O que faz:** mostra todos os card runs em execução ou aguardando. Permite ver o histórico de mensagens de cada run.

**Como usar:**
- Expanda um run → veja cada mensagem trocada entre agentes e o card Jira
- Botão **Reprocessar**: reexecuta a etapa atual do run selecionado
- Botão **Cancelar**: encerra o run

### Painel: Integrações

**O que faz:** gerencia todas as chaves de API e tokens externos. É aqui que você configura os provedores LLM e as fontes de conhecimento.

**Tokens obrigatórios para o pipeline:**
| Token | Onde configurar | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` (ou outro LLM) | Integrações → LLM Providers | Chamadas ao LLM pelos agentes |
| Jira API Token | Work Pipeline → configuração | Polling de cards e postagem de comentários |
| GitHub Token / GitLab Token | Integrações → Git Providers | Commits, branches e PRs |

**Tokens opcionais (Knowledge Context):**
| Token | Para que serve |
|---|---|
| `MIRO_TOKEN` | Leitura de boards Miro nas skills dos agentes |
| `CONFLUENCE_TOKEN` | Leitura de espaços/páginas Confluence |
| `SHAREPOINT_TOKEN` | Leitura de documentos via Microsoft Graph |
| `SECOND_BRAIN_URL` | URL do serviço Second Brain (FastAPI + ChromaDB) |

Cada integração tem um botão **Testar** que verifica a conectividade antes de salvar.

### Painel: Cost Tracker

**O que faz:** exibe o consumo de tokens e custo financeiro por modelo, agente e card.

- Gráfico de pizza: distribuição de custo por modelo LLM
- Linha do tempo: evolução de gasto diário
- Breakdown por agente: qual agente mais consome
- Breakdown por card: custo total de processar cada card

Dados vêm da tabela `token_usage` no banco, populada após cada chamada LLM.

### Painel: Configurações Gerais

**O que faz:** controla comportamentos do servidor.

Configurações relevantes para o pipeline:
- **Scheduler / Pipeline Engine**: habilitar/desabilitar o tick de 10s
- **Skill Sync**: habilitar/desabilitar a sincronização de skills do disco
- **Retenção de dados**: quantos dias manter o histórico de runs e mensagens
- **API Key**: rotação da chave de API para acesso programático

---

## 19c. Deploy na AWS — Arquitetura Atual e Recomendações

### Como o AURA está na AWS hoje

O AURA roda em produção num único **EC2** (Linux, glibc 2.34) como processo Node.js. O deploy é controlado pelo GitLab CI e executado via **AWS SSM Run Command** — sem SSH direto, sem Docker no EC2 de produção.

```
Infraestrutura atual:

┌─────────────────────────────────────────────────────────────┐
│  GitLab CI                                                  │
│                                                             │
│  1. validate: pnpm typecheck + pnpm build                   │
│  2. release: build + tar.gz → S3 (efi-aura-releases-*)      │
│  3. deploy (MANUAL): SSM Run Command → EC2                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ AWS SSM Send-Command
                         │ Document: efi-aura-deploy v5
                         │ Parameters: Version, Sha256
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  EC2 i-0c7c2bb068ed75adf (us-east-1)                       │
│  Linux — glibc 2.34                                         │
│                                                             │
│  1. Baixa artefato do S3                                    │
│  2. Verifica SHA256                                         │
│  3. Extrai .tar.gz                                          │
│  4. Reinicia o processo Node.js (server.js)                 │
│                                                             │
│  Porta 3000 → nginx (proxy reverso)                        │
│  → https://aura.interno.testesejaefi.com.br                 │
│                                                             │
│  Banco: MySQL (RDS ou instância local — usa schema-mysql.sql│
│  Skills: diretório skills/ incluído no artefato             │
└─────────────────────────────────────────────────────────────┘
```

### O que o artefato `.tar.gz` contém

O job `release` empacota exatamente:
- `.next/standalone/` — build Next.js standalone (sem node_modules externos)
- `.next/static/` — assets estáticos (CSS, JS, imagens)
- `public/` — arquivos públicos (logos, robots.txt)
- `src/lib/schema-mysql.sql` — DDL do banco para inicialização
- `skills/*/SKILL.md` e `skills/*/harness.json` — skills dos agentes

O que **não** entra: `.git`, `.env`, `docker-compose.yml`, docs, testes.

### Variáveis de ambiente de produção

O job `release` busca secrets do **AWS Secrets Manager** em `aura/prod/build`. Essas variáveis são injetadas no build do Next.js (variáveis `NEXT_PUBLIC_*`).

Na instância EC2, as variáveis de runtime precisam estar disponíveis como variáveis de ambiente do processo Node.js. A forma recomendada é um arquivo `.env` na raiz da aplicação, carregado pelo `docker-entrypoint.sh` (ou pelo script de inicialização do SSM).

### Recomendação de arquitetura AWS para produção robusta

Se o AURA for crescer em uso, a arquitetura ideal na AWS é:

```
┌─────────────────────────────────────────────────────────────────────┐
│  DNS / CloudFront (CDN para assets estáticos)                       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Application Load Balancer                                          │
│  (SSL termination, health checks)                                   │
└─────────────────┬─────────────────────────────────────────────────┘
                  │
         ┌────────┴────────┐
         ▼                 ▼
┌────────────────┐  ┌────────────────┐
│  EC2 / ECS Task │  │  EC2 / ECS Task │   ← N instâncias do AURA
│  Node.js :3000 │  │  Node.js :3000  │     (atrás do ALB)
└────────┬───────┘  └────────┬────────┘
         │                   │
         └────────┬──────────┘
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Amazon RDS — Aurora MySQL Serverless v2                            │
│  (Multi-AZ, backup automático, scaling)                             │
└─────────────────────────────────────────────────────────────────────┘
```

**Observação importante sobre o scheduler:** o AURA roda o motor do pipeline como um `setInterval` dentro do processo Node.js. Com múltiplas instâncias, cada instância executaria o poll independentemente — potencialmente processando o mesmo card duas vezes. Para resolver isso:
- Use **uma única instância** para o processo do pipeline (não escale horizontalmente o scheduler), ou
- Adicione um lock de banco (`SELECT ... FOR UPDATE`) no `tickPipelineEngine()` para garantir que apenas uma instância processe por vez.

### Requisitos mínimos de infraestrutura

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 1 vCPU | 2 vCPUs |
| RAM | 1 GB | 2 GB (chamadas LLM podem ser pesadas em memória) |
| Disco | 2 GB | 10 GB (logs, dados, artefatos) |
| Banco | MySQL 8.0 | RDS Aurora MySQL Serverless v2 |
| Node.js | 22 | 22 LTS |
| Porta | 3000 | 3000 (configurável via `PORT`) |

### Pipeline CI/CD atual — dois caminhos coexistentes

O `.gitlab-ci.yml` tem dois modos que não se sobrepõem:

**Caminho antigo (push em `master`):**
```
push master → validate → release (S3) → deploy MANUAL (SSM)
```

**Caminho novo (push de tag `vX.Y.Z`):**
```
tag v1.2.3 → disparar-esteira → pipeline de infra (repo 1881)
              (passa GN_VERSAO_APP, APP_COMMIT_SHA)
           → receber-callback (resultado do deploy de infra)
```

O caminho novo delega o deploy para o repositório de infraestrutura separado, que tem o controle completo sobre o SSM Document e os steps de deploy/rollback.

### Rollback

O deploy manual tem rollback via gatilho web no GitLab:
1. Acesse GitLab → CI/CD → Pipelines
2. Acione manualmente o job `rollback`
3. Ele baixa o `.sha256` do release anterior do S3 e re-executa o SSM com essa versão

---

## 20. Referência de Configuração

### Pipeline config_json (work_pipelines.config_json)

```json
{
  "jiraHost": "https://empresa.atlassian.net",
  "jiraProjectKey": "PROJ",
  "jiraAccountEmail": "usuario@empresa.com",
  "jiraJql": "project = PROJ AND type = Story",
  "botMention": "@pipeline",
  "llm_simple": "anthropic:claude-haiku-3-5",
  "llm_medium": "anthropic:claude-sonnet-4-6",
  "llm_complex": "anthropic:claude-opus-4-5",
  "llm_fallback_mode": "fixed",
  "llm_fallback_model": "anthropic:claude-haiku-3-5",
  "llm_fallback_max_attempts": "2"
}
```

### assignments_json (pipeline_columns.assignments_json)

```json
[
  {
    "agent_id": 1,
    "role": "orchestrator",
    "order": 1,
    "llm_model": "anthropic:claude-haiku-3-5",
    "repo_id": null
  },
  {
    "agent_id": 2,
    "role": "business analyst",
    "order": 2,
    "llm_model": "anthropic:claude-sonnet-4-6",
    "repo_id": null
  }
]
```

### Comandos no Jira (comentários no card)

| Comando | Efeito |
|---|---|
| `@pipeline reprocessar` | Reexecuta a etapa atual com contexto de erro |
| `@pipeline reprocessar tudo` | Reinicia o pipeline do início |
| `@pipeline avançar` | Força avanço para próxima etapa |
| `@pipeline cancelar` | Cancela o run |
| `@pipeline <instrução>` | Executa instrução livre com o primeiro agente da coluna |
| `@nomeDoAgente <instrução>` | Direciona instrução para agente específico pelo nome |

### Formato de entrega de código (output do agente)

```
### FILE: src/services/UserService.ts
```typescript
export class UserService {
  // conteúdo COMPLETO do arquivo
}
```

### FILE: src/tests/UserService.test.ts
```typescript
describe('UserService', () => { ... })
```

COMMIT: feat(auth): implement user service with tests

TEST_CMD: pnpm test --run

OPEN_PR: true
```

### Formato de gate (output obrigatório por role)

| Role | Gate |
|---|---|
| orchestrator | Nenhum obrigatório |
| business analyst | `ANALYSIS: READY` \| `ANALYSIS: BLOCKED` \| `ANALYSIS: NOT_APPLICABLE` |
| software architect | `ARCHITECTURE: APPROVED` \| `ARCHITECTURE: BLOCKED` \| `ARCHITECTURE: NOT_APPLICABLE` |
| developer | `IMPLEMENTATION: READY_FOR_REVIEW` \| `IMPLEMENTATION: BLOCKED` |
| qa engineer | `VERDICT: APPROVED` \| `VERDICT: CHANGES_REQUESTED` \| `QA: BLOCKED` |
| security auditor | `SECURITY: APPROVED` \| `SECURITY: BLOCKED` \| `SECURITY: NOT_APPLICABLE` |
| data engineer | `DATA: APPROVED` \| `DATA: BLOCKED` \| `DATA: NOT_APPLICABLE` |
| product manager | `PRODUCT: READY` \| `PRODUCT: BLOCKED` \| `PRODUCT: NOT_APPLICABLE` |
| product owner | `PRIORITY: APPROVED` \| `PRIORITY: BLOCKED` \| `PRIORITY: NOT_APPLICABLE` |
| scrum master | `FLOW: HEALTHY` \| `FLOW: AT_RISK` \| `FLOW: BLOCKED` |
| devops engineer | `RELEASE: SUCCESS` \| `RELEASE: ROLLED_BACK` \| `RELEASE: BLOCKED` \| `RELEASE: NOT_APPLICABLE` |
| ux designer | `UX: APPROVED` \| `UX: BLOCKED` \| `UX: NOT_APPLICABLE` |

---

*Documentação gerada em Setembro/2026. Para dúvidas técnicas, consulte o código-fonte em `src/lib/pipeline-engine.ts`.*
