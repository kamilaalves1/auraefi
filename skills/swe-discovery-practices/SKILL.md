---
name: swe-discovery-practices
description: Valida hipóteses de produto, formula experimentos e alinha discovery com negócio e engenharia. Use quando uma demanda precisar de validação de problema, definição de experimento ou alinhamento de oportunidade antes de entrar no backlog.
---

# Conduzir discovery de produto

## Missão

Garantir que a squad trabalhe no problema certo, para o usuário certo, com hipótese clara e experimento definido antes de comprometer capacidade de engenharia.

Não gerar backlog sem evidência. Não transformar hipótese em requisito sem validação.

## Comunicação externa obrigatória

Toda dúvida sobre contexto de negócio, ausência de dados, falta de acesso a usuários ou conflito de prioridade deve ser comentada no Jira.

O comentário deve conter:
- o que está faltando;
- impacto na hipótese;
- quem deve responder;
- prazo esperado.

## Processo

### Fase 1 — Enquadramento do problema

1. Identificar o comportamento observável do usuário que motiva o discovery.
2. Separar fatos (logs, métricas, tickets, NPS) de interpretações.
3. Definir o problema como: *quem* tem *qual dificuldade* em *qual contexto*, com *qual impacto mensurável*.
4. Verificar se o problema já foi investigado em cards anteriores (usar contexto do Second Brain se disponível).
5. Registrar restrições conhecidas: regulatório, orçamento, prazo, integrações.

### Fase 2 — Hipótese

Formatar a hipótese como:

> Acreditamos que **[mudança ou intervenção]** vai causar **[resultado esperado]** para **[segmento de usuário]**, o que será medido por **[indicador]**.

A hipótese deve ser falsificável — deve ser possível provar que está errada.

### Fase 3 — Experimento

Definir o menor experimento que valide ou invalide a hipótese:

- Tipo: entrevista, teste de usabilidade, A/B, spike técnico, protótipo, análise de dados.
- Critério de sucesso: valor numérico ou comportamento observável que confirmará a hipótese.
- Critério de falha: valor ou comportamento que invalidará a hipótese.
- Duração máxima: prazo para encerrar o experimento e decidir.
- Responsável pela execução.

### Fase 4 — Priorização do próximo passo

Ao final do discovery, indicar um dos caminhos:

- **Avançar para backlog:** hipótese validada, problema claro, oportunidade justificada.
- **Novo experimento:** hipótese parcialmente validada, lacuna identificada.
- **Descartar:** hipótese invalidada ou problema irrelevante para o momento.

## Dependências entre raias

- **Product lane:** enquadramento de problema e hipótese.
- **Analysis lane:** separação de fatos, restrições, documentação de decisões.
- **Facilitation lane:** timeboxing, visibilidade de dependências, encerramento com decisão e dono.
- **Prioritization lane:** stack rank por custo de atraso e redução de risco — não por volume de pedidos.

## Entrega vertical obrigatória

Preferir fatia vertical (endpoint + lógica + UI mínima + teste) sobre entrega horizontal por camada.

Nunca definir como próximo passo: "criar todos os endpoints primeiro" ou "desenhar todo o banco antes".

## Gate

- `DISCOVERY: READY` — hipótese formulada, experimento definido, critérios de sucesso e falha claros, próximo passo decidido.
- `DISCOVERY: BLOCKED` — falta informação, acesso a usuários, dados ou decisão de negócio para prosseguir.
- `DISCOVERY: NOT_APPLICABLE` — card não requer discovery (requisito já validado, bug, tarefa técnica com escopo claro).

## Saída obrigatória

- Problema enquadrado (quem, o quê, contexto, impacto).
- Fatos versus interpretações.
- Restrições identificadas.
- Hipótese no formato padrão.
- Experimento definido (tipo, critério de sucesso, critério de falha, duração, responsável).
- Próximo passo com justificativa.
- Comentário publicado no Jira.
- Gate emitido.

## Antipadrões

- Transformar hipótese em requisito sem validar.
- Gerar backlog de itens sem priorização.
- Discovery interminável sem decisão.
- Experimento sem critério de encerramento.
- Ignorar dados existentes e partir direto para entrevistas.
- Validar apenas com stakeholders internos, sem usuário real.
- Priorizar pelo volume de pedidos em vez de custo de atraso.
