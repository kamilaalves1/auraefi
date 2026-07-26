# Guia de Configuração de Agentes

Tudo que você precisa para configurar agentes no Vertex Control Center: métodos de registro, personalidades SOUL, configuração e monitoramento de liveness.

## Registro de Agentes

Há três formas de registrar agentes no sistema.

### Método 1: Auto-registro via API (Recomendado)

Agentes se registram na inicialização. É o caminho mais simples e não requer configuração manual:

```bash
curl -X POST http://localhost:3000/api/agents/register \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "scout",
    "role": "researcher",
    "capabilities": ["web-search", "summarization"]
  }'
```

**Regras para o nome**: 1–63 caracteres, alfanumérico mais `.`, `-`, `_`. Deve começar com letra ou dígito.

**Papéis válidos**: `coder`, `reviewer`, `tester`, `devops`, `researcher`, `assistant`, `agent`

O endpoint é idempotente — registrar o mesmo nome novamente atualiza o status para `idle` e renova `last_seen`. Rate-limitado a 5 registros por minuto por IP.

### Método 2: Criação Manual (UI ou API)

Crie agentes pelo dashboard ou diretamente via API:

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "aegis",
    "role": "reviewer",
    "soul_content": "Você é Aegis, o revisor de qualidade..."
  }'
```

Requer papel `operator` e suporta campos como `soul_content` e `config`.

### Método 3: Sincronização por Config

O sistema pode descobrir agentes automaticamente a partir de um arquivo `agent-config.json`:

```bash
curl -X POST http://localhost:3000/api/agents/sync \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source": "config"}'
```

Configure `AGENT_CONFIG_PATH` para apontar para seu `agent-config.json`.

## SOUL.md — Personalidade do Agente

SOUL é a definição de personalidade e capacidades de um agente. É um arquivo markdown injetado nos prompts de execução, moldando como o agente aborda as tarefas.

### O que vai em um SOUL

- **Identidade** — Quem é o agente, seu nome e papel
- **Expertise** — Quais domínios ele domina
- **Comportamento** — Como aborda problemas, estilo de comunicação
- **Restrições** — O que deve evitar, limitações

### Exemplo: Agente Desenvolvedor

```markdown
# Scout — Desenvolvedor

Você é Scout, um agente desenvolvedor sênior especializado em TypeScript full-stack.

## Expertise
- Next.js, React, Node.js
- Design de banco de dados (SQLite, PostgreSQL)
- Arquitetura de APIs e testes

## Abordagem
- Leia o código existente antes de propor mudanças
- Escreva testes junto com a implementação
- Mantenha as alterações mínimas e focadas

## Restrições
- Nunca commite segredos ou credenciais
- Peça esclarecimentos em requisitos ambíguos
- Sinalize imediatamente preocupações de segurança
```

### Exemplo: Agente Revisor

```markdown
# Aegis — Revisor de Qualidade

Você é Aegis, a porta de qualidade para todo trabalho no sistema.

## Papel
Revise tarefas concluídas quanto a correção, completude e qualidade.

## Critérios de Revisão
- O resultado atende a todas as partes da tarefa?
- Há erros factuais ou alucinações?
- O trabalho é acionável e bem estruturado?

## Formato do Veredicto
Responda com EXATAMENTE um de:

VERDICT: APPROVED
NOTES: <resumo breve>

VERDICT: REJECTED
NOTES: <problemas específicos a corrigir>
```

### Gerenciando o SOUL

**Ler** o SOUL de um agente:

```bash
curl -s http://localhost:3000/api/agents/1/soul \
  -H "Authorization: Bearer $MC_API_KEY" | jq
```

**Atualizar** o SOUL:

```bash
curl -X PUT http://localhost:3000/api/agents/1/soul \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"soul_content": "# Scout — Desenvolvedor\n\nVocê é Scout..."}'
```

**Aplicar um template**:

```bash
curl -X PUT http://localhost:3000/api/agents/1/soul \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"template_name": "developer"}'
```

Templates suportam variáveis de substituição: `{{AGENT_NAME}}`, `{{AGENT_ROLE}}`, `{{TIMESTAMP}}`.

## Configuração do Agente

Cada agente tem um objeto JSON `config` armazenado no banco. Campos principais:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `dispatchModel` | string | Modelo LLM para execução (ex.: `claude-sonnet-5`) |
| `capabilities` | string[] | Lista de capacidades do agente |
| `framework` | string | Framework que criou o agente (ex.: `claude-sdk`) |

Atualizar via API:

```bash
curl -X PUT http://localhost:3000/api/agents \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "scout",
    "config": {
      "dispatchModel": "claude-sonnet-5"
    }
  }'
```

## Heartbeat e Liveness

O sistema acompanha a saúde dos agentes via heartbeats.

### Como Funciona

1. Agente envia `POST /api/agents/{id}/heartbeat` a cada 30 segundos
2. Sistema atualiza `status` para `idle` e renova `last_seen`
3. Sem heartbeat por 10 minutos, agente é marcado como `offline`
4. Tarefas presas (in_progress por 10+ min com agente offline) são requeueadas

### Requisição de Heartbeat

```bash
curl -X POST http://localhost:3000/api/agents/1/heartbeat \
  -H "Authorization: Bearer $MC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token_usage": {
      "model": "claude-sonnet-5",
      "inputTokens": 1500,
      "outputTokens": 300
    }
  }'
```

A resposta inclui itens de trabalho pendentes (tarefas atribuídas, menções, notificações).

### Status do Agente

| Status | Significado |
|--------|-------------|
| `offline` | Sem heartbeat recente, agente inacessível |
| `idle` | Online e pronto para trabalho |
| `busy` | Executando uma tarefa |
| `sleeping` | Pausado pelo usuário |
| `error` | Agente reportou estado de erro |

## Fontes de Agentes

O campo `source` em cada agente indica como ele foi registrado:

| Fonte | Origem |
|-------|--------|
| `manual` | Criado pela UI ou chamada direta de API |
| `self` | Agente se auto-registrou via `/api/agents/register` |
| `config` | Sincronizado do `agent-config.json` |

## Próximos Passos

- **[Primeiros Passos](quickstart.md)** — Tutorial do primeiro agente em 5 minutos
- **[Padrões de Orquestração](orchestration.md)** — Workflows multi-agente, auto-dispatch, revisão de qualidade
- **[Deploy](deployment.md)** — Produção: standalone, Docker, AWS ECS
