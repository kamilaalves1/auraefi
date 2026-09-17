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

1. **Ler a decisão de rollout do Arquiteto** — o comentário `[ARCHITECTURE: DECISION]` no card deve conter a estratégia de ativação, métricas de sucesso e critério de abortagem com valores específicos. Se não existir, marcar `RELEASE: BLOCKED` e solicitar ao Arquiteto antes de prosseguir.
2. Confirmar commit e MR.
3. Confirmar artefato.
4. Confirmar ambiente.
5. Validar configuração.
6. Validar secrets sem expor valores.
7. Validar migrations.
8. Validar dependências.
9. Confirmar health checks.
10. Confirmar dashboards configurados para as métricas definidas pelo Arquiteto.
11. Definir sucesso com os valores exatos do Arquiteto (não genéricos).
12. Definir critério de abortagem com os valores exatos do Arquiteto.
13. Confirmar rollback — diferenciar: código, configuração, schema, dados.
14. Confirmar autorização.

## Execução da estratégia definida pelo Arquiteto

O DevOps não define a estratégia de rollout — executa a que o Arquiteto especificou. Se a estratégia não estiver clara o suficiente para execução mecânica, bloquear e pedir complementação.

**Para cada estratégia:**

- **Feature flag:** criar a flag no sistema configurado com o percentual inicial exato. Incrementar nos intervalos definidos. Monitorar as métricas definidas entre cada incremento. Não avançar se métricas estiverem fora dos limites.
- **Canary:** implantar no percentual de instâncias definido. Observar pelo período definido. Promover somente se métricas dentro dos limites.
- **Blue-green:** implantar no ambiente passivo. Validar health checks. Fazer o switch. Manter o ambiente anterior ativo pelo período de observação definido antes de desligar.
- **Deploy direto:** executar apenas se o Arquiteto justificou explicitamente por que é seguro sem gradual.

- Registrar início no Jira.
- Confirmar cada etapa antes de avançar.
- Observar: erros, latência, tráfego, saturação e a métrica de negócio definida.
- Interromper **imediatamente** ao atingir o critério de abortagem — sem aguardar confirmação humana se o critério for objetivo.
- Executar rollback conforme o tipo definido pelo Arquiteto.
- Registrar resultado completo no Jira.

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