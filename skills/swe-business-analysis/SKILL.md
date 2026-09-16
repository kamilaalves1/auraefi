---
name: swe-business-analysis
description: Converte outcomes em requisitos, regras, fluxos, integrações e critérios verificáveis. Use quando um card estiver incompleto, ambíguo ou não puder ser implementado e testado objetivamente.
---

# Refinar requisitos de negócio

## Missão

Transformar o problema aprovado em comportamento implementável, sem inventar regras.

## Comunicação externa obrigatória

Toda dúvida funcional deve ser publicada no Jira.

O comentário deve conter:

- trecho ou regra ambígua;
- cenários possíveis;
- diferença de impacto entre as opções;
- responsável pela decisão;
- critério bloqueado;
- status `ANALYSIS: BLOCKED`.

Não escolher a opção “mais provável”.

## Levantamento

Responder:

- Quem inicia?
- Qual evento inicia?
- Quais pré-condições?
- Que dados entram?
- Quais validações?
- Quais regras?
- Quais sistemas?
- Quem chama quem?
- Que dados são alterados?
- Qual o resultado?
- O que acontece em erro?
- Pode repetir?
- Como tratar duplicidade?
- Quem pode executar?
- Como auditar?
- Existe atividade manual?
- Existe cutoff?

## Cenários obrigatórios

- Caminho principal.
- Ausência de informação.
- Regra não atendida.
- Operação já executada.
- Duplicidade.
- Timeout.
- Indisponibilidade.
- Resultado parcial.
- Permissão insuficiente.
- Dado inválido.
- Cancelamento.
- Reprocessamento.

## Critérios de aceite

Usar Dado/Quando/Então com resultado observável.

Evitar “funcionar corretamente”, “validar integração” e “ajustar sistema”.

## Gate

`ANALYSIS: READY` somente com regras, exceções, permissões, integrações, critérios e dúvidas resolvidas.

`ANALYSIS: BLOCKED` quando houver dúvidas funcionais não resolvidas que impeçam a implementação.

`ANALYSIS: NOT_APPLICABLE` quando o card for puramente técnico e não requerer análise de negócio.

## Second Brain

Antes de analisar o card, o sistema injeta automaticamente contexto relevante do Second Brain
(base de conhecimento de cards anteriores e fontes externas) quando disponível.

Use esse contexto para:
- Identificar regras de negócio já conhecidas no domínio
- Evitar perguntas já respondidas em cards anteriores
- Manter consistência com decisões de negócio anteriores

## Saída obrigatória

- Entendimento.
- Cenário atual.
- Cenário futuro.
- Atores.
- Regras.
- Exceções.
- Integrações.
- Dados.
- Permissões.
- Critérios.
- Dependências.
- Dúvidas.
- Comentários publicados no Jira.
- Status.

## Antipadrões

- Texto longo sem critério.
- Criar regra.
- Esconder dúvida.
- Marcar READY com decisão pendente.
- Documentar somente happy path.