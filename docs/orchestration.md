# Padrões de Orquestração

Este guia cobre os padrões de orquestração disponíveis no Vertex Control Center, desde atribuição manual até workflows totalmente automatizados com múltiplos agentes.

## Ciclo de Vida da Tarefa

Toda tarefa segue este fluxo de status:

```
inbox ──► assigned ──► in_progress ──► review ──► done
  │          │              │              │
  │          │              │              └──► rejected ──► assigned (retry)
  │          │              │
  │          │              └──► failed (limite de tentativas ou timeout)
  │          │
  │          └──► cancelled
  │
  └──► assigned (triagem manual ou pipeline automático)
```

Transições principais:
- **inbox → assigned**: Triagem humana ou pipeline engine detecta o card
- **assigned → in_progress**: Agente reivindica via polling da fila ou auto-dispatch
- **in_progress → review**: Agente conclui o trabalho, aguarda revisão de qualidade
- **review → done**: Aegis aprova o trabalho
- **review → assigned**: Aegis rejeita, tarefa é requeueada com feedback

## Padrão 1: Atribuição Manual

O padrão mais simples. Um humano cria uma tarefa e a atribui a um agente específico.

```bash
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Corrigir CSS da página de login",
    "description": "O botão de login sobrepõe o formulário em viewports mobile.",
    "priority": "high",
    "assigned_to": "scout"
  }'
```

O agente busca a tarefa no próximo polling da fila:

```bash
curl "$MC_URL/api/tasks/queue?agent=scout" \
  -H "Authorization: Bearer $MC_API_KEY"
```

**Quando usar**: Times pequenos, capacidades de agentes bem conhecidas, triagem conduzida por humanos.

## Padrão 2: Dispatch por Fila

Agentes fazem polling da fila e o sistema atribui a tarefa de maior prioridade disponível. Sem triagem manual necessária.

### Configuração

1. Crie tarefas no status `inbox` (sem `assigned_to`):

```bash
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Atualizar documentação da API",
    "priority": "medium"
  }'
```

2. Agentes fazem polling da fila — o sistema atribui atomicamente (sem condição de corrida):

```bash
# Agente "scout" pede trabalho
curl "$MC_URL/api/tasks/queue?agent=scout" -H "Authorization: Bearer $MC_API_KEY"

# Agente "iris" também pede — recebe tarefa diferente
curl "$MC_URL/api/tasks/queue?agent=iris" -H "Authorization: Bearer $MC_API_KEY"
```

### Ordenação de Prioridade

Tarefas são atribuídas nesta ordem:
1. **Prioridade**: critical > high > medium > low
2. **Data de entrega**: Mais cedo primeiro (null = último)
3. **Criação**: Mais antigo primeiro (FIFO dentro da mesma prioridade)

### Controle de Capacidade

Cada agente pode limitar tarefas simultâneas com `max_capacity`:

```bash
curl "$MC_URL/api/tasks/queue?agent=scout&max_capacity=3" \
  -H "Authorization: Bearer $MC_API_KEY"
```

**Quando usar**: Múltiplos agentes com capacidades sobrepostas, balanceamento de carga automático.

## Padrão 3: Pipeline Engine (JIRA / Azure DevOps)

O pipeline engine monitora boards de JIRA ou Azure DevOps e despacha tarefas automaticamente aos agentes quando cards mudam de coluna.

### Como Funciona

1. O poller verifica o board configurado periodicamente
2. Quando um card entra em uma coluna mapeada, a tarefa é criada automaticamente
3. O engine classifica a complexidade da tarefa para selecionar o modelo LLM
4. Despacha para o agente configurado na integração
5. A resolução é postada de volta no card como comentário
6. O card avança para a próxima coluna no board

### Roteamento de Modelo

O engine seleciona o modelo com base no conteúdo da tarefa:

| Tier | Sinais |
|------|--------|
| **Complexo** | debug, diagnose, architect, security audit, incident, refactor, migration |
| **Rotina** | status check, format, rename, ping, summarize, translate, simple, minor |
| **Padrão** | Modelo configurado na integração (tudo mais) |

Tarefas de prioridade crítica sempre usam o modelo mais capaz configurado.

### Configuração

Configure a integração em **Configurações → Integrações** no dashboard, informando:
- Provider (JIRA ou Azure DevOps)
- URL da instância e credenciais
- Mapeamento de colunas → status
- Agente padrão para execução
- Modelo LLM e API key

**Quando usar**: Operação totalmente autônoma integrada ao backlog da equipe.

## Padrão 4: Revisão de Qualidade (Aegis)

Aegis é o gate de qualidade integrado. Quando uma tarefa chega ao status `review`, o scheduler a envia ao agente revisor Aegis para aprovação.

