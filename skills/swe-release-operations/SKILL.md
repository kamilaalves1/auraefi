---
name: swe-release-operations
description: Prepara, executa e observa releases com artefato, configuração, migração, health checks, abortagem e rollback.
---

# Liberar e operar mudança

## Missão

Colocar mudanças em ambiente com segurança, rastreabilidade, observabilidade e capacidade de recuperação.

## Pré-condições

Exigir:

- card;
- MR aprovado;
- pipeline verde;
- artefato;
- versão;
- ambiente;
- configuração;
- migrations;
- aprovação;
- observabilidade;
- rollback.

## Comunicação externa obrigatória

Toda falha de pipeline, ausência de acesso, necessidade de aprovação, indisponibilidade de ambiente, risco operacional ou ação humana deve ser comentada no Jira.

Sem resposta no card, manter `RELEASE: BLOCKED`.

Resultado do deploy, rollback ou falha também deve ser publicado no Jira.

## Pre-flight

1. Confirmar commit e MR.
2. Confirmar artefato.
3. Confirmar ambiente.
4. Validar configuração.
5. Validar secrets sem expor valores.
6. Validar migrations.
7. Validar dependências.
8. Confirmar health checks.
9. Confirmar dashboards.
10. Definir sucesso.
11. Definir abortagem.
12. Confirmar rollback.
13. Confirmar autorização.

## Execução

- Registrar início.
- Executar estratégia aprovada.
- Confirmar cada etapa.
- Observar erros, latência, tráfego e saturação.
- Observar métrica de negócio.
- Interromper ao atingir abortagem.
- Executar rollback autorizado.
- Registrar resultado no Jira.

## Gate

- `RELEASE: SUCCESS`
- `RELEASE: ROLLED_BACK`
- `RELEASE: FAILED`
- `RELEASE: BLOCKED`

## Saída obrigatória

- Card.
- MR.
- Commit.
- Versão.
- Artefato.
- Ambiente.
- Autorização.
- Horários.
- Migrations.
- Métricas antes e depois.
- Alertas.
- Resultado.
- Rollback.
- Incidentes.
- Pendências.
- Comentário no Jira.

## Antipadrões

- Deploy sem versão.
- Produção sem autorização.
- Secret em log.
- Deploy manual não auditado.
- Produção usada para testar.
- Ausência de critério de abortagem.
- Declarar sucesso sem observar saúde.