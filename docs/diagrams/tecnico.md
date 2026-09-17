# Diagrama Técnico de Sequência — AURA

> Perspectiva do código: quais funções são chamadas, quais APIs são acionadas e como os dados fluem entre os componentes.

## Como visualizar

**Online:** cole o conteúdo de `tecnico.puml` em [https://www.plantuml.com/plantuml/uml/](https://www.plantuml.com/plantuml/uml/)

**VS Code:** instale a extensão [PlantUML](https://marketplace.visualstudio.com/items?itemName=jebbs.plantuml) e pressione `Alt+D` com o `.puml` aberto.

**Docker:**
```bash
docker run --rm -v $(pwd):/data plantuml/plantuml -tsvg /data/docs/diagrams/tecnico.puml
```

---

## O que o diagrama mostra

O arquivo [`tecnico.puml`](tecnico.puml) documenta o fluxo técnico completo de um card passando pelo pipeline, incluindo:

| Seção | O que mostra |
|---|---|
| **Tick do scheduler** | Como `tickPipelineEngine()` descobre novos cards e limpa runs presos |
| **startColumn()** | Como o contexto é preparado (repositório, skills, Second Brain, imagens) antes de cada agente |
| **Harness** | Validação do output: gate ausente, secrets detectados, resposta vazia |
| **Detecção de loop** | Como o sistema detecta ciclos semânticos e escala para humano |
| **Sandbox Docker** | O comando `docker run` exato com todos os flags de segurança |
| **Commit e PR** | Como o AURA commita código e abre PR/MR via API Git |
| **Polling de CI** | Como o AURA monitora o CI do GitHub e busca logs reais dos jobs (não só annotations) |
| **Stale cleanup** | Como runs travados são automaticamente marcados como `failed` |
| **SSE em tempo real** | Quais eventos são transmitidos via `event-bus.ts` para o dashboard |

---

## Diagrama de estados do run

```
                   ┌─────────────────────────────────────────────┐
                   │                                              │
   card detectado  │                                              │
        ▼          │          reprocessar / CI passou / PR aprovado
   ┌─────────┐     │         ┌──────────────────────────────────┐ │
   │ running │─────┼────────►│        waiting_input             │─┘
   └─────────┘     │         └──────────────────────────────────┘
        │          │                        │
        │          │                        │ cancelar
        │ erro LLM │                        ▼
        │ (3x)     │                  ┌──────────────┐
        │          │                  │  cancelled   │
        ▼          │                  └──────────────┘
   ┌─────────┐     │
   │ failed  │─────┘  auto-retry (até 3× por estágio)
   └─────────┘
        │
        │ waiting_input com PR > 7 dias
        ▼
   ┌─────────┐
   │ failed  │  (stale cleanup automático)
   └─────────┘

   running → done (todos os estágios concluídos)
```

---

## Fluxo de montagem do prompt

O que o LLM recebe a cada chamada, em ordem de injeção:

```
┌─────────────────────────────────────────────────────────────────┐
│  SYSTEM PROMPT (não visível ao usuário)                          │
│  soul_content + skills do agente (cache TTL 30s)                 │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│  USER PROMPT (até ~160K chars / ~40K tokens)                     │
│                                                                   │
│  1. context_summary_json                                          │
│     Histórico de decisões de cada agente neste run               │
│     Ex: "BA → ANALYSIS:READY: regra X. Arquiteto → ARCHITECTURE: │
│     APPROVED: solução via Kafka."                                 │
│                                                                   │
│  2. Second Brain (só BA / PM / PO)                               │
│     Conhecimento de cards anteriores do mesmo domínio            │
│                                                                   │
│  3. Contexto visual (só Developer / BA, se há imagens no card)   │
│     Descrição gerada por LLM de visão dos wireframes/screenshots  │
│                                                                   │
│  4. Contexto do repositório (fetchRepoContext)                   │
│     design-system.md, AGENTS.md, código-fonte, estrutura         │
│                                                                   │
│  5. Descrição do card + critérios de aceite                      │
│                                                                   │
│  6. Instruções da coluna (column.instructions)                   │
│     Comportamento específico definido pelo usuário na UI          │
└─────────────────────────────────────────────────────────────────┘
```
