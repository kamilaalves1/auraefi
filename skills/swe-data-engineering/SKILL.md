---
name: swe-data-engineering
description: Verifica se o card envolve alteração de banco de dados ou estrutura de dados. Se envolver, avalia se a mudança é segura, compatível e reversível. Use em qualquer card que passe pela esteira.
---

# Avaliar alterações de banco de dados

## Missão

Identificar se o card cria, altera ou remove estruturas de dados (tabelas, colunas, índices, constraints, enums, migrations) e, se isso acontecer, garantir que a mudança é segura, compatível com os consumidores existentes e pode ser revertida.

## Comunicação externa obrigatória

Todo bloqueio, risco identificado, ausência de rollback, dado sensível sem proteção ou necessidade de decisão humana deve ser publicado como comentário no card do Jira.

O comentário deve conter:
- o que foi identificado na alteração de dados;
- o risco ou bloqueio específico;
- o que foi verificado (migration, consumidores, volume, rollback);
- o que está faltando ou impedindo aprovação;
- responsável esperado pela decisão;
- gate emitido e justificativa.

Se não conseguir publicar o comentário, não emitir `DATA: APPROVED` ou `DATA: BLOCKED` — registrar a falha internamente.

## Processo

### Passo 1 — Verificar se há alteração de dados

Inspecionar:

- O código commitado ou descrito no card contém arquivos de migration (`.sql`, `*Migration*`, `*migration*`, `schema.prisma`, `flyway`, `liquibase`, `alembic`)?
- O card menciona criação ou alteração de tabela, coluna, índice ou enum?
- O endpoint ou serviço descrito persiste dados novos ou altera estrutura existente?

Se a resposta for **não** para todas as perguntas acima:

```
DATA: NOT_APPLICABLE
Motivo: o card não envolve alteração de estrutura de dados.
```

Encerrar aqui. Não é necessário análise adicional.

### Passo 2 — Se houver alteração, avaliar

Para cada alteração identificada, verificar:

**Compatibilidade:**
- A migration é aditiva (adiciona coluna, tabela, índice) ou destrutiva (remove, renomeia, altera tipo)?
- Migrations aditivas são seguras. Migrations destrutivas exigem atenção.
- Se há renomeio ou remoção: existe algum consumer (código, job, relatório, API externa) que depende do nome antigo?
- Se houver consumidor identificado: a migration pode ser executada sem quebrar o consumer antes de atualizar o código?

**Reversibilidade:**
- Se o deploy precisar ser revertido, o banco pode voltar ao estado anterior?
- Existe `down migration` ou equivalente?
- Se não existir: declarar explicitamente que o rollback de banco não é possível neste card e registrar no Jira para aceite humano.

**Dados existentes:**
- A migration altera linhas existentes (backfill)?
- Se sim: qual o volume estimado? A estimativa deve vir do card, de comentários no Jira ou de documentação do sistema — nunca inventada. Se não for possível estimar, declarar "volume desconhecido — verificar antes de executar em produção".
- Há risco de lock em produção para tabelas com alto volume? (operações que reescrevem linhas ou alteram tipos bloqueiam a tabela em alguns bancos)

**Dados sensíveis:**
- A nova coluna ou tabela armazena CPF, cartão, senha, token ou qualquer dado classificado como sensível?
- Se sim: está sendo armazenado com criptografia ou mascaramento adequado?

### Passo 3 — Verificar ausência de evidência

Se o card descreve uma alteração de dados mas não inclui a migration real (apenas menciona que será criada):
- Não inventar a estrutura da migration.
- Declarar que a migration não está disponível para revisão.
- Emitir `DATA: BLOCKED` se a ausência impede avaliação de risco.
- Emitir `DATA: APPROVED_WITH_CONDITIONS` se a alteração é descrita com suficiente detalhe para avaliação e o risco é baixo.

## Gate

- `DATA: APPROVED` — alteração de dados identificada, analisada e considerada segura.
- `DATA: APPROVED_WITH_CONDITIONS` — aprovado com ressalvas registradas no Jira (ex: "rollback de banco não disponível — aceito conscientemente", "volume desconhecido — monitorar locks em produção").
- `DATA: BLOCKED` — alteração identificada com risco que impede avanço sem decisão humana. Publicar no Jira com detalhe do risco.
- `DATA: NOT_APPLICABLE` — card não envolve alteração de estrutura de dados.

## Saída obrigatória quando há alteração

- O que muda no banco (tabela, coluna, tipo, constraint).
- Tipo: aditiva ou destrutiva.
- Consumidores afetados (ou "nenhum identificado após verificação").
- Rollback possível: sim / não / parcialmente — com justificativa.
- Dados sensíveis envolvidos: sim / não — com detalhe se sim.
- Risco de lock em produção: sim / não / não se aplica — com justificativa.
- Volume estimado para backfill (ou "desconhecido — verificar antes de produção").
- Comentário publicado no Jira (obrigatório para BLOCKED ou APPROVED_WITH_CONDITIONS).
- Gate emitido e justificativa.

## Antipadrões

- Emitir `DATA: APPROVED` sem ter verificado se há migration no card.
- Aprovar migration destrutiva sem identificar consumidores.
- Não declarar ausência de rollback quando ela existe.
- Inventar estrutura de banco que não foi descrita no card.
- Inventar estimativa de volume sem fonte.
- Bloquear sem publicar comentário explicativo no Jira.
