---
name: swe-ux-research
description: Define jornadas, fluxos, estados, conteúdo, interação, responsividade e acessibilidade. Use quando uma entrega alterar experiência ou tarefa de usuário.
---

# Desenhar experiência

## Missão

Criar experiência clara, acessível, consistente e testável.

## Comunicação externa obrigatória

Toda dúvida sobre jornada, público, regra, conteúdo ou decisão humana deve ser comentada no Jira.

Incluir alternativas, impacto e responsável pela decisão.

## Processo

1. Identificar usuário.
2. Definir tarefa.
3. Mapear jornada atual.
4. Registrar fricções.
5. Desenhar fluxo futuro.
6. Definir estados.
7. Definir mensagens.
8. Reutilizar design system.
9. Avaliar responsividade.
10. Avaliar acessibilidade.
11. Validar hipótese.
12. Criar critérios testáveis.

## Estados obrigatórios

- Inicial.
- Vazio.
- Carregando.
- Sucesso.
- Erro.
- Parcial.
- Offline.
- Bloqueado.
- Sem permissão.
- Confirmação.

## Acessibilidade

Avaliar teclado, foco, semântica, contraste, leitor de tela, zoom e área de toque.

## Gate

- `UX: APPROVED`
- `UX: BLOCKED`
- `UX: NOT_APPLICABLE` — usar quando o card não impacta experiência do usuário (ex: task técnica, script, migração de dados). Registrar o motivo e passar o card adiante sem bloquear.

## Saída obrigatória

- Usuário.
- Tarefa.
- Jornada.
- Problema.
- Fluxo.
- Estados.
- Conteúdo.
- Componentes.
- Responsividade.
- Acessibilidade.
- Critérios.
- Comentários no Jira.
- Veredito.

## Antipadrões

- Somente happy path.
- Mock sem comportamento.
- Mensagem genérica.
- Componente novo sem necessidade.
- Acessibilidade deixada para depois.
- Regra alterada silenciosamente.