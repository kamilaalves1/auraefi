<div align="center">

# AURA

**Plataforma de Orquestração de Agentes de IA para Squads de Desenvolvimento**

Conecte seu backlog (Jira ou Azure DevOps), defina pipelines em múltiplos estágios e deixe agentes de IA executar cada etapa de forma autônoma — análise de negócio, arquitetura, implementação, QA, segurança e release — com commits reais, abertura de MR/PR, rastreabilidade completa e custo visível.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![pnpm](https://img.shields.io/badge/pnpm-only-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

</div>

---

## Índice

- [O que é e como funciona](#o-que-é-e-como-funciona)
- [Arquitetura geral](#arquitetura-geral)
- [Pipeline Engine — núcleo do sistema](#pipeline-engine--núcleo-do-sistema)
  - [Fluxo completo de um card](#fluxo-completo-de-um-card)
  - [Resolução de repositório](#resolução-de-repositório)
  - [Memória de contexto por run](#memória-de-contexto-por-run)
  - [Detecção de loop semântico](#detecção-de-loop-semântico)
  - [Aprovação humana por etapa](#aprovação-humana-por-etapa)
  - [QA gate — reenvio ao developer](#qa-gate--reenvio-ao-developer)
  - [Estimativa automática de story points](#estimativa-automática-de-story-points)
  - [Replay e rollback de etapas](#replay-e-rollback-de-etapas)
- [Harness de Validação](#harness-de-validação)
- [LLM-as-judge — avaliação pelo Coordinator](#llm-as-judge--avaliação-pelo-coordinator)
- [Sistema de Skills](#sistema-de-skills)
- [Agent Communication — @mention no Jira](#agent-communication--mention-no-jira)
- [Sandbox Docker — testes antes do PR](#sandbox-docker--testes-antes-do-pr)
- [Screenshot-to-Code — imagens do card](#screenshot-to-code--imagens-do-card)
- [Design System por repositório](#design-system-por-repositório)
- [Feedback loop de CI e PR](#feedback-loop-de-ci-e-pr)
- [Second Brain](#second-brain)
- [Observabilidade em tempo real (SSE)](#observabilidade-em-tempo-real-sse)
- [Métricas de qualidade](#métricas-de-qualidade)
- [Multi-repositório](#multi-repositório)
- [Repositórios Git — providers e commits](#repositórios-git--providers-e-commits)
- [Autenticação e SSO](#autenticação-e-sso)
- [Stack Técnico](#stack-técnico)
- [Banco de Dados e Migrações](#banco-de-dados-e-migrações)
- [Segurança](#segurança)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Quick Start](#quick-start)
- [Deploy](#deploy)
- [API Reference](#api-reference)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Desenvolvimento](#desenvolvimento)

---

## O que é e como funciona

AURA é uma plataforma **auto-hospedada** que orquestra agentes de IA ao longo do ciclo de vida do desenvolvimento de software. O sistema **não é um chatbot** — é um orquestrador que monitora o backlog, roteia cards por um pipeline configurável de estágios e, em cada estágio, chama um agente especializado (LLM) para executar uma tarefa real: refinar requisitos, tomar decisão arquitetural, gerar e commitar código, revisar segurança, validar contra critérios de aceite.

**O AURA é o orquestrador. Os projetos dos squads são os repositórios externos.**

Os agentes rodam dentro do AURA mas lêem e escrevem nos repositórios dos projetos reais via API Git. O AURA nunca modifica seu próprio código em tempo de execução.

### O que o sistema faz automaticamente

- Detecta cards entrando em colunas configuradas como gatilho no Jira/Azure
- Carrega o contexto real do repositório (estrutura de arquivos, código-fonte, `design-system.md`, `AGENTS.md`, tokens Tailwind) antes de chamar o LLM
- Chama o LLM de cada agente com soul content + skills + histórico de decisões do run
- Valida o output via harness antes de qualquer ação destrutiva
- Executa testes no repositório num container Docker isolado antes de abrir PR
- Commita código nos repositórios Git configurados (GitLab, GitHub, Bitbucket)
- Abre Pull Requests / Merge Requests com CI polling automático
- Posta comentários estruturados nos cards com o resultado de cada agente
- Emite story points estimados automaticamente após a etapa de arquitetura
- Avança o card para a próxima coluna quando o estágio é concluído
- Acumula decisões de cada etapa e injeta como contexto nas etapas seguintes
- Detecta loops semânticos e escala para humano quando detectado
- Transmite eventos em tempo real via SSE para o dashboard

---

## Arquitetura geral

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                 AURA                                      │
│                          Next.js 16 (App Router)                         │
│                                                                            │
│  ┌─────────────────────┐         ┌────────────────────────────────────┐   │
│  │   UI (React 19)     │◀──SSE───│      API Routes (~150 handlers)    │   │
│  │   Tailwind CSS 3    │         │  Auth JWT + RBAC (viewer/op/admin) │   │
│  │   Zustand           │         │  Rate limiting por IP + endpoint   │   │
│  └─────────────────────┘         └───────────────────┬────────────────┘   │
│                                                       │                    │
│                                  ┌────────────────────▼────────────────┐  │
│                                  │      Event Bus in-process (SSE)     │  │
│                                  │  pipeline.* · task.* · agent.*     │  │
│                                  └────────────────────┬────────────────┘  │
│                                                       │                    │
│                                  ┌────────────────────▼────────────────┐  │
│                                  │             MySQL 8                  │  │
│                                  │  pipeline_card_runs (context + snap) │  │
│                                  │  pipeline_card_messages              │  │
│                                  │  pipeline_quality_metrics            │  │
│                                  │  agents · tasks · token_usage        │  │
│                                  │  git_repositories · work_pipelines   │  │
│                                  │  skills · memory · audit_log         │  │
│                                  └────────────────────┬────────────────┘  │
│                                                       │                    │
│                                  ┌────────────────────▼────────────────┐  │
│                                  │         Pipeline Engine             │  │
│                                  │    (scheduler — tick a cada 10s)   │  │
│                                  │                                     │  │
│                                  │  1. discoverNewCards()              │  │
│                                  │  2. saveStageSnapshot() (rollback)  │  │
│                                  │  3. callAgentLLM()                  │  │
│                                  │  4. validateAgentOutput() (harness) │  │
│                                  │  5. detectSemanticLoop()            │  │
│                                  │  6. appendContextSummary()          │  │
│                                  │  7. runSandboxTests() (Docker)      │  │
│                                  │  8. pushFilesToRepos() / openPR()   │  │
│                                  │  9. advanceToNextColumn()           │  │
│                                  │  10. eventBus.broadcast(SSE)        │  │
│                                  └────────────────────┬────────────────┘  │
└──────────────────────────────────────────────────────┼────────────────────┘
                                                        │
              ┌─────────────────────────────────────────▼──────────────────┐
              │                   Serviços Externos                         │
              │  Jira / Azure DevOps  │  GitLab / GitHub / Bitbucket       │
              │  Anthropic / OpenAI / Gemini / Groq / OpenRouter / Ollama  │
              │  Docker (sandbox)     │  Second Brain (EC2, opcional)       │
              └─────────────────────────────────────────────────────────────┘
```

---

## Pipeline Engine — núcleo do sistema

O Pipeline Engine é o coração do AURA. Roda como tarefa de background no scheduler (`tickPipelineEngine()` a cada 10 segundos, definido em `src/lib/pipeline-engine.ts`). Toda a lógica de orquestração está neste único arquivo (~4500 linhas).

### Fluxo completo de um card

```
1. discoverNewCards()
   └── busca cards no Jira/Azure que estão na coluna trigger
   └── cria registro em pipeline_card_runs (status: running)

2. startColumn(run, column)
   ├── saveStageSnapshot()          — salva snapshot para rollback
   ├── Para cada agente da coluna:
   │   ├── fetchRepoContext()        — lê árvore + fontes do repo via API Git
   │   ├── searchKnowledge()         — consulta Second Brain (BA/PM)
   │   ├── describeAttachmentImages() — descreve imagens do card via LLM de visão
   │   ├── formatContextSummary()    — injeta histórico de decisões anteriores
   │   ├── callAgentLLM()            — chama o LLM com o prompt completo
   │   ├── validateAgentOutput()     — harness: secrets, gate, completude
   │   ├── detectSemanticLoop()      — detecta ciclo → waiting_input se loop
   │   ├── appendContextSummary()    — acumula decisão no context_summary_json
   │   ├── eventBus.broadcast(pipeline.agent_output) — SSE em tempo real
   │   ├── runSandboxTests()         — roda testes no Docker se TEST_CMD presente
   │   ├── pushFilesToRepos()        — commita código se ### FILE: presente
   │   └── openPRForRepo()           — abre MR/PR se OPEN_PR: true
   └── generateEstimate()            — estima story points após arquiteto (não-bloqueante)

3. advanceToNextColumn()
   ├── Se requires_human_approval: pausa → waiting_input → @mention para continuar
   ├── moveCard() — move o card no Jira/Azure para a próxima coluna
   └── startColumn() recursivo para a próxima etapa

4. Run concluído
   └── addKnowledge() — grava aprendizado no Second Brain
```

### Resolução de repositório

A cada etapa, o engine resolve qual repositório usar na seguinte ordem de prioridade:

1. **`repo_id`** definido no dropdown por agente na UI de pipeline
2. **`linkedRepoIds[0..N]`** do `config_json` do pipeline — validados com token ativo
3. Primeiro repositório ativo com token no workspace (fallback automático)
4. Último resort: qualquer repositório no sistema com token (cross-workspace, com warning no log)

Quando um repositório é deletado (`DELETE /api/workspace/git-repositories/:id`), o código limpa automaticamente o `linkedRepoIds` em todos os pipelines e o `assignments_json` de todas as colunas, evitando referências inválidas silenciosas.

### Memória de contexto por run

**Problema resolvido:** em pipelines com 5+ etapas, o agente Developer que entra na etapa de correção não sabia o que o Arquiteto havia decidido 3 etapas antes. Sem contexto acumulado, os agentes contradiziam decisões anteriores.

**Implementação:** a tabela `pipeline_card_runs` tem a coluna `context_summary_json` (TEXT). A função `appendContextSummary()` é chamada após cada agente finalizar e acumula até 20 entradas:

```json
[
  {
    "stage": "Análise de Negócio",
    "agent": "Ana",
    "role": "business analyst",
    "decision": "Fluxo de contestação envolve 3 sistemas: core bancário, processadora e antifraude.",
    "gate": "ANALYSIS: READY",
    "timestamp": 1726400000
  },
  {
    "stage": "Arquitetura",
    "agent": "Bruno",
    "role": "software architect",
    "decision": "Solução via evento assíncrono Kafka — consumidor no serviço de contestação.",
    "gate": "ARCHITECTURE: APPROVED",
    "timestamp": 1726400120
  }
]
```

O bloco `## Histórico de decisões deste card` é injetado no início de cada prompt via `formatContextSummary()`. O agente Developer chega na etapa conhecendo todas as decisões anteriores — sem repetir perguntas já respondidas.

### Detecção de loop semântico

**Problema resolvido:** o guard `run_count > 10` não detectava loops sutis: QA reprova → Developer corrige → QA reprova com crítica diferente → indefinidamente.

**Implementação:** `detectSemanticLoop()` é chamado após cada output de agente. Verifica:
1. A etapa atual foi executada ≥ 3 vezes (`LOOP_STAGE_THRESHOLD`)
2. Os primeiros 100 chars dos últimos 3 outputs são similares

Se detectado:
- Posta aviso no card com instrução de intervenção humana
- Muda status para `waiting_input`
- Loga atividade `pipeline.loop_detected`
- Humano responde `reprocessar` (com nova instrução) ou `cancelar`

### Aprovação humana por etapa

A coluna do pipeline tem o campo `requires_human_approval` (INTEGER 0/1, migration 069).

Quando `advanceToNextColumn()` tenta entrar numa coluna com `requires_human_approval = 1`:
1. **Não executa os agentes**
2. Posta comentário no card: `⏸️ Aprovação necessária — [nome da etapa]`
3. Muda status para `waiting_input`
4. O humano responde `avançar` no Jira → `processInboundComments()` detecta e chama `advanceToNextColumn()` de verdade

Configurado na UI de pipeline editando as colunas.

### QA gate — reenvio ao developer

Quando a etapa tem um agente com role `qa engineer` e o output contém `REPROVADO` (case-insensitive), o engine:
1. Localiza a coluna com agente Developer na mesma pipeline
2. Limpa as mensagens daquela etapa (re-execução limpa)
3. Posta o feedback do QA no card
4. Move o card de volta para a coluna de desenvolvimento
5. Registra métricas `qa_rejected` e `rework_triggered` em `pipeline_quality_metrics`

### Estimativa automática de story points

Após o agente arquiteto concluir sua etapa, `generateEstimate()` é disparada de forma **não-bloqueante** (`.catch()` absorve falhas, o pipeline não espera):

```ts
generateEstimate(run, column, cfg, agent, llmResult.text, stageRepos).catch(...)
```

O prompt enviado ao LLM inclui:
- Descrição do card
- Output completo do arquiteto (decisão técnica)
- Lista de repositórios afetados

O agente deve responder no formato:
```
ESTIMATIVA: 5
CONFIANÇA: Média

JUSTIFICATIVA:
- Complexidade técnica: Novo consumer Kafka + migração de schema
- Repositórios afetados: 2 (api-contestacao, core-banking-adapter)
...
```

O resultado é postado no card como comentário `📊 Estimativa automática` e gravado em `pipeline_quality_metrics` com `metric_type = 'story_points_estimate'`.

**Nenhum modelo ou provider é hardcoded** — usa `resolveProviderAndModel(cfg, assignmentModel, 'simple')`, o mesmo mecanismo de todos os outros agentes.

### Replay e rollback de etapas

Antes de iniciar cada etapa, `saveStageSnapshot()` salva o estado atual em `stage_snapshots_json` (coluna TEXT em `pipeline_card_runs`, migration 072):

```json
[
  {
    "stage_id": "42",
    "stage_name": "Implementação",
    "card_key": "AURA-123",
    "status_before": "running",
    "messages_count": 8,
    "timestamp": 1726400000
  }
]
```

**API de rollback:**

```bash
# Listar snapshots disponíveis
GET /api/pipeline/engine/runs?id=<run_id>&snapshots=1

# Rollback para uma etapa específica
POST /api/pipeline/engine/runs
{
  "action": "rollback",
  "run_id": 123,
  "stage_id": "42"
}
```

O rollback:
1. Limpa as mensagens de todas as etapas com `column_order >= etapa alvo`
2. Remove as entradas correspondentes do `context_summary_json`
3. Restaura `current_stage_id` e reinicia o `startColumn()` da etapa escolhida

---

## Harness de Validação

O harness (`src/lib/agent-harness.ts`) valida o output de cada agente antes de qualquer ação — commit, abertura de PR ou avanço de card. É a última linha de defesa antes de uma ação irreversível.

### O que é validado

| Check | Descrição |
|---|---|
| Resposta vazia ou muito curta | Abaixo do mínimo por papel (ex: arquiteto < 400 chars) |
| Secrets/credenciais | Detecta patterns de API keys, tokens, private keys no texto gerado |
| Gate obrigatório ausente | Cada papel deve emitir seu gate (`ARCHITECTURE: APPROVED`, etc.) |
| Bloco FILE sem código | `### FILE:` sem bloco fenced subsequente — causaria push de arquivo vazio |

### Quando rejeita

1. Posta comentário no card explicando o motivo específico
2. Solicita intervenção humana
3. Status → `waiting_input`
4. Grava métrica `gate_rejected` em `pipeline_quality_metrics`

O humano responde `@pipeline reprocessar` ou `@pipeline reprocessar com foco em X` para retomar.

### Gates por papel

| Papel | Gate esperado |
|---|---|
| `software architect` | `ARCHITECTURE: APPROVED / BLOCKED / APPROVED_WITH_CONDITIONS` |
| `security auditor` | `SECURITY: APPROVED / BLOCKED / NOT_APPLICABLE` |
| `qa engineer` | `VERDICT: APPROVED / CHANGES_REQUESTED / BLOCKED` |
| `business analyst` | `ANALYSIS: READY / BLOCKED / NOT_APPLICABLE` |
| `data engineer` | `DATA: APPROVED / BLOCKED / NOT_APPLICABLE` |
| `ux designer` | `UX: APPROVED / BLOCKED / NOT_APPLICABLE` |
| `product manager` | `PRODUCT: READY / BLOCKED` |

`NOT_APPLICABLE` permite passar o card adiante quando a skill não se aplica (ex: UX em task técnica sem impacto na interface).

---

## LLM-as-judge — avaliação pelo Coordinator

A skill do Coordinator (`swe-orchestration-coordination`) instrui o agente a agir como **avaliador independente** antes de qualquer ação irreversível.

### 6 critérios avaliados

1. **Completude** — O output atende todos os critérios de aceite do card?
2. **Ausência de invenção** — O agente criou arquivos, endpoints ou comportamentos inexistentes?
3. **Ausência de alucinação** — Declarou ter executado ações sem evidência?
4. **Segurança** — Contém secrets, operações destrutivas não autorizadas?
5. **Escopo** — Alterações fora do escopo do card?
6. **Rastreabilidade** — Registrou o que foi feito, por que e qual evidência?

### Decisão

- Todos aprovados → libera a ação, registra no Jira
- Qualquer reprovado → bloqueia, comenta no card com o critério e motivo, solicita reexecução
- Mesma reprovação após 2 tentativas → `COORDINATION: BLOCKED`, escala para humano

---

## Sistema de Skills

Skills são arquivos `SKILL.md` dentro de `skills/`. Cada arquivo define: processo, gates de saída, saídas obrigatórias e antipadrões para um papel específico.

### Como chegam ao agente

1. `syncSkillsFromDisk()` (no scheduler) lê os `SKILL.md` e sincroniza a tabela `skills`
2. `loadAgentSkills(workspaceId)` lê a tabela e retorna o conteúdo concatenado
3. O conteúdo é injetado no **system prompt** (não no prompt do usuário) via `agentSystemPrompt(agent)`:

```typescript
if (agent._skills?.trim()) {
  parts.push(`\n## Suas skills\n\n${agent._skills.trim()}`)
}
```

### Skills disponíveis

| Skill | Papel | Destaques |
|---|---|---|
| `swe-orchestration-coordination` | Coordinator/Aegis | LLM-as-judge, gate de aprovação humana, rastreabilidade |
| `swe-software-architecture` | Arquiteto | Decisão técnica autônoma, code review arquitetural, Second Brain |
| `swe-implementation-practices` | Developer | TEST_CMD para sandbox, design-system.md, contexto visual, feedback loop CI |
| `swe-business-analysis` | BA | Critérios visuais de wireframes, Second Brain record, rastreabilidade |
| `swe-product-management` | PM/PO | Outcomes, métricas, Second Brain |
| `swe-security-review` | Security Auditor | Auth, autorização, dados sensíveis |
| `swe-quality-gates` | QA | Execução de testes automatizados, rastreabilidade |
| `swe-data-engineering` | Data Engineer | Schemas, migrações seguras |
| `swe-architecture-and-data` | Arquiteto/Data | Mudanças estruturais de dados |
| `swe-release-operations` | DevOps | Deploy, rollback, observabilidade |
| `swe-ux-research` | UX | Jornadas, estados, acessibilidade |
| `swe-flow-management` | Scrum Master | WIP, aging, bloqueios |
| `swe-backlog-prioritization` | PO | Priorização por valor e risco |
| `swe-discovery-practices` | Discovery | Hipóteses, experimentos |

### Formato de entrega de código

O agente Developer deve usar este formato para que o engine detecte e commite:

```
### FILE: src/services/contestacao/ContestacaoService.ts
```typescript
export class ContestacaoService {
  // conteúdo completo
}
```
COMMIT: feat(contestacao): implementa processamento de chargeback via Kafka
```

Para múltiplos repositórios:
```
### FILE: [api-contestacao]: src/services/ContestacaoService.ts
### FILE: [core-banking-adapter]: src/events/ChargebackConsumer.java
```

Para solicitar abertura de PR/MR:
```
OPEN_PR: true
```

Para acionar o sandbox de testes:
```
TEST_CMD: pnpm test --run
```

---

## Agent Communication — @mention no Jira

`processInboundComments()` lê comentários novos do card a cada tick (usando `last_comment_ts` para evitar reler o mesmo comentário). Reconhece:

### Comandos do pipeline
| Comando | Ação |
|---|---|
| `avançar` | Avança para próxima etapa (útil após `waiting_input`) |
| `cancelar` | Cancela o run imediatamente |
| `reprocessar` | Reexecuta a etapa atual |
| `reprocessar tudo` | Reinicia da primeira coluna |

### @mention de agente específico

```
@pedro analise o risco de segurança desta mudança
@arquiteto revise a decisão de usar Kafka aqui
@qa execute somente os testes de integração
```

O engine busca o agente pelo nome (case-insensitive, match parcial) em **qualquer coluna do pipeline** — não apenas na coluna atual. Executa o agente com o contexto completo do card + histórico de decisões e posta a resposta como comentário.

### @pipeline / @aura (mention genérico)

```
@pipeline reprocesse com foco em performance
@aura qual foi a decisão arquitetural anterior?
```

Aciona `executeMentionInstruction()` com o agente da etapa atual.

### Prevenção de eco

O `external_comment_id` de cada comentário postado pelo AURA é salvo em `pipeline_card_messages`. Antes de processar um comentário, o sistema verifica se o ID já existe como `agent_to_card` — evitando que o AURA releia seus próprios comentários como comandos de usuário.

---

## Sandbox Docker — testes antes do PR

Antes de abrir um PR, o pipeline executa os testes do repositório num container Docker efêmero e isolado. Se os testes falharem, o PR não é aberto.

### Como funciona

1. O agente Developer inclui `TEST_CMD: pnpm test --run` no seu output
2. O engine detecta via `extractTestCommand()` em `src/lib/sandbox-runner.ts`
3. Clona o repositório com `git clone --depth 1` num diretório temporário (`/tmp/aura-sandbox-XXXX`)
4. Lança um container Docker:
```bash
docker run --rm \
  --network none \           # sem acesso à internet
  --memory 512m \            # limite de memória
  --cpus 1 \                 # limite de CPU
  --read-only \              # filesystem read-only
  --tmpfs /tmp:rw,size=256m \
  --volume "/tmp/aura-sandbox-XXXX:/workspace:ro" \
  node:22-alpine \
  sh -c "pnpm test --run"
```
5. Captura stdout/stderr e exit code
6. Limpa o diretório temporário (sempre, via `finally`)
7. Posta resultado no card: `✅ Testes passaram (12.3s)` ou `❌ Testes falharam`
8. Se falharam → `waiting_input` (humano decide reprocessar ou cancelar). PR não é aberto.

### Configuração do Docker socket

O container do AURA precisa de acesso ao Docker socket para lançar containers filhos. Configure no `docker-compose.yml`:

```yaml
volumes:
  - vcc-data:/app/.data
  - /var/run/docker.sock:/var/run/docker.sock
```

> **Nota de segurança:** expor o socket Docker permite que o AURA lance qualquer container no host. Aceitável em ambiente corporativo interno. Para SaaS multi-tenant, prefira um runner dedicado.

### Detecção automática de imagem

O `sandbox-runner.ts` detecta a linguagem pelo conteúdo do repositório e escolhe a imagem:

| Indicador detectado | Imagem padrão |
|---|---|
| `package.json`, `.ts`, `.js` | `node:22-alpine` |
| `requirements.txt`, `.py` | `python:3.12-slim` |
| `pom.xml`, `.java` | `eclipse-temurin:21-jdk-alpine` |
| `go.mod`, `.go` | `golang:1.22-alpine` |
| `Cargo.toml`, `.rs` | `rust:1.78-alpine` |

Todas as imagens são parametrizáveis via env (`SANDBOX_IMAGE_NODE`, `SANDBOX_IMAGE_PYTHON`, etc.).

### Proteção contra comandos destrutivos

`extractTestCommand()` bloqueia patterns perigosos antes de executar:
```
rm -rf, dd if, mkfs, shutdown, reboot, kill -9 1, curl | sh, wget | sh
```

---

## Screenshot-to-Code — imagens do card

Quando um card do Jira/Azure tem screenshots ou wireframes como attachments, o sistema os descreve automaticamente via LLM de visão e injeta a descrição no prompt do Developer e do BA.

### Fluxo

1. `fetchJiraAttachments()` / `fetchAzureAttachments()` — busca imagens do card (PNG, JPG, GIF, WEBP, SVG, até 10 MB)
2. `downloadJiraAttachment()` / `downloadAzureAttachment()` — baixa como base64
3. `describeAttachmentImages()` — para cada imagem (até 3 por execução):
   - Chama o LLM configurado no pipeline com a imagem em base64
   - Recebe descrição estruturada: layout, componentes, hierarquia, textos visíveis, estados, cores
4. O bloco `## 🖼️ Contexto visual` é injetado antes das instruções do agente

### Providers com suporte a visão

| Provider | Formato enviado |
|---|---|
| Anthropic | `{ type: "image", source: { type: "base64", data: ... } }` |
| OpenAI / OpenRouter | `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }` |
| Gemini | `{ inline_data: { mime_type: "image/png", data: ... } }` |
| Ollama / outros | Texto informando o arquivo para análise manual |

**Nenhum provider ou modelo é hardcoded.** A mesma lógica de `resolveProviderAndModel(cfg, assignmentModel, 'simple')` é usada — o LLM configurado no dropdown da coluna é o que analisa as imagens.

---

## Design System por repositório

O `fetchRepoContext()` lê automaticamente arquivos de design system quando existem no repositório do **projeto cliente** (não no AURA):

```
design-system.md         DESIGN-SYSTEM.md
design-tokens.md         design-tokens.json
design-tokens.ts         design-tokens.js
tailwind.config.ts       tailwind.config.js
src/styles/tokens.css    src/styles/globals.css
src/app/globals.css      AGENTS.md
```

Esses arquivos são lidos **antes** dos arquivos de código-fonte e injetados no prompt como parte do contexto do repositório. O agente Developer não precisa adivinhar quais componentes usar — vê a especificação real do design system do projeto.

**Para usar:** crie um `design-system.md` no repositório do projeto com os tokens, componentes disponíveis e anti-padrões. O AURA lo lerá automaticamente.

---

## Feedback loop de CI e PR

### CI automático (GitHub)

Quando o agente abre um PR com `OPEN_PR: true` em um repositório GitHub, o engine armazena o `pr_check_json` e faz polling da GitHub Checks API a cada tick:

```json
{
  "repoId": 5,
  "stageId": "42",
  "owner": "efí-bank",
  "repo": "api-cartoes",
  "prNumber": 138,
  "ci_fix_count": 0
}
```

- **CI passou** → limpa `pr_check_json`, avança para próxima etapa
- **CI falhou** → agente Developer tenta corrigir automaticamente (até `MAX_CI_FIX_ATTEMPTS = 3`)
  - Lê log de erros do CI
  - Gera correção via LLM
  - Faz push na mesma branch
  - Incrementa `ci_fix_count`
  - Após 3 tentativas: `waiting_input`, humano intervém

### PR Review (polling de aprovação)

`pr_review_json` armazena o PR aberto para monitoramento de reviews humanos. A função `checkPRReviewFeedback()` verifica a cada tick:

- **Aprovado** (`LGTM`, `APPROVED`, `looks good`) → avança para próxima etapa. Registra `pr_approved`.
- **Rejeitado** (`CHANGES_REQUESTED`, `reprovado`, `precisa corrigir`) → fecha o PR via GitHub API (`PATCH /pulls/:number` com `state: closed`), posta feedback no card, `waiting_input`. Humano decide `reprocessar` (com novo contexto) ou `cancelar`.

---

## Second Brain

O Second Brain é um serviço externo opcional de base de conhecimento semântica por domínio de negócio, hospedado num EC2 separado.

### Quando é usado

**Antes** de executar agentes BA, PM e PO:
1. `inferDomain()` detecta o domínio pelo título e descrição do card (`cartoes`, `pix`, `cobranca`, etc.)
2. `searchKnowledge()` busca até 5 entradas relevantes no Second Brain
3. `formatKnowledgeContext()` formata como bloco Markdown
4. O contexto é injetado antes do `buildPrompt()`

**Após** cada card concluído:
- `addKnowledge()` grava o título, descrição e domínio — o Second Brain aprende com cada entrega

### Skills que gravam no Second Brain

BA e Arquiteto instruem a produzir um `[SECOND_BRAIN: RECORD]` ao finalizar:

```
[SECOND_BRAIN: RECORD]
Domínio: cartoes
Card: AURA-123
Regras descobertas: Lançamento após fechamento entra na próxima fatura
Padrões aplicados: Event-driven com Kafka para processamento assíncrono
Lições: Timeout no consumer deve ser de 30s (regra da processadora)
```

### Configuração

```env
SECOND_BRAIN_URL=http://seu-ec2.interno.com:8080
```

Se não configurado, o sistema funciona normalmente sem o Second Brain (todas as chamadas retornam vazio sem erro).

---

## Observabilidade em tempo real (SSE)

O AURA usa **Server-Sent Events** (SSE) para comunicação em tempo real entre o backend e a UI. A arquitetura usa um **event bus in-process** (`src/lib/event-bus.ts`) — não há WebSocket, não há Redis, não há infra adicional.

### Como funciona

```
Pipeline Engine
    └── eventBus.broadcast('pipeline.agent_output', { run_id, agent, tokens, ... })

Event Bus
    └── emite para todos os listeners registrados no processo Node

SSE Route Handler (/api/pipeline/stream)
    └── filtra por workspace_id e run_id
    └── serializa como text/event-stream
    └── envia para o browser via ReadableStream
```

### Rota de streaming do pipeline

```
GET /api/pipeline/stream?run_id=<id>
```

Filtros:
- `run_id` (opcional) — filtra eventos de um run específico
- workspace é sempre filtrado pelo token de sessão do usuário

**Eventos emitidos:**

| Evento | Payload | Quando |
|---|---|---|
| `pipeline.stage_started` | `{ run_id, card_key, stage, agent }` | Etapa iniciou |
| `pipeline.agent_output` | `{ run_id, agent, role, output_preview, tokens_in, tokens_out, model }` | Agente finalizou |
| `pipeline.run_completed` | `{ run_id, card_key }` | Esteira concluída |
| `pipeline.awaiting_approval` | `{ run_id, card_key, stage }` | Aguardando aprovação humana |
| `pipeline.loop_detected` | `{ run_id, card_key, stage, agent }` | Loop semântico detectado |
| `pipeline.sandbox_failed` | `{ run_id, card_key, stage, agent }` | Testes Docker falharam |
| `pipeline.ci_failed` | `{ run_id, card_key, pr_number }` | CI falhou |
| `pipeline.ci_passed` | `{ run_id, card_key, pr_number }` | CI passou |

**Heartbeat:** enviado a cada 20 segundos para manter a conexão viva através de proxies/load balancers. Configuração nginx recomendada:

```nginx
proxy_buffering off;
proxy_read_timeout 3600s;
```

### Rota de streaming de tasks (existente)

```
GET /api/v1/runs/stream
```

Emite `run.created`, `run.updated`, `run.completed` para o dashboard de tarefas.

---

## Métricas de qualidade

A tabela `pipeline_quality_metrics` (migration 071) acumula eventos de qualidade do pipeline ao longo do tempo. Não é necessário configurar nada — o engine grava automaticamente.

### Tipos de métricas

| `metric_type` | Quando gravado | `value_num` | `value_text` |
|---|---|---|---|
| `gate_passed` | Harness aprovou o output | — | `"ok"` |
| `gate_rejected` | Harness rejeitou | — | motivo da rejeição |
| `stage_duration_sec` | Etapa concluída | duração em segundos | — |
| `qa_approved` | QA emitiu VERDICT: APPROVED | — | — |
| `qa_rejected` | QA emitiu CHANGES_REQUESTED | — | etapa de destino |
| `rework_triggered` | Card voltou para etapa anterior | — | etapa de origem |
| `story_points_estimate` | Estimativa após arquiteto | story points | output completo |
| `pr_approved` | PR aprovado por revisor humano | 1 | — |
| `pr_rejected` | PR rejeitado e fechado | — | — |

### API

```
GET /api/pipeline/quality-metrics?days=30&stage=Implementação&agent=Developer
```

Resposta:
```json
{
  "summary": {
    "overall_gate_approval_rate": 87,
    "total_rework_events": 3,
    "pr_approval_rate": 94,
    "avg_stage_duration_sec": 145
  },
  "gates": [
    { "stage": "QA", "agent": "QA Bot", "passed": 12, "rejected": 2, "approval_rate": 86 }
  ],
  "stages": [
    { "stage": "Arquitetura", "avg_duration_sec": 234, "count": 8 }
  ],
  "rework": [
    { "from_stage": "QA", "to_stage": "Implementação", "count": 3 }
  ],
  "estimates": [
    { "card_key": "AURA-45", "points": 5, "created_at": 1726400000 }
  ]
}
```

---

## Multi-repositório

Quando há múltiplos repositórios vinculados no pipeline:

1. O engine carrega o contexto de todos via `fetchRepoContext()` — cada um como objeto `{ id, name, context }`
2. O prompt inclui o contexto de todos, prefixado com `[nome-repo]:`
3. O agente usa o formato com prefixo ao gerar arquivos:

```
### FILE: [api-cartoes]: src/services/FaturaService.java
### FILE: [frontend-cartoes]: src/components/FaturaCard.tsx
COMMIT: feat(fatura): exibe saldo devedor no componente de fatura
```

4. `pushFilesToRepos()` detecta o prefixo e commita cada arquivo no repositório correto

---

## Repositórios Git — providers e commits

### Providers suportados

| Provider | Commit | Contexto (`fetchRepoContext`) | MR/PR |
|---|---|---|---|
| **GitLab** | ✅ API v4 `POST /repository/commits` | ✅ Tree API recursiva + raw files | ✅ Merge Request |
| **GitHub** | ✅ Contents API `PUT /contents/:path` | ✅ Git Trees API recursiva | ✅ Pull Request |
| **Bitbucket** | ✅ `POST /src` multipart | ✅ Src API paginada | ❌ |

### Contexto do repositório

`fetchRepoContext()` lê até 160K chars (~40K tokens) do repositório antes de chamar o LLM:

1. Árvore de diretórios (até 300 linhas, 2 níveis de profundidade)
2. Arquivos de arquitetura (`README.md`, `ARCHITECTURE.md`, `design-system.md`, `AGENTS.md`, `tailwind.config.*`, etc.)
3. Código-fonte por extensão detectada, priorizando `src/ > lib/ > app/` e descartando `node_modules/`, `.git/`, `dist/`, `.next/`

### Segurança do token

O `access_token` é **obrigatório** ao criar. Ao editar, deixar o campo vazio **mantém** o token existente — nunca sobrescreve com vazio. Ao deletar o repositório, o endpoint `DELETE /api/workspace/git-repositories/:id` limpa automaticamente todos os `linkedRepoIds` e `assignments_json` que referenciam o repo deletado.

---

## Autenticação e SSO

### Login local

Formulário username/password com JWT. Credenciais padrão: `admin` / `admin` — altere imediatamente em produção.

### Azure AD (SSO corporativo)

O botão "Entrar com Microsoft" está sempre visível na tela de login. Fica desabilitado com texto "em breve" quando `NEXT_PUBLIC_AZURE_CLIENT_ID` não está configurado.

Para habilitar:
1. Registre o app no Azure Portal (`portal.azure.com → App registrations`)
2. Configure o Redirect URI: `https://seu-dominio.com/api/auth/azure/callback`
3. Configure as variáveis de ambiente:

```env
NEXT_PUBLIC_AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

O flow implementado será OIDC Authorization Code com PKCE — o usuário é redirecionado para `login.microsoftonline.com`, autentica com as credenciais corporativas e retorna com um token. O AURA cria a sessão sem precisar de senha separada.

> **Status atual:** o botão está implementado no frontend. As rotas `/api/auth/azure/login` e `/api/auth/azure/callback` estão planejadas — aguardando configuração do app no Azure Portal.

---

## Stack Técnico

| Camada | Tecnologia | Notas |
|---|---|---|
| Framework | Next.js 16 — App Router | Server components + route handlers |
| UI | React 19, Tailwind CSS 3 | Painéis client com navegação via `startTransition` |
| Linguagem | TypeScript 5 strict | |
| Banco | MySQL 8 via `mysql2` | Pool de conexões, 72 migrações automáticas |
| Estado | Zustand | Estado client-side de painéis e filtros |
| Tempo real | Server-Sent Events (SSE) | Event bus in-process, sem Redis, sem WebSocket |
| Auth | JWT + RBAC | `viewer` · `operator` · `admin` |
| Pacotes | pnpm 11 | `--frozen-lockfile` no CI |
| LLM Providers | Anthropic, OpenAI, Gemini, Groq, OpenRouter, DeepSeek, Moonshot, NVIDIA, Venice, Ollama | Multi-provider, fallback configurável (`fixed` ou `cascade`) |
| Git Providers | GitLab, GitHub, Bitbucket | Commits, MR/PR, leitura de contexto |
| Sandbox | Docker (via socket) | Containers efêmeros, sem rede, read-only |
| i18n | next-intl | Mensagens em `messages/pt.json` |

---

## Banco de Dados e Migrações

MySQL 8+. As migrações são incrementais e rodam automaticamente no startup via `runMigrations()` em `src/lib/migrations.ts`. Cada migração tem um `id` único — nunca é re-executada.

### Tabelas principais

| Tabela | Descrição |
|---|---|
| `agents` | Agentes com `soul_content`, `role`, `status`, `model`, `config` |
| `tasks` | Backlog interno (`inbox → assigned → in_progress → review → done`) |
| `pipeline_card_runs` | Uma linha por card ativo. Inclui `context_summary_json`, `stage_snapshots_json`, `pr_check_json`, `pr_review_json` |
| `pipeline_card_messages` | Histórico de cada run (`agent_to_card` / `card_to_agent`) com `external_comment_id` para dedup |
| `pipeline_columns` | Colunas com `assignments_json` (agentes + modelo + repo), `requires_human_approval` |
| `work_pipelines` | Config do pipeline: provider, LLM tiers, `linkedRepoIds`, `botMention` |
| `pipeline_quality_metrics` | Métricas de qualidade: gates, rework, duração, story points, PR reviews |
| `git_repositories` | URL, branch, `access_token`, provider, `base_url` |
| `token_usage` | Log de tokens por agente/modelo/sessão com custo em USD |
| `skills` | Skills sincronizadas do disco (path → tabela) |
| `memory` | Memória chave-valor por agente |
| `activities` | Log de atividades do sistema (feed da Visão Geral) |
| `audit_log` | Audit imutável de todas as mutações com ator e IP |
| `webhooks` | Webhooks de saída configurados |
| `workspaces` | Tenants multi-workspace |

### Reset em desenvolvimento

```bash
mysql -u root -e "DROP DATABASE IF EXISTS aura; CREATE DATABASE aura;"
pnpm dev   # migrações rodam automaticamente
```

---

## Segurança

### Controles implementados

| Controle | Implementação |
|---|---|
| **SSRF** | `isBlockedUrl()` bloqueia cloud-metadata (169.254.169.254), CIDRs privados (RFC 1918), loopback antes do allowlist |
| **Rate limiting** | Login: 5/min · Mutações: 60/min · Leituras: 120/min |
| **IP real** | Extraído da cadeia `MC_TRUSTED_PROXIES` — protege contra bypass via headers forjados |
| **CSP** | `script-src` com nonce + `'strict-dynamic'`, sem `unsafe-inline` |
| **HSTS** | max-age 2 anos + `includeSubDomains; preload` quando HTTPS |
| **Workspace isolation** | Toda query filtra por `workspace_id` — dados nunca vazam entre tenants |
| **RBAC** | `viewer` (leitura), `operator` (criar/editar), `admin` (acesso total) |
| **Token masking** | `access_token` de repositórios só retornado para `operator/admin` |
| **Audit log** | Toda mutação registrada com ator, IP e target |
| **Secret detection** | Harness detecta credenciais no output dos agentes antes de commitar |
| **Sandbox isolamento** | Containers Docker sem rede, read-only, com limite de memória/CPU/PID |
| **Comandos bloqueados** | `sandbox-runner.ts` bloqueia `rm -rf`, `dd if`, `mkfs`, `curl \| sh` etc. |

### Considerações para o arquiteto

**Tokens de repositório:** armazenados em plaintext no MySQL. Em produção: criptografia em repouso (MySQL TDE ou RDS encryption) + rotação periódica + tokens com escopo mínimo (`api` no GitLab, `repo` no GitHub).

**API keys de LLM:** armazenadas na tabela `settings`. Mesma recomendação acima.

**JWT secret (`AUTH_SECRET`):** gerado automaticamente no primeiro start e salvo em `.data/`. Em produção, defina explicitamente e mantenha num secrets manager (AWS Secrets Manager, HashiCorp Vault).

**Docker socket:** expor `/var/run/docker.sock` concede ao container do AURA controle total sobre o Docker host. Aceite apenas em redes internas com acesso restrito. Alternativa: Docker-in-Docker (DinD) em ambiente isolado.

**Second Brain:** recebe título e descrição de cards (pode conter dados de negócio sensíveis). Garanta comunicação via HTTPS e EC2 em VPC privada.

---

## Variáveis de Ambiente

### Banco de dados

| Variável | Padrão | Descrição |
|---|---|---|
| `MYSQL_HOST` | `localhost` | Host do MySQL |
| `MYSQL_PORT` | `3306` | Porta |
| `MYSQL_USER` | `root` | Usuário |
| `MYSQL_PASSWORD` | _(vazio)_ | Senha |
| `MYSQL_DATABASE` | `aura` | Nome do banco |
| `MYSQL_SSL` | `false` | Habilita TLS |

### Autenticação

| Variável | Padrão | Descrição |
|---|---|---|
| `AUTH_SECRET` | auto-gerado | Secret JWT. Rotacione para invalidar todas as sessões. |
| `API_KEY` | auto-gerado | API key mestre para acesso programático |
| `AUTH_USER` | `admin` | Usuário admin padrão (primeiro start) |
| `AUTH_PASS` | `admin` | Senha admin — **altere imediatamente** |
| `AUTH_PASS_B64` | _(vazio)_ | Senha em base64 (use quando contém `#`) |

### Azure AD (SSO)

| Variável | Descrição |
|---|---|
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Client ID público (habilita botão Microsoft na UI) |
| `AZURE_CLIENT_ID` | Client ID do app registrado |
| `AZURE_CLIENT_SECRET` | Client secret |
| `AZURE_TENANT_ID` | Tenant ID do Azure AD corporativo |

### Segurança de rede

| Variável | Padrão | Descrição |
|---|---|---|
| `MC_TRUSTED_PROXIES` | _(nenhum)_ | IPs dos proxies reversos confiáveis |
| `MC_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hosts permitidos |
| `MC_ALLOW_ANY_HOST` | _(vazio)_ | `1` para desabilitar validação de host |
| `MC_ENABLE_HSTS` | `0` | Força HSTS |
| `MC_COOKIE_SECURE` | `0` | Marca cookies como Secure |
| `MC_COOKIE_SAMESITE` | `lax` | `lax` ou `strict` |

### LLM Providers

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT-4o, o3, etc.) |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek |

Configuráveis também pela tela de Integrações. Modelos `o1`/`o3` são detectados automaticamente e usam `max_completion_tokens`.

### Second Brain

| Variável | Descrição |
|---|---|
| `SECOND_BRAIN_URL` | URL do serviço (ex: `http://ec2.interno.com:8080`). Sem configuração, funciona sem Second Brain. |

### Sandbox Docker

| Variável | Padrão | Descrição |
|---|---|---|
| `SANDBOX_IMAGE_NODE` | `node:22-alpine` | Imagem para projetos Node/TS |
| `SANDBOX_IMAGE_PYTHON` | `python:3.12-slim` | Imagem para projetos Python |
| `SANDBOX_IMAGE_JAVA` | `eclipse-temurin:21-jdk-alpine` | Imagem para projetos Java |
| `SANDBOX_IMAGE_GO` | `golang:1.22-alpine` | Imagem para projetos Go |
| `SANDBOX_IMAGE_RUST` | `rust:1.78-alpine` | Imagem para projetos Rust |
| `SANDBOX_IMAGE_DEFAULT` | `node:22-alpine` | Fallback |
| `SANDBOX_TIMEOUT_MS` | `120000` | Timeout por execução (ms) |
| `SANDBOX_MEMORY` | `512m` | Limite de memória do container |
| `SANDBOX_CPUS` | `1` | Limite de CPUs |

---

## Quick Start

**Pré-requisitos:** Node.js ≥ 22, pnpm (`corepack enable`), MySQL 8+, Docker (opcional para sandbox)

```bash
git clone <repo>
cd aura
cp .env.example .env
# edite .env com as configurações do MySQL

pnpm install
pnpm dev
```

Acesse [http://localhost:3000](http://localhost:3000) — credenciais: `admin` / `admin`.

> **Primeiro acesso:** altere a senha em **Configurações → Usuários** imediatamente.

### Build de produção

```bash
pnpm build
node .next/standalone/server.js
```

### Docker

```bash
# Desenvolvimento (com MySQL)
docker compose -f docker-compose.dev.yml up

# Produção (FS read-only, rede interna, HSTS)
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

---

## Deploy

### Pré-requisitos de produção

1. MySQL 8+ com banco `aura` criado
2. Variáveis de ambiente (`AUTH_SECRET`, `AUTH_PASS`, `MYSQL_*`)
3. Reverse proxy (nginx/ALB) com TLS
4. `MC_TRUSTED_PROXIES` com o IP do proxy
5. `MC_ENABLE_HSTS=1`
6. Docker disponível no host se quiser o sandbox de testes

### Nginx — SSE requer configuração especial

```nginx
server {
    listen 443 ssl;
    server_name aura.suaempresa.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE: sem buffering, timeout longo
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_cache off;
    }
}
```

### CI/CD (GitLab)

O `.gitlab-ci.yml` tem três stages:

- **`validate`** — `pnpm typecheck` + `pnpm build` (em MR e push no master)
- **`release`** — build standalone + empacota `.tar.gz` + publica (push no master)
- **`deploy`** — deploy via SSM Run Command na EC2 (manual)

Usa `node:22-bullseye-slim`. O Debian Bullseye está arquivado — o CI usa `archive.debian.org`.

---

## API Reference

Especificação OpenAPI completa em `openapi.json`. Documentação interativa em `/docs`.

### Autenticação

```bash
# Sessão
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Bearer token
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $API_KEY"
```

### Endpoints de pipeline

| Método | Caminho | Role | Descrição |
|---|---|---|---|
| `GET` | `/api/pipeline/engine/runs` | viewer | Lista runs ativos/recentes |
| `GET` | `/api/pipeline/engine/runs?id=X&messages=1` | viewer | Mensagens de um run |
| `GET` | `/api/pipeline/engine/runs?id=X&snapshots=1` | viewer | Snapshots para rollback |
| `POST` | `/api/pipeline/engine/runs` | operator | `cancel`, `reprocess`, `rollback` |
| `GET` | `/api/pipeline/stream?run_id=X` | viewer | SSE em tempo real |
| `GET` | `/api/pipeline/quality-metrics?days=30` | viewer | Métricas de qualidade |

### Endpoints de configuração

| Método | Caminho | Role | Descrição |
|---|---|---|---|
| `GET/PUT` | `/api/workspace/work-pipelines` | viewer/operator | Pipelines |
| `GET/PUT` | `/api/workspace/work-pipelines/:id/columns` | viewer/operator | Colunas + `requires_human_approval` |
| `GET/PUT` | `/api/workspace/git-repositories` | viewer/operator | Repositórios Git |
| `POST` | `/api/workspace/git-repositories/:id/test` | operator | Testa conexão |
| `GET/POST` | `/api/agents` | viewer/operator | Agentes |
| `GET` | `/api/skills` | viewer | Skills sincronizadas |
| `GET` | `/api/tokens/by-agent` | viewer | Custo por agente |
| `GET` | `/api/tokens/compact-mode` | viewer | Comparativo modo econômico |
| `GET` | `/api/pipeline/quality-metrics` | viewer | Métricas de qualidade |

### SSE — como consumir

```javascript
const es = new EventSource('/api/pipeline/stream?run_id=123')

es.addEventListener('pipeline.agent_output', (e) => {
  const data = JSON.parse(e.data)
  console.log(`${data.agent}: ${data.output_preview} (${data.tokens_out} tokens)`)
})

es.addEventListener('pipeline.run_completed', (e) => {
  console.log('Esteira concluída:', JSON.parse(e.data))
  es.close()
})
```

---

## Estrutura do Projeto

```
src/
├── app/
│   ├── api/
│   │   ├── pipeline/
│   │   │   ├── engine/runs/route.ts   # cancel, reprocess, rollback, snapshots
│   │   │   ├── quality-metrics/       # métricas de gate, rework, duração
│   │   │   └── stream/route.ts        # SSE em tempo real por run
│   │   ├── admin/                     # diagnóstico e repair
│   │   ├── tokens/                    # custo por agente, compact-mode
│   │   ├── v1/runs/stream/            # SSE de tasks (existente)
│   │   └── workspace/                 # repos, pipelines, colunas
│   └── login/
│       └── page.tsx                   # botão Microsoft, sem Google
├── components/
│   └── panels/
│       └── overview-panel.tsx         # dashboard com widget de modo econômico
└── lib/
    ├── agent-harness.ts               # gates, secret detection, validação de saída
    ├── auth.ts                        # JWT + RBAC + sessões
    ├── db-pool.ts                     # pool MySQL (mysql2)
    ├── event-bus.ts                   # SSE in-process por workspace
    ├── migrations.ts                  # 72 migrações incrementais
    ├── pipeline-engine.ts             # ~4500 linhas — núcleo completo da orquestração
    │   # Inclui:
    │   #   appendContextSummary()     — memória de execução por run
    │   #   saveStageSnapshot()        — snapshots para replay/rollback
    │   #   rollbackToSnapshot()       — restaura estado anterior
    │   #   detectSemanticLoop()       — detecta ciclos
    │   #   describeAttachmentImages() — vision LLM para wireframes
    │   #   generateEstimate()         — story points automáticos
    │   #   runSandboxTests()          — testes no Docker antes do PR
    │   #   checkPRReviewFeedback()    — polling de reviews humanos
    │   #   checkAndAdvancePRCI()      — polling de CI GitHub
    ├── sandbox-runner.ts              # Docker: clone, run, cleanup
    ├── scheduler.ts                   # cron background
    ├── second-brain-client.ts         # HTTP client para Second Brain
    ├── skill-sync.ts                  # SKILL.md → tabela skills
    ├── task-dispatch.ts               # despacho Aegis (quality review)
    ├── token-pricing.ts               # custo USD por modelo
    ├── work-pipeline-azure.ts         # Azure DevOps + attachments
    └── work-pipeline-jira.ts          # Jira + attachments

skills/
├── swe-orchestration-coordination/SKILL.md   # LLM-as-judge, aprovação humana
├── swe-software-architecture/SKILL.md        # decisão técnica, Second Brain
├── swe-implementation-practices/SKILL.md     # TEST_CMD, design-system, visual
├── swe-business-analysis/SKILL.md            # critérios visuais, Second Brain
├── swe-product-management/SKILL.md
├── swe-security-review/SKILL.md
├── swe-quality-gates/SKILL.md                # testes automatizados
├── swe-data-engineering/SKILL.md
├── swe-architecture-and-data/SKILL.md
├── swe-release-operations/SKILL.md
├── swe-ux-research/SKILL.md
├── swe-flow-management/SKILL.md
├── swe-backlog-prioritization/SKILL.md
└── swe-discovery-practices/SKILL.md

.kiro/
└── steering/
    └── product-context.md    # domínios de negócio para BA/PM (injeção automática)
```

---

## Desenvolvimento

```bash
pnpm dev          # servidor dev (localhost:3000)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest --run
pnpm test:e2e     # playwright
pnpm build        # build de produção
```

### Adicionando um novo provider LLM

1. Adicione o case em `dispatchLLM()` em `pipeline-engine.ts`
2. Se compatível com OpenAI, adicione em `OPENAI_COMPAT_BASES` em `callOpenAICompatLLM()`
3. Se suportar visão, adicione o branch em `describeAttachmentImages()` com o formato de imagem correto
4. Adicione a integração na tela de Integrações (`integrations-panel.tsx`)
5. Adicione a chave em `resolveApiKey()` em `pipeline-engine.ts`

### Adicionando uma nova skill

1. Crie `skills/seu-skill/` com `SKILL.md` e `skill.json`
2. Frontmatter obrigatório em `SKILL.md`:
```yaml
---
name: seu-skill
description: Descrição curta do papel.
---
```
3. O scheduler sincroniza automaticamente para a tabela `skills`

### Adicionando uma nova migration

1. Adicione ao array `migrations` em `src/lib/migrations.ts` com `id` único
2. Use `PRAGMA table_info` para verificar se a coluna já existe (idempotência)
3. As migrações rodam automaticamente no próximo start

### Testando o sandbox localmente

```bash
# Verificar se Docker está disponível
docker info

# Testar manualmente
docker run --rm --network none --memory 512m node:22-alpine \
  sh -c "node -e 'console.log(\"sandbox ok\")'"
```

---

## Licença

MIT
