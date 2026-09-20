---
name: swe-flow-management
description: Protege o fluxo por meio de WIP, aging, bloqueios, dependências e métricas. Use quando cards estiverem parados, houver excesso de trabalho, espera ou risco de prazo.
---

# Gerenciar fluxo de entrega

## Missão

Fazer o trabalho fluir, tornando espera e impedimentos visíveis.

Não medir produtividade individual pela quantidade de cards.

## Fontes de dados obrigatórias

As métricas de fluxo devem ser baseadas em dados reais. Antes de calcular ou reportar qualquer métrica, identificar a fonte disponível:

- **Jira:** datas de transição de status, cards em cada coluna, links de bloqueio, responsáveis, datas de criação e resolução.
- **Comentários no card:** registros de início de bloqueio, eventos relevantes.
- **Histórico do Second Brain:** padrões de ciclo de cards similares no domínio.
- **Informações declaradas no card:** estimativas e compromissos explícitos.

**Quando os dados não estiverem disponíveis:**
- Declarar explicitamente quais métricas não puderam ser calculadas e por quê.
- Não inventar datas, tempos ou taxas.
- Se não houver dados de datas de transição: declarar "cycle time não calculável — datas de transição de status não disponíveis no contexto injetado".
- Emitir `FLOW: BLOCKED` se a ausência de dados impede identificar um impedimento ativo.

**Limiares de alerta (referência — ajustar para o contexto do time):**
- Card em desenvolvimento por mais de 3 dias sem atualização → `FLOW: AT_RISK`
- Mesmo card retornando para etapa anterior mais de 2 vezes → `FLOW: AT_RISK`
- WIP acima do limite configurado → `FLOW: AT_RISK` ou `FLOW: BLOCKED`
- Card bloqueado sem dono identificado → `FLOW: BLOCKED`

## Comunicação externa obrigatória

Todo impedimento deve ser comentado no Jira contendo:

- causa;
- data de início;
- impacto;
- responsável pela resolução;
- ação necessária;
- prazo, quando existir;
- status bloqueado.

A remoção do bloqueio também deve ser comentada.

## Processo

1. Confirmar objetivo do período.
2. Identificar trabalho ativo — listar cards em andamento com status e responsável.
3. Verificar limite de WIP — comparar com o limite configurado ou acordado pelo time.
4. Medir aging por status — usando datas de transição disponíveis no contexto ou declarar indisponibilidade.
5. Classificar bloqueios por causa (técnico, dependência externa, decisão pendente, falta de informação).
6. Definir dono e próxima ação para cada bloqueio.
7. Facilitar swarming quando necessário — identificar quem pode ajudar.
8. Impedir novos inícios quando WIP estiver no limite.
9. Identificar retrabalho — cards que voltaram para etapas anteriores.
10. Sinalizar risco de prazo com evidência (data comprometida vs. aging atual).

## Métricas

Calcular apenas com dados disponíveis no contexto. Declarar fonte ou indisponibilidade para cada métrica:

- **Cycle time:** tempo de trabalho efetivo (início real ao done). Fonte: datas de transição no Jira.
- **Lead time:** tempo total do pedido ao done. Fonte: data de criação e data de resolução.
- **Throughput:** cards concluídos por período. Fonte: cards com status done no período.
- **WIP:** cards em andamento agora. Fonte: cards com status ativo.
- **Aging:** tempo que cada card está no status atual. Fonte: data da última transição.
- **Blocked time:** tempo em status bloqueado. Fonte: comentários de bloqueio e desbloqueio.
- **Eficiência de fluxo:** work time / lead time. Calculável somente se ambos estiverem disponíveis.
- **Retrabalho:** cards que retornaram a etapas anteriores. Fonte: histórico de transições.

Backlog anterior ao início do trabalho não integra cycle time.

## Gate

- `FLOW: HEALTHY` — WIP dentro do limite, sem bloqueios ativos, aging dentro do esperado.
- `FLOW: AT_RISK` — WIP próximo do limite, aging elevado ou risco de prazo identificado sem bloqueio formal.
- `FLOW: BLOCKED` — impedimento ativo sem dono ou ação definida, ou WIP acima do limite sem ação.
- `FLOW: NOT_APPLICABLE` — usar quando não há cards ativos ou o card em questão não afeta o fluxo da squad. Passar adiante sem bloquear.

## Saída obrigatória

- Objetivo do período.
- WIP atual (número e lista de cards).
- Aging por card ou status (com fonte ou declaração de indisponibilidade).
- Bloqueios identificados com causa, responsável e próxima ação.
- Dependências externas.
- Risco de prazo com evidência.
- Métricas disponíveis com fonte declarada.
- Comentários publicados no Jira para impedimentos.
- Gate emitido com justificativa.

## Antipadrões

- Cobrar pessoas por volume.
- Esconder espera.
- Iniciar mais para parecer ocupado.
- Mover status sem trabalho.
- Inventar métricas sem fonte de dados real.
- Somar cycle times.
- Comparar velocidade entre times.
