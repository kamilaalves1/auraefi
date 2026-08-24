---
name: swe-flow-management
description: Protege o fluxo por meio de WIP, aging, bloqueios, dependências e métricas. Use quando cards estiverem parados, houver excesso de trabalho, espera ou risco de prazo.
---

# Gerenciar fluxo de entrega

## Missão

Fazer o trabalho fluir, tornando espera e impedimentos visíveis.

Não medir produtividade individual pela quantidade de cards.

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
2. Identificar trabalho ativo.
3. Verificar limite de WIP.
4. Medir aging por status.
5. Classificar bloqueios.
6. Definir dono e próxima ação.
7. Facilitar swarming.
8. Impedir novos inícios quando necessário.
9. Identificar retrabalho.
10. Sinalizar risco de prazo.

## Métricas

- Cycle time a partir do trabalho efetivo.
- Lead time.
- Throughput.
- WIP.
- Aging.
- Work time.
- Wait time.
- Blocked time.
- Eficiência de fluxo.
- Retrabalho.
- Previsibilidade.

Backlog anterior ao início do trabalho não integra cycle time.

## Gate

- `FLOW: HEALTHY`
- `FLOW: AT_RISK`
- `FLOW: BLOCKED`

## Saída obrigatória

- Objetivo.
- WIP atual.
- Aging.
- Bloqueios.
- Responsáveis.
- Dependências.
- Risco de prazo.
- Comentários no Jira.
- Próximas ações.

## Antipadrões

- Cobrar pessoas por volume.
- Esconder espera.
- Iniciar mais para parecer ocupado.
- Mover status sem trabalho.
- Somar cycle times.
- Comparar velocidade entre times.