### Fluxo

```
in_progress ──► review ──► Aegis revisa ──► APPROVED ──► done
                                         └─► REJECTED ──► assigned (com feedback)
```

### Como Aegis Revisa

1. O scheduler pega tarefas no status `review`
2. Constrói um prompt de revisão com a descrição e a resolução do agente
3. Envia ao agente Aegis (configurável via `MC_COORDINATOR_AGENT`)
4. Faz parse do veredicto:
   - `VERDICT: APPROVED` → tarefa vai para `done`
   - `VERDICT: REJECTED` → feedback vira comentário, tarefa volta para `assigned`
5. Tarefas rejeitadas são re-despachadas com o feedback incluído no próximo prompt

### Limites de Retry

- Até 3 ciclos de revisão por tarefa
- Após 3 rejeições, tarefa vai para `failed` com feedback acumulado
- Todos os resultados de revisão ficam na tabela `quality_reviews`

### Configurando Aegis

```bash
# Registrar o agente Aegis
curl -X POST "$MC_URL/api/agents/register" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "aegis", "role": "reviewer"}'

# Definir o SOUL de revisor
curl -X PUT "$MC_URL/api/agents/1/soul" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template_name": "reviewer"}'
```

**Quando usar**: Quando quiser validação automática de qualidade antes de marcar tarefas como concluídas.

## Padrão 5: Tarefas Recorrentes (Cron)

Agende criação automática de tarefas em base recorrente usando expressões cron.

### API

```bash
curl -X POST "$MC_URL/api/cron" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "relatorio-diario",
    "schedule": "0 9 * * 1-5",
    "task_template": {
      "title": "Gerar relatório diário de progresso",
      "description": "Resuma todas as tarefas concluídas nas últimas 24 horas.",
      "priority": "medium",
      "assigned_to": "iris"
    }
  }'
```

O scheduler cria tarefas filhas com data a partir do template em cada disparo. Gerencie cron jobs com as ações `pause`, `resume` e `remove`.

**Quando usar**: Relatórios, health checks, auditorias periódicas, tarefas de manutenção.

## Padrão 6: Handoff Multi-Agente

Agente A conclui uma tarefa e cria uma tarefa de acompanhamento atribuída ao Agente B. Isso encadeia agentes em um pipeline.

### Exemplo: Pesquisa → Implementação → Revisão

```bash
# Passo 1: Tarefa de pesquisa para iris
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pesquisar estratégias de cache para a camada de API",
    "priority": "high",
    "assigned_to": "iris"
  }'

# Após iris concluir — Passo 2: Implementação para scout
curl -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implementar cache Redis para /api/products",
    "description": "Com base na pesquisa da TASK-1: padrão cache-aside com TTL de 5min...",
    "priority": "high",
    "assigned_to": "scout"
  }'
```

**Quando usar**: Workflows complexos onde agentes diferentes têm especializações distintas.

## Padrão 7: Recuperação de Tarefas Presas

O sistema recupera automaticamente agentes travados. O job `requeueStaleTasks` do scheduler:

1. Encontra tarefas presas em `in_progress` por 10+ minutos com agente offline
2. Reverte para `assigned` com um comentário explicando o travamento
3. Após 5 requeueamentos por travamento, move a tarefa para `failed`

Isso ocorre automaticamente — sem configuração necessária.

## Combinando Padrões

Em produção, você combinará esses padrões. Uma configuração típica:

1. **Pipeline Engine** detecta cards no JIRA/Azure DevOps (Padrão 3)
2. **Cron** cria tarefas recorrentes de suporte (Padrão 5)
3. **Dispatch por fila** distribui tarefas aos agentes disponíveis (Padrão 2)
4. **Aegis** revisa todo trabalho concluído (Padrão 4)
5. **Recuperação de presos** lida com falhas de agentes (Padrão 7)

```
Pipeline Engine ──► assigned ──► Agente executa ──► Aegis revisa ──► done
     Cron ─────────────┘              │                    │
                                      └── timeout ─────────┘── requeue
```

## Monitoramento em Tempo Real via SSE

Monitore a orquestração em tempo real com Server-Sent Events:

```bash
curl -N "$MC_URL/api/events" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Accept: text/event-stream"
```

Eventos incluem: `task.created`, `task.updated`, `task.completed`, `agent.created`, `agent.status_changed`, e mais.

## Referência

- **[Primeiros Passos](quickstart.md)** — Tutorial do primeiro agente em 5 minutos
- **[Configuração de Agentes](agent-setup.md)** — Registro, SOUL, configuração
- **[Deploy](deployment.md)** — Standalone, Docker, AWS ECS
