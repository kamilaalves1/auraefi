---
name: swe-backlog-prioritization
description: Ordena e recorta backlog por valor, urgência, risco, dependências, compromissos e capacidade. Use em disputas de prioridade, urgências ou planejamento.
---

# Priorizar backlog

## Missão

Garantir uma ordem única e explícita para o backlog.

Capacidade limita compromisso, mas esforço não determina valor.

## Fontes de dados obrigatórias

A priorização deve ser baseada em dados reais, não em estimativas inventadas.

Antes de emitir qualquer avaliação de valor, urgência ou custo de atraso, verificar as fontes disponíveis:

- **Jira:** épicos, sprints, datas de entrega, cards bloqueados, comentários de stakeholders.
- **Histórico de cards similares:** cards concluídos no mesmo domínio indicam padrão de complexidade e valor.
- **Critérios declarados no card:** o que o autor do card definiu como valor, urgência e impacto.
- **Contexto do Second Brain:** decisões de priorização anteriores no mesmo domínio.

**Quando os dados não estiverem disponíveis:**
- Declarar explicitamente quais critérios não puderam ser avaliados e por quê.
- Não inventar métricas de valor, urgência ou custo de atraso.
- Se a ausência de dados impedir uma decisão de priorização confiável, emitir `PRIORITY: BLOCKED` com a lista de informações necessárias.
- Não emitir `PRIORITY: APPROVED` com critérios inventados.

## Comunicação externa obrigatória

Toda mudança de prioridade deve ser comentada no Jira.

Registrar:

- item que entrou;
- motivo;
- item retirado ou postergado;
- compromisso afetado;
- decisão humana responsável;
- impacto em sprint ou quarter.

## Critérios de avaliação

Avaliar cada item com os critérios abaixo. Para cada critério, indicar a fonte da avaliação (Jira, card, Second Brain, declarado pelo solicitante) ou declarar "não disponível":

| Critério | O que avaliar | Fonte esperada |
|---|---|---|
| **Valor** | Qual problema resolve? Para quem? | Card, critérios de aceite, PM |
| **Urgência** | Existe prazo externo ou regulatório? | Card, comentários no Jira |
| **Risco** | O que acontece se não for feito agora? | Card, histórico do domínio |
| **Custo de atraso** | Qual o impacto por sprint de espera? | PM, GPM, dados financeiros |
| **Dependências** | Este item desbloqueia outros? | Jira, links entre cards |
| **Alinhamento estratégico** | Está no roadmap ou OKR corrente? | PM, GPM |
| **Confiança** | Há evidência suficiente para estimar? | BA, arquiteto, histórico |
| **Capacidade** | O time consegue executar neste ciclo? | Scrum Master, histórico de velocity |

**Critério de desempate:** quando dois items têm valor e urgência similares, priorizar pelo maior custo de atraso. Se ainda empatados, priorizar o que desbloqueia mais dependências. Registrar o critério de desempate usado.

## Urgências

Não permitir entrada "por fora".

Toda urgência exige trade-off explícito no Jira: o que sai ou é postergado para que a urgência entre.

## Recorte

Preservar outcome e fluxo mínimo.

Não cortar:

- segurança;
- integridade de dados;
- observabilidade mínima;
- rollback;
- regulação;
- critério essencial.

## Gate

- `PRIORITY: APPROVED` — priorização concluída com critérios avaliados e registrados.
- `PRIORITY: BLOCKED` — faltam informações necessárias para priorizar com confiança (valor desconhecido, capacidade não avaliada, trade-off não decidido).
- `PRIORITY: NOT_APPLICABLE` — usar quando o card já tem prioridade definida e não há disputas ou urgências no backlog. Passar adiante sem bloquear.

## Saída obrigatória

- Decisão de priorização.
- Posição no backlog com justificativa.
- Avaliação de cada critério com fonte ou "não disponível".
- Critério de desempate usado (se aplicável).
- Trade-off: o que foi postergado ou removido e por quê.
- Compromissos afetados.
- Escopo aprovado e escopo removido.
- Comentário publicado no Jira.
- Gate emitido.

## Antipadrões

- Tudo como prioridade.
- Menor item primeiro por conveniência.
- Demanda entrando sem outra sair.
- Item não refinado iniciado.
- Qualidade removida para caber.
- Inventar valor ou custo de atraso sem fonte.
- Priorizar pelo volume de pedidos em vez de impacto.
