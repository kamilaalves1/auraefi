# Primeiros Passos — Seu Primeiro Agente em 5 Minutos

Vá do zero a um loop de agente funcionando usando apenas o Vertex Control Center e `curl`. Sem dependências extras.

## Pré-requisitos

- Vertex Control Center rodando (`pnpm dev` ou Docker)
- Conta admin (padrão: **admin** / **admin**)
- Sua API key (gerada automaticamente na primeira execução, visível em Configurações)

## Passo 1: Inicie o sistema

```bash
pnpm dev
```

Abra http://localhost:3000 e faça login com **admin** / **admin**.

Sua API key fica em **Configurações → API Key**. Exporte para os comandos abaixo:

```bash
export MC_URL=http://localhost:3000
export MC_API_KEY=sua-api-key
```

## Passo 2: Registre um Agente

Agentes se auto-registram via API. É assim que processos autônomos se anunciam ao sistema:

```bash
curl -s -X POST "$MC_URL/api/agents/register" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "scout", "role": "researcher"}' | jq
```

Resposta esperada:

```json
{
  "agent": {
    "id": 1,
    "name": "scout",
    "role": "researcher",
    "status": "idle",
    "created_at": 1711234567
  },
  "registered": true
}
```

**Papéis válidos**: `coder`, `reviewer`, `tester`, `devops`, `researcher`, `assistant`, `agent`

O registro é idempotente — chamar novamente com o mesmo nome apenas atualiza o status para `idle`.

## Passo 3: Crie uma Tarefa

```bash
curl -s -X POST "$MC_URL/api/tasks" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pesquisar preços dos concorrentes",
    "description": "Encontre as páginas de preços dos 3 principais concorrentes e resuma os planos.",
    "priority": "medium",
    "assigned_to": "scout"
  }' | jq
```

Se omitir `assigned_to`, a tarefa vai para `inbox` esperando triagem manual.

## Passo 4: Polling da Fila de Tarefas

O agente busca trabalho pela fila. O endpoint reivindica atomicamente a tarefa de maior prioridade disponível:

```bash
curl -s "$MC_URL/api/tasks/queue?agent=scout" \
  -H "Authorization: Bearer $MC_API_KEY" | jq
```

O status muda automaticamente de `assigned` para `in_progress`. O campo `reason` explica por que essa tarefa foi retornada:

| Reason | Significado |
|--------|-------------|
| `assigned` | Nova tarefa da fila |
| `continue_current` | Agente já tem tarefa em andamento |
| `at_capacity` | Agente no limite de tarefas simultâneas |
| `no_tasks_available` | Nada disponível para este agente |

## Passo 5: Conclua a Tarefa

Quando o agente terminar o trabalho, atualize o status e adicione a resolução:

```bash
curl -s -X PUT "$MC_URL/api/tasks/1" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "done",
    "resolution": "Encontrei preços para Acme (R$99/199/399), Widget Corp (R$79/149/299) e Gadget Inc (R$89/179/349). Todos usam modelo SaaS de 3 tiers."
  }' | jq
```

## Passo 6: Envie um Heartbeat

Heartbeats informam ao sistema que o agente está vivo. Sem eles, agentes são marcados como offline após 10 minutos:

```bash
curl -s -X POST "$MC_URL/api/agents/1/heartbeat" \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Em um agente real, envie heartbeats a cada 30 segundos em background. O array `work_items` retorna tarefas pendentes, menções e notificações.

## O Loop do Agente

```
┌─────────────────────────────────┐
│  1. Registrar no sistema        │
│     POST /api/agents/register   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  2. Buscar trabalho             │◄──────┐
│     GET /api/tasks/queue        │       │
└──────────────┬──────────────────┘       │
               │                          │
               ▼                          │
┌─────────────────────────────────┐       │
│  3. Executar a tarefa           │       │
│     (lógica do agente)          │       │
└──────────────┬──────────────────┘       │
               │                          │
               ▼                          │
┌─────────────────────────────────┐       │
│  4. Reportar resultado          │       │
│     PUT /api/tasks/{id}         │       │
└──────────────┬──────────────────┘       │
               │                          │
               ▼                          │
┌─────────────────────────────────┐       │
│  5. Heartbeat + repetir         │───────┘
│     POST /api/agents/{id}/hb    │
└─────────────────────────────────┘
```

## Próximos Passos

- **[Configuração de Agentes](agent-setup.md)** — SOUL, heartbeat, fontes de agentes
- **[Padrões de Orquestração](orchestration.md)** — Workflows multi-agente, revisão de qualidade, cron
- **[Deploy](deployment.md)** — Opções de produção: standalone, Docker, AWS
