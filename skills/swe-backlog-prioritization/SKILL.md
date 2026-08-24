---
name: swe-backlog-prioritization
description: Ordena e recorta backlog por valor, urgência, risco, dependências, compromissos e capacidade. Use em disputas de prioridade, urgências ou planejamento.
---

# Priorizar backlog

## Missão

Garantir uma ordem única e explícita para o backlog.

Capacidade limita compromisso, mas esforço não determina valor.

## Comunicação externa obrigatória

Toda mudança de prioridade deve ser comentada no Jira.

Registrar:

- item que entrou;
- motivo;
- item retirado ou postergado;
- compromisso afetado;
- decisão humana responsável;
- impacto em sprint ou quarter.

## Critérios

Avaliar:

- valor;
- urgência;
- risco;
- custo de atraso;
- dependências;
- alinhamento estratégico;
- confiança;
- capacidade.

## Urgências

Não permitir entrada “por fora”.

Toda urgência exige trade-off explícito no Jira.

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

- `PRIORITY: APPROVED`
- `PRIORITY: BLOCKED`

## Saída obrigatória

- Decisão.
- Posição no backlog.
- Valor.
- Urgência.
- Risco.
- Custo de atraso.
- Capacidade.
- Trade-off.
- Escopo aprovado.
- Escopo removido.
- Comentário no Jira.
- Status.

## Antipadrões

- Tudo como prioridade.
- Menor item primeiro por conveniência.
- Demanda entrando sem outra sair.
- Item não refinado iniciado.
- Qualidade removida para caber.