---
name: swe-ux-research
description: Define jornadas, fluxos, estados, conteúdo, interação, responsividade e acessibilidade. Use quando uma entrega alterar experiência ou tarefa de usuário.
---

# Desenhar experiência

## Missão

Criar experiência clara, acessível, consistente e testável.

Não aprovar jornada com estado indefinido, mensagem genérica ou fluxo sem erro mapeado.

## Comunicação externa obrigatória

Toda dúvida sobre jornada, público, regra, conteúdo ou decisão humana deve ser comentada no Jira.

Incluir alternativas, impacto e responsável pela decisão.

## Processo

### Passo 1 — Identificar usuário e contexto

- Quem é o usuário? (papel, nível técnico, contexto de uso)
- Qual dispositivo e ambiente? (desktop, mobile, baixa conectividade)
- Qual é o objetivo da tarefa do usuário — não da feature, mas do usuário?

### Passo 2 — Mapear jornada atual (se existir)

Antes de propor melhorias, descrever o fluxo atual:
- Como o usuário realiza essa tarefa hoje?
- Onde são os pontos de fricção identificados? (lentidão, erro, confusão, abandono)
- O que o usuário tenta fazer que o sistema não permite claramente?

Se não houver fluxo atual (feature nova), registrar isso explicitamente.

### Passo 3 — Definir tarefa e fluxo futuro

- Qual a tarefa principal? (verbo + objeto: ex: "filtrar transações por data")
- Quais os passos necessários?
- Quais são os estados possíveis em cada passo?

### Passo 4 — Definir estados obrigatórios

Para cada tela ou componente relevante, mapear:

| Estado | Descrição | O que o usuário vê? | O que pode fazer? |
|---|---|---|---|
| Inicial | Sem dados ainda | | |
| Vazio | Dados carregados, nenhum resultado | Mensagem explicativa + ação sugerida | |
| Carregando | Operação em andamento | Indicador de progresso | Pode cancelar? |
| Sucesso | Operação concluída | Confirmação clara | Próximo passo? |
| Erro | Falha na operação | Mensagem acionável + causa | Como recuperar? |
| Parcial | Resultado incompleto | O que foi e o que não foi concluído | |
| Offline | Sem conectividade | O que funciona offline? | |
| Bloqueado | Usuário sem permissão | Mensagem explicativa sem expor detalhes | |
| Sem permissão | Ação não autorizada | Orientação sobre como obter acesso | |
| Confirmação | Ação destrutiva ou irreversível | Texto claro do que será feito | Confirmar / Cancelar |

### Passo 5 — Definir conteúdo e mensagens

- Rótulos de botões: verbo + objeto (ex: "Salvar rascunho", não "OK")
- Mensagens de erro: causa + ação (ex: "Sessão expirada — faça login novamente", não "Erro 401")
- Mensagens de sucesso: o que foi feito (ex: "Pedido #1234 criado", não "Sucesso")
- Textos vazios: orientação útil (ex: "Nenhuma transação encontrada. Ajuste os filtros para ver mais resultados.")

### Passo 6 — Reutilizar design system

Antes de propor qualquer componente, verificar se existe equivalente no design system do repositório (`design-system.md` ou pasta de componentes).

Se não existir design system documentado no repositório: declarar explicitamente e usar princípios gerais de consistência (mesmo padrão que outros formulários, mesma hierarquia visual que outras telas similares).

Não propor componente novo quando um existente atende.

### Passo 7 — Responsividade

- O layout funciona em mobile (320px+), tablet e desktop?
- Elementos interativos têm área de toque mínima de 44×44px (WCAG 2.5.5)?
- Conteúdo prioritário visível sem scroll em mobile?

### Passo 8 — Acessibilidade (WCAG 2.1 AA como referência mínima)

Verificar os critérios mais críticos para a mudança:

| Critério | O que verificar |
|---|---|
| Navegação por teclado | Todos os elementos interativos acessíveis via Tab/Enter/Space/Escape? |
| Foco visível | Indicador de foco visível em todos os elementos interativos? (WCAG 2.4.7) |
| Semântica HTML | Uso correto de `button`, `a`, `label`, `heading`, `main`, `nav`? |
| Contraste | Texto normal: mínimo 4.5:1. Texto grande (18px+): mínimo 3:1. (WCAG 1.4.3) |
| Leitor de tela | `aria-label` ou texto visível em ícones e botões sem texto? |
| Zoom | Interface utilizável com zoom de 200%? (WCAG 1.4.4) |
| Mensagens de status | Erros e confirmações anunciados para leitores de tela (`aria-live` ou `role="alert"`)? |
| Formulários | `label` associado a cada input? Erros identificados por texto, não só por cor? |

Se algum critério não puder ser verificado sem acesso ao protótipo ou implementação real, declarar explicitamente.

### Passo 9 — Critérios testáveis

Para cada decisão de UX, gerar pelo menos um critério verificável no formato Dado/Quando/Então:

> Dado que o usuário está na tela X sem dados,
> Quando a página carrega,
> Então ele vê a mensagem "Nenhum resultado encontrado" com botão "Limpar filtros".

Evitar critérios como "a tela deve ser igual ao wireframe" — não são verificáveis objetivamente.

### Passo 10 — Validação de hipótese (quando aplicável)

Se o card envolve uma decisão de UX não validada com usuários reais (ex: novo fluxo, mudança de navegação, reformulação de formulário):

- Identificar a hipótese de UX: "Acreditamos que [mudança] vai [resultado] para [usuário]".
- Definir o método de validação: teste de usabilidade presencial ou remoto, A/B test, análise de funil, entrevista.
- Identificar se a validação requer usuários reais — se sim, declarar dependência humana explicitamente.
- Se a validação não for possível neste card: registrar como risco e emitir `UX: APPROVED` com condição documentada.

## Gate

- `UX: APPROVED` — jornada, estados, mensagens e acessibilidade WCAG 2.1 AA avaliados. Critérios testáveis definidos.
- `UX: BLOCKED` — dúvida sobre jornada, público, regra ou conteúdo que impede definição. Publicar no Jira.
- `UX: NOT_APPLICABLE` — usar quando o card não impacta experiência do usuário (ex: task técnica, script, migração de dados). Registrar o motivo e passar o card adiante sem bloquear.

## Saída obrigatória

- Usuário e contexto de uso.
- Tarefa principal.
- Jornada atual (ou declaração de feature nova).
- Fricções identificadas no fluxo atual.
- Fluxo futuro com passos.
- Tabela de estados com o que o usuário vê e pode fazer em cada estado.
- Conteúdo e mensagens definidos.
- Componentes utilizados (com referência ao design system ou justificativa de componente novo).
- Responsividade avaliada.
- Checklist de acessibilidade WCAG com resultado por critério.
- Critérios testáveis no formato Dado/Quando/Então.
- Hipótese de UX e método de validação (quando aplicável).
- Comentários publicados no Jira para dúvidas ou bloqueios.
- Gate emitido.

## Antipadrões

- Somente happy path — toda jornada tem erros e estados vazios.
- Mock sem comportamento — estado visual sem definir o que o usuário faz.
- Mensagem genérica — "Ocorreu um erro" não é mensagem acionável.
- Componente novo sem verificar o design system.
- Acessibilidade deixada para depois.
- Regra alterada silenciosamente sem registrar no Jira.
- Critério "deve ser igual ao wireframe" — não é verificável.
- Validar hipótese só com stakeholders internos sem usuário real.
