---
name: aura-engineer-data-change
description: Verifica se o card envolve alteração de banco de dados ou estrutura de dados. Se envolver, avalia se a mudança é segura, compatível e reversível. Use em qualquer card que passe pela esteira.
---

# Avaliar alterações de banco de dados

Esta skill segue o mesmo processo de `swe-data-engineering`.

## Missão

Identificar se o card cria, altera ou remove estruturas de dados (tabelas, colunas, índices, constraints, enums, migrations) e, se isso acontecer, garantir que a mudança é segura, compatível com os consumidores existentes e pode ser revertida.

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

Encerrar aqui.

### Passo 2 — Se houver alteração, avaliar

**Compatibilidade:**
- A migration é aditiva (adiciona coluna, tabela, índice) ou destrutiva (remove, renomeia, altera tipo)?
- Se há renomeio ou remoção: existe algum consumer que depende do nome antigo?

**Reversibilidade:**
- Se o deploy precisar ser revertido, o banco pode voltar ao estado anterior?
- Existe `down migration` ou equivalente?
- Se não existir: declarar explicitamente que o rollback de banco não é possível.

**Dados existentes:**
- A migration altera linhas existentes (backfill)? Se sim: volume estimado e risco de lock?

**Dados sensíveis:**
- A nova estrutura armazena CPF, cartão, senha, token ou dado sensível?
- Se sim: está com criptografia ou mascaramento adequado?

## Gate

- `DATA: APPROVED` — alteração segura e analisada.
- `DATA: APPROVED_WITH_CONDITIONS` — aprovado com ressalvas registradas.
- `DATA: BLOCKED` — risco que impede avanço sem decisão humana.
- `DATA: NOT_APPLICABLE` — card não envolve alteração de estrutura de dados.

## Saída obrigatória quando há alteração

- O que muda no banco
- Tipo: aditiva ou destrutiva
- Consumidores afetados
- Rollback possível: sim / não / parcialmente
- Dados sensíveis: sim / não
- Risco de lock: sim / não / não se aplica
- Gate e justificativa

## Antipadrões

- Aprovar sem verificar se há migration no card
- Aprovar migration destrutiva sem identificar consumidores
- Não declarar ausência de rollback
- Inventar estrutura não descrita no card
