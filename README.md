<div align="center">

# AURA

### Plataforma de Orquestração de Agentes de IA para Squads de Desenvolvimento

AURA monitora seu backlog, distribui tarefas para agentes de IA especializados e entrega código commitado, PRs abertos e cards atualizados — de forma autônoma, rastreável e configurável.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![MySQL 8](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Docker](https://img.shields.io/badge/Docker-sandbox-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## Índice

1. [O que é o AURA](#1-o-que-é-o-aura)
2. [Como funciona — visão geral](#2-como-funciona--visão-geral)
3. [Arquitetura do sistema](#3-arquitetura-do-sistema)
4. [Pipeline Engine — o coração do AURA](#4-pipeline-engine--o-coração-do-aura)
5. [Agentes e Skills](#5-agentes-e-skills)
6. [Integrações externas](#6-integrações-externas)
7. [Funcionalidades avançadas](#7-funcionalidades-avançadas)
8. [Segurança](#8-segurança)
9. [Instalação e configuração](#9-instalação-e-configuração)
10. [Variáveis de ambiente](#10-variáveis-de-ambiente)
11. [Deploy em produção](#11-deploy-em-produção)
12. [API Reference](#12-api-reference)
13. [Estrutura de arquivos](#13-estrutura-de-arquivos)
14. [Guia para desenvolvedores](#14-guia-para-desenvolvedores)

---

## 📊 Diagramas

| Diagrama | Formato | Descrição |
|---|---|---|
| [Jornada da Demanda](docs/diagrams/jornada.md) | PlantUML | Perspectiva do negócio — 12 fases, 13 agentes de IA, cenários alternativos |
| [Técnico de Sequência](docs/diagrams/tecnico.md) | PlantUML | Perspectiva do código — funções reais, APIs, banco, SSE, Docker sandbox |

> **Para visualizar:** abra o arquivo `.md` correspondente para instruções. Os fontes `.puml` estão em `docs/diagrams/`. Cole em [plantuml.com/plantuml/uml](https://www.plantuml.com/plantuml/uml/) ou use a extensão PlantUML no VS Code (`Alt+D`).

---

Imagine que o seu squad tem um time de especialistas de IA disponíveis 24 horas: um Analista de Negócios que refina requisitos, um Arquiteto que toma decisões técnicas, um Developer que escreve e commita código, um QA que valida contra critérios de aceite, um Security Auditor que revisa vulnerabilidades e um DevOps que prepara o deploy. O AURA é o sistema que orquestra esse time.

**O AURA não é um chatbot.** Você não conversa com ele. Ele monitora seu board do Jira ou Azure DevOps, e quando um card entra numa coluna configurada como gatilho, o AURA assume: analisa o card, chama cada agente na sequência correta, commita o código gerado no repositório do projeto, abre o PR e avança o card — tudo de forma autônoma.

### O que o AURA faz

| Ação | Como |
|---|---|
| Detecta novos cards | Monitora colunas do Jira/Azure a cada 10 segundos |
| Lê o código do projeto | Acessa o repositório Git via API antes de cada agente |
| Executa os agentes | Chama o LLM configurado com contexto real do card + repositório |
| Valida o output | Harness verifica qualidade antes de qualquer ação |
| Commita código | Abre branch, commita arquivos, cria PR/MR automaticamente |
| Roda testes | Executa suite de testes em container Docker isolado antes do PR |
| Atualiza o card | Move o card de coluna e posta comentários no Jira/Azure |
| Aprende | Acumula decisões passadas no Second Brain para cards futuros |

### O que o AURA NÃO faz

- Não modifica seu próprio código em tempo de execução
- Não tem acesso a produção por padrão
- Não toma decisões de negócio — bloqueia e pergunta ao humano quando falta informação
- Não bypassa aprovações configuradas

---

## 2. Como funciona — visão geral

### Exemplo de fluxo completo

Um desenvolvedor cria o card **"AURA-42: Implementar endpoint de contestação de fatura"** no Jira e move para a coluna **"Em análise"**.

O que acontece a seguir, sem nenhuma intervenção humana:

```
1. AURA detecta o card na coluna "Em análise" (trigger configurado)

2. Agente BA (Business Analyst) entra em ação:
   - Lê o card, a descrição e os critérios de aceite
   - Consulta o Second Brain: já existe regra de contestação mapeada?
   - Se sim → usa o contexto. Se não → faz perguntas no comentário do Jira
   - Produz: regras de negócio, fluxo, exceções e critérios verificáveis
   - Posta tudo no comentário do card
   - Emite: ANALYSIS: READY

3. Agente Arquiteto entra em ação:
   - Lê a análise do BA
   - Baixa o código real do repositório "api-financeira" via GitLab API
   - Entende a estrutura atual: endpoints, serviços, banco de dados
   - Decide: novo endpoint REST, consumer Kafka, estratégia de rollout
   - Documenta a decisão técnica no card
   - Emite estimativa de story points: 5 pontos, confiança média
   - Emite: ARCHITECTURE: APPROVED

4. Agente Developer entra em ação:
   - Lê análise + decisão arquitetural + código do repositório
   - Se o card tem wireframe anexado → o sistema descreve a tela por visão
   - Se o repositório tem design-system.md → o agente lê antes de gerar UI
   - Gera os arquivos: ContestacaoService.java, ContestacaoController.java, etc.
   - O AURA faz git clone, cria branch "feature/AURA-42", commita os arquivos
   - O AURA roda "mvn test" no container Docker — se falhar, Developer corrige
   - Se passar → AURA abre Merge Request no GitLab
   - Emite: IMPLEMENTATION: READY_FOR_REVIEW

5. Agente QA entra em ação:
   - Lê os critérios de aceite + código commitado
   - Valida se cada critério foi atendido com evidência
   - Se reprovar → card volta para o Developer com o feedback
   - Se aprovar → emite: VERDICT: APPROVED

6. Agente Security Auditor entra em ação:
   - Revisa autenticação, autorização, dados sensíveis
   - Emite: SECURITY: APPROVED (ou NOT_APPLICABLE se não há impacto)

7. AURA move o card para "Pronto para deploy"
   - Grava o aprendizado no Second Brain
   - Posta resumo final no card
   - Monitora o CI do PR → se falhar, Developer corrige automaticamente
```

### Diagrama de sequência

```
Dev/PO         Jira/Azure       AURA Engine        Agentes LLM        Repositório Git
   │                │                │                  │                    │
   │─── cria card ─►│                │                  │                    │
   │                │◄── polling ───►│                  │                    │
   │                │                │──── detecta ─────►                   │
   │                │                │                  │                    │
   │                │                │──────────────────► BA analisa         │
   │                │◄── comentário ─│◄── ANALYSIS:READY                    │
   │                │                │                  │                    │
   │                │                │──── lê repositório ───────────────────►
   │                │                │◄── código atual ──────────────────────│
   │                │                │──────────────────► Arquiteto decide   │
   │                │◄── decisão ────│◄── ARCHITECTURE:APPROVED             │
   │                │                │                  │                    │
   │                │                │──────────────────► Developer gera     │
   │                │                │──── push código ──────────────────────►
   │                │                │──── docker test ──────────────────────►
   │                │                │──── abre PR ──────────────────────────►
   │                │◄── comentário ─│◄── READY_FOR_REVIEW                  │
   │                │                │                  │                    │
   │                │                │──────────────────► QA valida          │
   │                │◄── comentário ─│◄── VERDICT:APPROVED                  │
   │                │                │                  │                    │
   │                │◄── move card ──│                  │                    │
   │                │                │                  │                    │
```

---

## 3. Arquitetura do sistema

O AURA é uma aplicação **Next.js 16** com App Router, rodando num único processo Node.js. Não há microsserviços separados — tudo roda junto.

### Diagrama de arquitetura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AURA (processo Node.js)                     │
│                                                                           │
│  ┌──────────────────┐     ┌──────────────────────────────────────────┐   │
│  │  Interface Web   │     │            API Routes (~150)              │   │
│  │  (React 19)      │◄────│  Autenticação JWT + RBAC (3 níveis)      │   │
│  │  Tailwind CSS    │ SSE │  Rate limiting por endpoint               │   │
│  │  Zustand (state) │────►│  Validação de entrada com Zod             │   │
│  └──────────────────┘     └──────────────────┬───────────────────────┘   │
│                                               │                           │
│                            ┌──────────────────▼──────────────────────┐   │
│                            │         Event Bus (SSE)                  │   │
│                            │  Eventos em tempo real sem WebSocket     │   │
│                            │  pipeline.* · task.* · agent.*           │   │
│                            └──────────────────┬──────────────────────┘   │
│                                               │                           │
│                            ┌──────────────────▼──────────────────────┐   │
│                            │              MySQL 8                     │   │
│                            │  72 migrações automáticas no startup     │   │
│                            │  pool de conexões via mysql2             │   │
│                            └──────────────────┬──────────────────────┘   │
│                                               │                           │
│                            ┌──────────────────▼──────────────────────┐   │
│                            │          Pipeline Engine                 │   │
│                            │  Scheduler tick a cada 10 segundos      │   │
│                            │  Processa cards, chama LLMs, commita    │   │
│                            └──────────────────┬──────────────────────┘   │
└───────────────────────────────────────────────┼─────────────────────────┘
                                                 │
                    ┌────────────────────────────▼──────────────────────┐
                    │              Serviços Externos                      │
                    ├─────────────────┬───────────────┬─────────────────┤
                    │ Jira / Azure    │  GitLab /     │  LLMs           │
                    │ DevOps          │  GitHub /     │  Anthropic      │
                    │ (backlog)       │  Bitbucket    │  OpenAI         │
                    │                 │  (código)     │  Gemini         │
                    │                 │               │  Groq / Ollama  │
                    ├─────────────────┴───────────────┴─────────────────┤
                    │ Docker (sandbox de testes) · Second Brain (EC2)    │
                    └─────────────────────────────────────────────────────┘
```

### Tecnologias usadas

| Camada | Tecnologia | Por que foi escolhida |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server components + route handlers no mesmo processo |
| UI | React 19 + Tailwind CSS 3 | Performance + utilidade sem CSS custom |
| Linguagem | TypeScript 5 strict | Segurança de tipos em toda a codebase |
| Banco | MySQL 8 via `mysql2` | Pool de conexões, suporte amplo em ambientes corporativos |
| Estado client | Zustand | Simples, sem boilerplate do Redux |
| Tempo real | Server-Sent Events (SSE) | Sem infra extra (Redis, WebSocket) — funciona dentro do Next.js |
| Auth | JWT + RBAC | Stateless, sem sessão em memória |
| Pacotes | pnpm 11 | Instalações rápidas, `--frozen-lockfile` no CI |
| LLMs | Multi-provider | Nenhum provider hardcoded — tudo configurável na UI |
| Git | Multi-provider | GitLab, GitHub e Bitbucket com a mesma interface |
| Sandbox | Docker (via socket) | Isolamento real de containers efêmeros para testes |
| i18n | next-intl | Textos de UI em `messages/pt.json` |

---

## 4. Pipeline Engine — o coração do AURA

O Pipeline Engine é o arquivo `src/lib/pipeline-engine.ts` — um único arquivo de ~4.500 linhas que contém toda a lógica de orquestração. Ele roda como uma tarefa de background via `src/lib/scheduler.ts`.

### Como o scheduler funciona

```
Servidor inicia
    │
    └── scheduler.ts inicia o loop
            │
            ├── a cada 10s: tickPipelineEngine()
            │       │
            │       ├── Limpa runs travados em 'running' há mais de 2h → 'failed'
            │       ├── Limpa runs travados em 'waiting_input' com PR pendente há 7d → 'failed'
            │       ├── discoverNewCards() — verifica novos cards no Jira/Azure
            │       └── checkRunningRuns() — processa runs ativos
```

### O ciclo de vida de um card (run)

Cada card que entra no pipeline cria um registro em `pipeline_card_runs`. Esse registro tem um `status` que evolui assim:

```
running ──► waiting_input ──► running ──► done
   │                                       │
   └──► failed (erro não recuperável)      └──► Second Brain grava o aprendizado
   └──► cancelled (usuário pediu)
```

### Como startColumn funciona (passo a passo)

Essa é a função central. Ela é chamada quando um card entra numa etapa (coluna do pipeline):

```
startColumn(run, column)
│
├── 1. Salva snapshot do estado atual (para rollback futuro)
│
├── 2. Para cada agente configurado nesta coluna:
│   │
│   ├── a. Busca o contexto do repositório Git (fetchRepoContext)
│   │      └── Lê árvore de arquivos + código-fonte via API Git
│   │      └── Inclui design-system.md, AGENTS.md, tailwind.config se existirem
│   │      └── Timeout global de 5 minutos via Promise.race
│   │
│   ├── b. Consulta o Second Brain (só para BA e PM)
│   │      └── Busca conhecimento de cards anteriores do mesmo domínio
│   │
│   ├── c. Descreve imagens do card (se houver anexos)
│   │      └── Baixa imagens do Jira/Azure como base64
│   │      └── Chama o LLM de visão configurado para descrever layouts
│   │
│   ├── d. Monta o prompt completo:
│   │      └── Histórico de decisões deste run (context_summary)
│   │      └── Contexto do Second Brain
│   │      └── Descrição visual das imagens
│   │      └── Contexto do repositório
│   │      └── Instruções da coluna + skills do agente
│   │
│   ├── e. Chama o LLM (callAgentLLM)
│   │      └── Usa o provider/modelo configurado no dropdown da coluna
│   │      └── Se falhar → tenta fallback configurado (fixed ou cascade)
│   │
│   ├── f. Valida o output (harness)
│   │      └── Verifica: resposta vazia, secrets no código, gate obrigatório
│   │      └── Se inválido → posta motivo no card, waiting_input
│   │
│   ├── g. Detecta loop semântico
│   │      └── Se mesma etapa com output similar ≥ 3 vezes → waiting_input
│   │
│   ├── h. Acumula decisão no context_summary do run
│   │
│   ├── i. Transmite evento SSE em tempo real para o dashboard
│   │
│   ├── j. Roda testes no Docker (se agente incluiu TEST_CMD no output)
│   │      └── Clona repositório em /tmp
│   │      └── docker run --rm --network none --read-only --pids-limit 256
│   │      └── Se testes falham → não abre PR, waiting_input
│   │
│   ├── k. Commita código (se output tem blocos ### FILE:)
│   │      └── Cria branch feature/CARD-KEY
│   │      └── Push dos arquivos via API Git
│   │
│   └── l. Abre PR/MR (se output tem OPEN_PR: true)
│          └── GitLab: Merge Request via API v4
│          └── GitHub: Pull Request via Contents API
│          └── Armazena pr_check_json para polling do CI
│
└── 3. advanceToNextColumn()
       └── Move o card para a próxima coluna no Jira/Azure
       └── Inicia startColumn() na próxima etapa
       └── Ou pausa se a coluna tem requires_human_approval = true
```

### Como o contexto do repositório é construído

Antes de chamar qualquer LLM, o AURA lê o repositório real do projeto via API Git:

```
fetchRepoContext(repoId)
│
├── Detecta o provider pela URL (github.com, bitbucket.org, ou GitLab)
│
├── Baixa a árvore completa de arquivos (git tree recursiva)
│
├── Filtra diretórios desnecessários:
│   └── node_modules, .git, dist, build, .next, coverage, etc.
│
├── Lê arquivos de arquitetura primeiro (sempre):
│   └── README.md, ARCHITECTURE.md, AGENTS.md
│   └── design-system.md, design-tokens.json, tailwind.config.*
│   └── package.json, tsconfig.json, pom.xml, go.mod, Cargo.toml
│   └── docker-compose.yml, Dockerfile, .env.example
│
├── Detecta a linguagem pelos manifestos (package.json → TypeScript/JS)
│
├── Lê arquivos de código-fonte priorizando:
│   └── src/ > lib/ > app/ > main/ > outros > testes
│
└── Respeita limite de 160.000 chars (~40K tokens)
    └── Arquivos grandes são truncados com aviso
    └── Arquivos menos prioritários são omitidos se limite atingido
```

### Memória de contexto por run (context_summary)

Cada vez que um agente finaliza, o AURA extrai a decisão principal e o gate emitido e acumula num JSON no banco:

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
    "decision": "Solução via evento assíncrono Kafka — consumer no serviço de contestação.",
    "gate": "ARCHITECTURE: APPROVED",
    "timestamp": 1726400120
  }
]
```

Esse histórico é injetado no início de cada prompt como `## Histórico de decisões deste card`. O Developer que entra na etapa 4 já sabe o que o BA e o Arquiteto decidiram nas etapas anteriores — sem precisar reler todos os comentários do card.

---

## 5. Agentes e Skills

### O que é um agente

Um agente no AURA tem:
- **Nome e papel** (ex: "Ana", business analyst)
- **Soul content** — a "personalidade" e instruções base do agente
- **Modelo LLM** — pode ser diferente por agente (ex: Claude para arquiteto, Gemini para QA)
- **Skills** — arquivos SKILL.md que definem o comportamento esperado

### O que é uma skill

Skills são arquivos Markdown em `skills/*/SKILL.md`. Cada arquivo define:
- **Missão** do papel
- **Processo** passo a passo
- **Gates de saída** — o que o agente deve emitir para avançar o card
- **Antipadrões** — o que nunca fazer
- **Rastreabilidade** — o que registrar no Jira

As skills são lidas do disco, sincronizadas para o banco (tabela `skills`) e injetadas no **system prompt** do LLM via `agentSystemPrompt()`. O LLM recebe as instruções como parte do contexto de sistema, não como mensagem do usuário.

### Skills disponíveis

| Arquivo | Papel | Quando é ativada |
|---|---|---|
| `swe-orchestration-coordination` | Coordinator/Aegis | Coordena o card do início ao fim, age como LLM-as-judge |
| `swe-business-analysis` | Business Analyst | Refina requisitos, mapeia regras e exceções |
| `swe-software-architecture` | Arquiteto | Decide a solução técnica, faz code review arquitetural |
| `swe-implementation-practices` | Developer | Implementa código, commita, abre PRs |
| `swe-quality-gates` | QA Engineer | Valida contra critérios, roda testes automatizados |
| `swe-security-review` | Security Auditor | Revisa auth, autorização, dados sensíveis |
| `swe-release-operations` | DevOps | Executa deploys seguindo estratégia do arquiteto |
| `swe-data-engineering` | Data Engineer | Schemas, migrations, backfill |
| `swe-software-architecture` | Arquiteto/Data | Mudanças estruturais de dados |
| `swe-product-management` | PM/PO | Outcomes, métricas, priorização |
| `swe-ux-research` | UX Designer | Jornadas, estados, acessibilidade |
| `swe-flow-management` | Scrum Master | WIP, aging, bloqueios |
| `swe-backlog-prioritization` | Product Owner | Priorização por valor e risco |
| `swe-discovery-practices` | Discovery | Hipóteses, experimentos |

### Gates — como o pipeline avança

Cada agente deve emitir um gate no final do output para que o Coordinator saiba se pode avançar:

| Agente | Gates possíveis |
|---|---|
| Business Analyst | `ANALYSIS: READY` · `ANALYSIS: BLOCKED` · `ANALYSIS: NOT_APPLICABLE` |
| Arquiteto | `ARCHITECTURE: APPROVED` · `ARCHITECTURE: BLOCKED` · `ARCHITECTURE: APPROVED_WITH_CONDITIONS` |
| Arquiteto (code review) | `ARCHITECTURE_REVIEW: APPROVED` · `ARCHITECTURE_REVIEW: CHANGES_REQUESTED` |
| Developer | `IMPLEMENTATION: READY_FOR_REVIEW` · `IMPLEMENTATION: BLOCKED` |
| QA | `VERDICT: APPROVED` · `VERDICT: CHANGES_REQUESTED` · `QA: BLOCKED` |
| Security | `SECURITY: APPROVED` · `SECURITY: BLOCKED` · `SECURITY: NOT_APPLICABLE` |
| DevOps | `RELEASE: SUCCESS` · `RELEASE: ROLLED_BACK` · `RELEASE: BLOCKED` |

### Formato de entrega de código

Quando o Developer gera código, ele usa um formato especial que o AURA detecta e commita automaticamente:

```
### FILE: src/services/ContestacaoService.ts
```typescript
export class ContestacaoService {
  async processar(contestacao: ContestacaoInput): Promise<void> {
    // implementação
  }
}
```
COMMIT: feat(contestacao): implementa processamento de contestação de fatura
```

Para múltiplos repositórios:
```
### FILE: [api-cartoes]: src/services/ContestacaoService.ts
### FILE: [frontend-cartoes]: src/components/ContestacaoForm.tsx
```

Para rodar testes antes do PR:
```
TEST_CMD: pnpm test --run
```

Para abrir PR automaticamente:
```
OPEN_PR: true
```

### LLM-as-judge — o Coordinator avalia antes de avançar

O agente Coordinator não executa tarefas técnicas — ele avalia o output de cada agente antes de qualquer ação irreversível (commit, PR, avanço de card). Os critérios:

1. **Completude** — Atende todos os critérios de aceite?
2. **Ausência de invenção** — Criou arquivos/endpoints que não existem?
3. **Ausência de alucinação** — Declarou ter executado algo sem evidência?
4. **Segurança** — Contém secrets ou operações destrutivas?
5. **Escopo** — Mudanças fora do escopo do card?
6. **Rastreabilidade** — Registrou o que foi feito e por quê?

Se qualquer critério falhar → bloqueia, comenta no card, solicita reexecução.

---

## 6. Integrações externas

### Backlog — Jira e Azure DevOps

O AURA se conecta ao Jira Cloud/Server ou Azure DevOps para:
- **Buscar cards** por coluna (polling a cada 10s)
- **Postar comentários** com o resultado de cada agente
- **Mover cards** entre colunas conforme o pipeline avança
- **Ler anexos** (imagens, wireframes) para o agente descrever via visão

Todos os endpoints têm `AbortSignal.timeout(15_000)` — se o Jira ou Azure demorar mais de 15 segundos, a chamada é abortada e o pipeline continua no próximo tick.

### Repositórios Git

O AURA suporta GitLab, GitHub e Bitbucket:

| Operação | GitLab | GitHub | Bitbucket |
|---|---|---|---|
| Leitura de contexto (fetchRepoContext) | ✅ | ✅ | ✅ |
| Commit de arquivos | ✅ | ✅ | ✅ |
| Abertura de MR/PR | ✅ MR | ✅ PR | ❌ |
| Polling de CI | ✅ (próxima versão) | ✅ | ❌ |

**Como funciona o commit:**

O AURA não clona o repositório localmente para commits normais — usa a API diretamente:
- GitLab: `POST /repository/commits` (API v4)
- GitHub: `PUT /contents/:path` (Contents API)
- Bitbucket: `POST /src` (multipart)

Apenas para rodar testes no sandbox é que o repositório é clonado com `git clone --depth 1`.

### LLM Providers

Nenhum provider está hardcoded. Tudo é configurado na tela de Integrações ou via variáveis de ambiente:

| Provider | Variável de ambiente | Observações |
|---|---|---|
| Anthropic (Claude) | `ANTHROPIC_API_KEY` | Suporta visão (imagens do card) |
| OpenAI (GPT-4o, o3) | `OPENAI_API_KEY` | Suporta visão |
| Google Gemini | `GEMINI_API_KEY` | Suporta visão |
| Groq | `GROQ_API_KEY` | Rápido para modelos menores |
| OpenRouter | `OPENROUTER_API_KEY` | Acesso a múltiplos modelos |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| Ollama (local) | Configurado na UI | Sem chave, roda localmente |

**Como o AURA seleciona o modelo:**

Cada coluna do pipeline tem um dropdown onde você escolhe o provider e modelo por agente. O sistema suporta 3 tiers por pipeline:
- `llm_simple` — para tasks simples (bug fix, typo)
- `llm_medium` — para tasks padrão
- `llm_complex` — para tasks complexas (arquitetura, migração)

O AURA classifica automaticamente a complexidade pelo título e descrição do card e usa o tier adequado. O agente pode sobrescrever com o dropdown da coluna.

---

## 7. Funcionalidades avançadas

### Sandbox Docker — testes antes do PR

Quando o Developer inclui `TEST_CMD: pnpm test --run` no output, o AURA:

1. Clona o repositório em `/tmp/aura-sandbox-XXXXXX` com `git clone --depth 1`
2. Lança um container Docker efêmero:
```bash
docker run \
  --rm \                      # remove após execução
  --network none \             # sem acesso à internet
  --memory 512m \              # limite de memória
  --cpus 1 \                   # limite de CPU
  --pids-limit 256 \           # evita fork bomb
  --read-only \                # filesystem read-only
  --tmpfs /tmp:rw,size=256m \  # /tmp gravável
  --volume "/tmp/sandbox:/workspace:ro" \
  node:22-alpine \
  sh -c "pnpm test --run"
```
3. Captura stdout/stderr e exit code
4. Limpa o diretório temporário
5. Posta resultado no card: ✅ Testes passaram (12.3s) ou ❌ com o log
6. Se falharam → não abre PR, run fica em `waiting_input`

**Requer:** o container do AURA precisa ter acesso ao Docker socket:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

### Screenshot-to-Code — imagens do card

Se um card do Jira/Azure tem wireframes ou screenshots anexados, o AURA:

1. Baixa as imagens como base64 (até 3 imagens por execução, até 10 MB cada)
2. Chama o LLM configurado com a imagem:
   - **Anthropic:** formato `{ type: "image", source: { type: "base64", ... } }`
   - **OpenAI/OpenRouter:** formato `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`
   - **Gemini:** formato `{ inline_data: { mime_type: "...", data: "..." } }`
   - **Outros providers:** envia texto informando o arquivo para análise manual
3. Recebe descrição estruturada: layout, componentes, hierarquia, textos visíveis
4. Injeta no prompt do Developer e do BA como `## 🖼️ Contexto visual`

O LLM usado para descrever as imagens é o **mesmo configurado na coluna** — não há provider hardcoded.

### Design System por repositório

O AURA lê automaticamente arquivos de design system do repositório do **projeto cliente** (não do próprio AURA):

```
design-system.md      DESIGN-SYSTEM.md      docs/design-system.md
design-tokens.json    design-tokens.ts      src/styles/tokens.css
tailwind.config.ts    tailwind.config.js    src/app/globals.css
AGENTS.md             docs/AGENTS.md
```

Se esses arquivos existirem no repositório, o Developer os vê antes de gerar qualquer código de UI — sem adivinhar quais componentes usar.

### Feedback loop de CI

Quando o AURA abre um PR no GitHub e o CI falha:

```
CI falha
    │
    ├── Tentativa 1: Developer lê o log de erro + log real dos jobs (Actions API)
    │                gera correção, faz push na mesma branch
    │
    ├── Tentativa 2: mesmo fluxo
    │
    ├── Tentativa 3: mesmo fluxo
    │
    └── Tentativa 4: dá up, posta no card, waiting_input
                     "CI falhou após 3 tentativas — intervenção humana necessária"
```

O agente que corrige o CI recebe:
- O resumo das annotations do check (mensagens de erro estruturadas)
- Os **logs reais dos jobs** da GitHub Actions API (últimos 2KB de stdout/stderr)

### Aprovação humana por etapa

Qualquer coluna do pipeline pode ter `requires_human_approval = true`. Quando ativado:

1. O AURA executa os agentes normalmente
2. Antes de avançar para a próxima coluna → para
3. Posta no card: `⏸️ Aprovação necessária — [nome da etapa]`
4. Status: `waiting_input`
5. Humano comenta `avançar` no card → AURA continua

Configurado na UI de pipeline, em cada coluna.

### Agent Communication — @mention no Jira

O usuário pode interagir diretamente com agentes específicos comentando no card do Jira:

```
@pedro qual foi a decisão arquitetural anterior?
@qa execute somente os testes de integração
@aura reprocessar com foco em segurança
```

O AURA detecta o nome do agente (busca em todas as colunas do pipeline), executa o agente com o contexto completo do card e posta a resposta como comentário.

Comandos gerais (sem @mention específico):

| Comando | Ação |
|---|---|
| `avançar` | Avança para a próxima etapa |
| `cancelar` | Cancela o run |
| `reprocessar` | Reexecuta a etapa atual |
| `reprocessar tudo` | Reinicia do início |

### Detecção de loop semântico

Se o AURA detectar que a mesma etapa foi executada 3+ vezes com outputs similares:

1. Para o pipeline
2. Posta aviso no card
3. Status: `waiting_input`
4. Humano decide: `reprocessar` (com nova instrução) ou `cancelar`

Evita ciclos infinitos de QA reprovando → Developer corrigindo → QA reprovando.

### Replay e rollback

Antes de iniciar cada etapa, o AURA salva um snapshot do estado atual. Para voltar a uma etapa anterior:

```bash
# Via API
POST /api/pipeline/engine/runs
{
  "action": "rollback",
  "run_id": 123,
  "stage_id": "42"
}
```

O rollback:
1. Limpa as mensagens das etapas posteriores
2. Remove as entradas correspondentes do histórico de decisões
3. Reinicia a partir do ponto escolhido

### Estimativa automática de story points

Após o Arquiteto concluir, o AURA gera automaticamente uma estimativa de story points em background (sem bloquear o pipeline):

```
📊 Estimativa automática — AURA-42

| Story Points | Confiança |
|---|---|
| 5 | Média |

JUSTIFICATIVA:
- Complexidade técnica: Novo consumer Kafka + migration de schema
- Repositórios afetados: 2 (api-contestacao, core-banking-adapter)
- Riscos: Timeout no consumer deve seguir regra da processadora (30s)
```

### Métricas de qualidade

O AURA captura métricas automaticamente em `pipeline_quality_metrics`:

| Métrica | O que mede |
|---|---|
| `gate_passed` / `gate_rejected` | Taxa de aprovação do harness por agente |
| `stage_duration_sec` | Tempo médio por etapa |
| `qa_rejected` / `rework_triggered` | Frequência de retrabalho |
| `pr_approved` / `pr_rejected` | Taxa de aprovação de PRs |
| `story_points_estimate` | Estimativas geradas por card |

Consultada via:
```
GET /api/pipeline/quality-metrics?days=30
```

### Second Brain

O Second Brain é um serviço externo opcional (FastAPI + ChromaDB/pgvector em EC2 separado) que acumula conhecimento de cards anteriores.

**Quando é consultado:**
- Antes de agentes BA, PM e PO executarem: busca regras e decisões de cards anteriores do mesmo domínio de negócio

**Quando é alimentado:**
- Ao concluir cada card com sucesso: grava título, descrição e domínio

**Domínios detectados automaticamente:**

| Domínio | Palavras-chave detectadas |
|---|---|
| `cartoes` | cartão, fatura, limite, parcelamento, bandeira |
| `pix` | pix, chave pix, qr code, transferência |
| `cobranca` | boleto, cobrança, vencimento |
| `conta` | conta corrente, saldo, extrato, ted |
| `emprestimo` | empréstimo, crédito pessoal |
| `geral` | fallback |

---

## 8. Segurança

### Controles implementados

| Controle | Como funciona |
|---|---|
| **SSRF** | `isBlockedUrl()` bloqueia IPs de cloud-metadata (169.254.169.254), RFC 1918 (redes privadas) e loopback antes de qualquer request externo |
| **Rate limiting** | Login: 5/min · Mutações: 60/min · Leituras: 120/min — por IP |
| **IP real** | Extraído via `MC_TRUSTED_PROXIES` — protege contra headers forjados (X-Forwarded-For) |
| **CSP** | `script-src` com nonce por request + `'strict-dynamic'` — sem `unsafe-inline` |
| **HSTS** | max-age 2 anos + `includeSubDomains; preload` quando HTTPS detectado |
| **Workspace isolation** | Toda query ao banco filtra por `workspace_id` — dados nunca vazam entre squads |
| **RBAC** | 3 níveis: `viewer` (só leitura) · `operator` (criar/editar) · `admin` (tudo) |
| **Token masking** | `access_token` de repositórios retornado apenas para `operator`/`admin` |
| **Audit log** | Toda mutação registrada com ator, IP, timestamp e target |
| **Secret detection** | Harness detecta credenciais no output dos agentes antes de qualquer commit |
| **Sandbox isolamento** | Containers Docker sem rede, read-only, limite de memória/CPU/processos |
| **Logs sanitizados** | Erros de API de LLMs truncados a 120 chars — sem response body completo |

### Permissões necessárias por integração

**Jira (API token):**
- Leitura de issues e comentários
- Escrita de comentários
- Transição de issues entre status

**GitLab (Personal Access Token com scope `api`):**
- Leitura de repositório e árvore de arquivos
- Criação de commits e branches
- Criação de Merge Requests

**GitHub (Personal Access Token com scope `repo`):**
- Leitura de repositório
- Escrita de arquivos
- Criação de Pull Requests
- Leitura de checks (CI status)

### Considerações importantes

- **Tokens Git são armazenados em plaintext no MySQL.** Em produção, use criptografia em repouso (MySQL TDE ou RDS encryption) e tokens com escopo mínimo.
- **O Docker socket (`/var/run/docker.sock`) dá ao AURA controle total sobre containers no host.** Aceitável em ambiente corporativo interno. Em SaaS, use Docker-in-Docker.
- **O Second Brain recebe títulos e descrições de cards** que podem conter dados de negócio sensíveis. Use HTTPS e restrinja o acesso à VPC interna.

---

## 9. Instalação e configuração

### Pré-requisitos

- Node.js ≥ 22 (`node --version`)
- pnpm 11 (`corepack enable && corepack prepare pnpm@11.15.1 --activate`)
- MySQL 8+ rodando e acessível
- Docker (opcional, para o sandbox de testes)

### Passo a passo

**1. Clone o repositório**
```bash
git clone https://github.com/kamilaalves1/auraefi.git
cd auraefi
```

**2. Instale as dependências**
```bash
pnpm install
```

**3. Configure o ambiente**
```bash
cp .env.example .env
# Edite o .env com suas configurações
```

No mínimo, configure:
```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=sua_senha
MYSQL_DATABASE=aura

# Altere estas credenciais antes de qualquer uso!
AUTH_USER=admin
AUTH_PASS=senha_forte_aqui
```

**4. Crie o banco de dados**
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS aura CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

**5. Inicie o servidor**
```bash
pnpm dev
```

As **72 migrações do banco** rodam automaticamente no startup. Não é necessário nenhum comando de migration manual.

**6. Acesse o AURA**

Abra [http://localhost:3000](http://localhost:3000)

Login padrão: `admin` / `admin` (altere imediatamente em **Configurações → Usuários**)

### Configuração do pipeline (passo a passo na UI)

**Passo 1 — Configure um repositório Git**
1. Vá em **Repositórios Git** no menu lateral
2. Clique em **Adicionar repositório**
3. Preencha: URL do repositório, branch padrão e token de acesso
4. Clique em **Testar conexão** para validar

**Passo 2 — Configure as integrações de LLM**
1. Vá em **Integrações**
2. Adicione sua chave de API (Anthropic, OpenAI, Gemini, etc.)

**Passo 3 — Configure o backlog**
1. Vá em **Fluxos** no menu lateral
2. Crie um novo pipeline
3. Configure o provider: Jira ou Azure DevOps
4. Preencha as credenciais (host, email, token API)
5. Defina os modelos LLM por complexidade (simples, médio, complexo)

**Passo 4 — Configure as colunas e agentes**
1. No pipeline criado, vá em **Colunas**
2. Para cada coluna do seu board (ex: "Em análise", "Em desenvolvimento", "QA"):
   - Escolha qual agente trabalha nessa coluna
   - Escolha o modelo LLM para esse agente
   - Marque "Coluna gatilho" na coluna que deve disparar o pipeline
   - Opcionalmente marque "Requer aprovação humana" para pausar antes desta etapa

**Passo 5 — Vincule o repositório ao pipeline**
1. Nas configurações do pipeline, adicione o repositório em **Repositórios do sistema**

**Passo 6 — Teste**
1. Mova um card do Jira para a coluna configurada como gatilho
2. Acompanhe em **Visão Geral** → o card deve aparecer nos runs ativos

---

## 10. Variáveis de ambiente

Copie `.env.example` para `.env` e configure:

### Banco de dados (obrigatório)

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=aura
MYSQL_SSL=false          # true para conexões com TLS
```

### Autenticação (obrigatório)

```env
AUTH_USER=admin          # usuário admin inicial
AUTH_PASS=admin          # ALTERE em produção
AUTH_PASS_B64=           # alternativa: senha em base64 (use quando contém #)
AUTH_SECRET=             # secret JWT — gerado automaticamente se vazio
API_KEY=                 # chave para acesso programático — gerada automaticamente
```

### Segurança de rede

```env
MC_TRUSTED_PROXIES=10.0.0.0/8     # IPs do reverse proxy (nginx, ALB)
MC_ALLOWED_HOSTS=localhost,127.0.0.1  # hosts permitidos no header Host
MC_ALLOW_ANY_HOST=                 # defina 1 para desabilitar validação (dev only)
MC_ENABLE_HSTS=0                   # 1 para forçar HSTS
MC_COOKIE_SECURE=0                 # 1 para cookies Secure (HTTPS)
MC_COOKIE_SAMESITE=lax             # lax ou strict
```

### Azure AD / SSO corporativo

```env
NEXT_PUBLIC_AZURE_CLIENT_ID=       # habilita o botão "Entrar com Microsoft"
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=
```

### LLM Providers (configure via UI ou env)

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
DEEPSEEK_API_KEY=
```

### Second Brain (opcional)

```env
SECOND_BRAIN_URL=http://seu-ec2.interno.com:8080
# Se não configurado, o sistema funciona normalmente sem Second Brain
```

### Sandbox Docker (opcional)

```env
SANDBOX_IMAGE_NODE=node:22-alpine       # imagem para projetos Node/TypeScript
SANDBOX_IMAGE_PYTHON=python:3.12-slim   # imagem para projetos Python
SANDBOX_IMAGE_JAVA=eclipse-temurin:21-jdk-alpine
SANDBOX_IMAGE_GO=golang:1.22-alpine
SANDBOX_IMAGE_RUST=rust:1.78-alpine
SANDBOX_IMAGE_DEFAULT=node:22-alpine    # fallback
SANDBOX_TIMEOUT_MS=120000               # timeout em ms por execução
SANDBOX_MEMORY=512m                     # limite de memória do container
SANDBOX_CPUS=1                          # limite de CPUs
SANDBOX_PIDS_LIMIT=256                  # limite de processos (evita fork bomb)
```

### Retenção de dados

```env
MC_RETAIN_ACTIVITIES_DAYS=90
MC_RETAIN_AUDIT_DAYS=365
MC_RETAIN_LOGS_DAYS=30
MC_RETAIN_PIPELINE_RUNS_DAYS=90
MC_RETAIN_TOKEN_USAGE_DAYS=90
```

---

## 11. Deploy em produção

### Com Docker Compose

```bash
# Produção com filesystem read-only e rede isolada
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

Para habilitar o sandbox Docker, adicione ao `docker-compose.yml`:
```yaml
volumes:
  - vcc-data:/app/.data
  - /var/run/docker.sock:/var/run/docker.sock  # sandbox Docker
```

### Configuração do Nginx

O AURA usa SSE (Server-Sent Events) para tempo real. O Nginx precisa de configuração especial:

```nginx
server {
    listen 443 ssl;
    server_name aura.suaempresa.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Obrigatório para SSE funcionar:
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_cache off;
    }
}
```

Sem `proxy_buffering off`, os eventos SSE ficam em buffer no Nginx e chegam em lote ao browser — o dashboard não atualiza em tempo real.

### Variáveis obrigatórias em produção

```env
AUTH_PASS=senha_forte_com_maiusculas_numeros_simbolos
AUTH_SECRET=string_aleatoria_de_pelo_menos_32_chars
MYSQL_HOST=host_do_banco
MYSQL_PASSWORD=senha_do_banco
MYSQL_SSL=true
MC_TRUSTED_PROXIES=ip_do_nginx
MC_ALLOWED_HOSTS=aura.suaempresa.com
MC_ENABLE_HSTS=1
MC_COOKIE_SECURE=1
```

### CI/CD com GitLab

O `.gitlab-ci.yml` incluído tem 3 stages:

| Stage | Quando roda | O que faz |
|---|---|---|
| `validate` | Em todo push e MR | `pnpm typecheck` + `pnpm build` |
| `release` | Push no master | Build standalone + empacota `.tar.gz` |
| `deploy` | Manual | Deploy via SSM Run Command na EC2 |

O build usa `node:22-bullseye-slim`. O Debian Bullseye está arquivado — o CI usa `archive.debian.org` automaticamente.

---

## 12. API Reference

A especificação OpenAPI completa está em `openapi.json`. Com o servidor rodando, acesse `/docs` para a documentação interativa.

### Autenticação

Todas as rotas exigem autenticação. Duas formas:

**1. Cookie de sessão (browser/UI):**
```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

**2. Bearer token (uso programático/CLI):**
```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer $API_KEY"
```

### Endpoints principais

#### Pipeline

| Método | Rota | Role | Descrição |
|---|---|---|---|
| `GET` | `/api/pipeline/engine/runs` | viewer | Lista runs ativos e recentes |
| `GET` | `/api/pipeline/engine/runs?id=X&messages=1` | viewer | Mensagens de um run |
| `GET` | `/api/pipeline/engine/runs?id=X&snapshots=1` | viewer | Snapshots disponíveis para rollback |
| `POST` | `/api/pipeline/engine/runs` | operator | Ações: `cancel`, `reprocess`, `rollback` |
| `GET` | `/api/pipeline/stream?run_id=X` | viewer | SSE em tempo real de um run |
| `GET` | `/api/pipeline/quality-metrics?days=30` | viewer | Métricas de qualidade |

#### Configuração

| Método | Rota | Role | Descrição |
|---|---|---|---|
| `GET/POST` | `/api/agents` | viewer/operator | Lista e cria agentes |
| `GET/PUT/DELETE` | `/api/agents/:id` | viewer/operator/admin | Detalhe, atualiza, remove agente |
| `GET/PUT` | `/api/workspace/work-pipelines` | viewer/operator | Pipelines configurados |
| `GET/PUT` | `/api/workspace/work-pipelines/:id/columns` | viewer/operator | Colunas do pipeline |
| `GET/PUT` | `/api/workspace/git-repositories` | viewer/operator | Repositórios Git |
| `POST` | `/api/workspace/git-repositories/:id/test` | operator | Testa conexão com o repositório |
| `GET` | `/api/skills` | viewer | Skills sincronizadas do disco |
| `GET` | `/api/tokens/by-agent` | viewer | Custo de tokens por agente |
| `GET` | `/api/tokens/compact-mode` | viewer | Comparativo modo econômico |

#### Sistema

| Método | Rota | Role | Descrição |
|---|---|---|---|
| `GET` | `/api/events` | viewer | SSE de todos os eventos do sistema |
| `GET` | `/api/audit` | admin | Audit log |
| `GET` | `/api/scheduler` | admin | Status do scheduler |
| `GET` | `/api/export` | admin | Exporta dados (CSV/JSON) |
| `POST` | `/api/auth/login` | — | Login |
| `POST` | `/api/auth/logout` | viewer | Logout |

### Consumindo o SSE de pipeline

```javascript
// Assinar eventos em tempo real de um run específico
const es = new EventSource('/api/pipeline/stream?run_id=123', {
  credentials: 'include'
})

es.addEventListener('pipeline.stage_started', (e) => {
  const data = JSON.parse(e.data)
  console.log(`Etapa "${data.stage}" iniciada — agente: ${data.agent}`)
})

es.addEventListener('pipeline.agent_output', (e) => {
  const data = JSON.parse(e.data)
  console.log(`${data.agent}: ${data.output_preview}`)
  console.log(`Tokens: ${data.tokens_in} in / ${data.tokens_out} out`)
})

es.addEventListener('pipeline.run_completed', (e) => {
  console.log('Esteira concluída!')
  es.close()
})
```

**Eventos emitidos:**

| Evento | Quando | Payload principal |
|---|---|---|
| `pipeline.stage_started` | Etapa iniciou | `stage`, `agent`, `run_id` |
| `pipeline.agent_output` | Agente finalizou | `agent`, `role`, `output_preview`, `tokens_in`, `tokens_out`, `model` |
| `pipeline.run_completed` | Esteira concluída | `run_id`, `card_key` |
| `pipeline.awaiting_approval` | Aguardando aprovação humana | `stage`, `run_id` |
| `pipeline.loop_detected` | Loop semântico detectado | `stage`, `agent` |
| `pipeline.sandbox_failed` | Testes Docker falharam | `stage`, `agent` |
| `pipeline.ci_passed` | CI passou | `pr_number` |
| `pipeline.ci_failed` | CI falhou | `pr_number` |

---

## 13. Estrutura de arquivos

```
auraefi/
│
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── api/                    # ~150 route handlers
│   │   │   ├── agents/             # CRUD de agentes
│   │   │   ├── pipeline/
│   │   │   │   ├── engine/runs/    # controle de runs (cancel, reprocess, rollback)
│   │   │   │   ├── quality-metrics/ # métricas de qualidade
│   │   │   │   └── stream/         # SSE em tempo real
│   │   │   ├── tokens/             # custo por agente, modo econômico
│   │   │   ├── workspace/
│   │   │   │   ├── git-repositories/ # CRUD de repositórios Git
│   │   │   │   └── work-pipelines/   # CRUD de pipelines e colunas
│   │   │   ├── auth/               # login, logout, Azure AD
│   │   │   ├── events/             # SSE global
│   │   │   └── admin/              # diagnóstico, repair
│   │   ├── login/
│   │   │   └── page.tsx            # tela de login (Microsoft SSO + local)
│   │   └── [[...panel]]/           # página principal — navegação client-side
│   │
│   ├── components/
│   │   ├── ui/                     # componentes base (Button, Dialog, etc.)
│   │   └── panels/                 # painéis do dashboard
│   │       ├── overview-panel.tsx  # visão geral com métricas
│   │       ├── pipeline-panel.tsx  # configuração de pipelines
│   │       └── ...
│   │
│   └── lib/                        # lógica de negócio
│       ├── pipeline-engine.ts      # ★ núcleo — ~4.500 linhas
│       ├── sandbox-runner.ts       # execução de testes em Docker
│       ├── agent-harness.ts        # validação de output dos agentes
│       ├── second-brain-client.ts  # cliente HTTP para o Second Brain
│       ├── work-pipeline-jira.ts   # integração Jira (buscar, comentar, mover)
│       ├── work-pipeline-azure.ts  # integração Azure DevOps
│       ├── event-bus.ts            # SSE in-process (sem Redis)
│       ├── auth.ts                 # JWT + RBAC
│       ├── db-pool.ts              # pool de conexões MySQL
│       ├── migrations.ts           # 72 migrações automáticas
│       ├── scheduler.ts            # loop de background (tick a cada 10s)
│       ├── skill-sync.ts           # sincroniza SKILL.md → tabela skills
│       ├── token-pricing.ts        # cálculo de custo USD por modelo
│       └── rate-limit.ts           # limitadores por IP
│
├── skills/                         # skills dos agentes (SKILL.md por papel)
│   ├── swe-orchestration-coordination/SKILL.md
│   ├── swe-business-analysis/SKILL.md
│   ├── swe-software-architecture/SKILL.md
│   ├── swe-implementation-practices/SKILL.md
│   ├── swe-quality-gates/SKILL.md
│   ├── swe-security-review/SKILL.md
│   ├── swe-release-operations/SKILL.md
│   └── ...
│
├── messages/
│   └── pt.json                     # textos da interface em português
│
├── .kiro/
│   └── steering/
│       └── product-context.md      # domínios de negócio para agentes BA/PM
│
├── docker-compose.yml              # produção
├── docker-compose.dev.yml          # desenvolvimento com MySQL
├── docker-compose.hardened.yml     # produção hardened (read-only, rede isolada)
├── Dockerfile
├── .env.example                    # template de variáveis de ambiente
├── .gitlab-ci.yml                  # pipeline CI/CD
└── openapi.json                    # especificação OpenAPI completa
```

### Banco de dados — tabelas principais

| Tabela | O que armazena |
|---|---|
| `agents` | Agentes cadastrados com soul_content, role, modelo LLM |
| `pipeline_card_runs` | Uma linha por card ativo — inclui context_summary, snapshots, pr_check_json |
| `pipeline_card_messages` | Histórico completo de mensagens de cada run |
| `pipeline_columns` | Colunas do pipeline com agentes, modelos e configurações |
| `work_pipelines` | Configuração dos pipelines (Jira/Azure + modelos + repositórios) |
| `pipeline_quality_metrics` | Métricas de gates, rework, duração, story points, PR reviews |
| `git_repositories` | Repositórios Git com URL, branch e access_token |
| `token_usage` | Log de tokens consumidos por agente/modelo com custo USD |
| `skills` | Skills sincronizadas do disco (path → conteúdo do SKILL.md) |
| `activities` | Feed de atividades (visível na Visão Geral) |
| `audit_log` | Log imutável de todas as mutações com ator e IP |
| `workspaces` | Multi-workspace (um squad por instância) |

---

## 14. Guia para desenvolvedores

### Rodando em desenvolvimento

```bash
pnpm dev          # servidor com hot reload (localhost:3000)
pnpm typecheck    # verifica tipos TypeScript (tsc --noEmit)
pnpm lint         # ESLint
pnpm test         # testes unitários (Vitest)
pnpm test:e2e     # testes end-to-end (Playwright)
pnpm build        # build de produção
```

### Adicionando um novo provider de LLM

1. Adicione o case em `dispatchLLM()` em `src/lib/pipeline-engine.ts`:
```typescript
case 'seuprovider': return callSeuProviderLLM(agent, prompt, apiKey, model)
```

2. Se for compatível com OpenAI, adicione em `OPENAI_COMPAT_BASES`:
```typescript
const OPENAI_COMPAT_BASES: Record<string, string> = {
  // ...
  seuprovider: 'https://api.seuprovider.com/v1',
}
```

3. Se suportar visão (imagens), adicione o branch em `describeAttachmentImages()`.

4. Adicione a chave em `resolveApiKey()`.

5. Adicione a integração na tela de Integrações (`src/components/panels/integrations-panel.tsx`).

### Adicionando uma nova skill

1. Crie o diretório:
```bash
mkdir skills/swe-minha-skill
```

2. Crie `skills/swe-minha-skill/SKILL.md` com o frontmatter:
```markdown
---
name: swe-minha-skill
description: Descrição curta do papel e quando usar.
---

# Nome do papel

## Missão
...

## Gate
- `MINHA_SKILL: APPROVED`
- `MINHA_SKILL: BLOCKED`
```

3. Crie `skills/swe-minha-skill/skill.json`:
```json
{
  "name": "swe-minha-skill",
  "description": "Descrição curta"
}
```

4. O scheduler sincroniza automaticamente para o banco no próximo tick. Não é necessário restart.

### Adicionando uma nova migration

1. Adicione ao array `migrations` em `src/lib/migrations.ts` com um `id` único:
```typescript
{
  id: '073_minha_migration',
  up(db: Database.Database) {
    // sempre verificar antes de alterar (idempotência):
    const cols = db.prepare('PRAGMA table_info(minha_tabela)').all() as Array<{ name: string }>
    if (!cols.some(c => c.name === 'nova_coluna')) {
      db.exec(`ALTER TABLE minha_tabela ADD COLUMN nova_coluna TEXT`)
    }
  }
}
```

2. As migrações rodam automaticamente no próximo startup. Não existe rollback automático — escreva migrations evolutivas (additive).

### Reset do banco em desenvolvimento

```bash
mysql -u root -p -e "DROP DATABASE IF EXISTS aura; CREATE DATABASE aura CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
pnpm dev  # migrations rodam automaticamente
```

### Configurando o Second Brain

1. Implante o serviço em EC2 separado (repositório próprio — FastAPI + ChromaDB)
2. Configure a variável:
```env
SECOND_BRAIN_URL=http://seu-ec2.interno.com:8080
```
3. Reinicie o AURA. Sem configuração, funciona normalmente sem Second Brain.

### Remotes Git configurados

Este repositório tem dois remotes:
```bash
git push origin master   # GitLab interno (CI/CD)
git push github master   # GitHub (auraefi)
git push all master      # ambos simultaneamente
```

---

<div align="center">

**AURA** — Plataforma de Orquestração de Agentes de IA · Banco Efí · IA Operations

</div>
