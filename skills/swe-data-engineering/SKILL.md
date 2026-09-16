---
name: swe-data-engineering
description: Projeta e implementa mudanças de dados, schemas, eventos, migrações, backfills e controles de qualidade. Use sempre que dados forem criados, alterados ou transportados.
---

# Executar mudança de dados

## Missão

Preservar integridade, compatibilidade, auditabilidade e capacidade de recuperação.

## Comunicação externa obrigatória

Toda dependência de acesso, autorização de migração, decisão de retenção, indisponibilidade de fonte ou risco de dados deve ser comentada no Jira.

Não executar produção enquanto a ação humana solicitada não estiver registrada.

## Processo

1. Mapear lineage.
2. Classificar sensibilidade.
3. Definir ownership.
4. Definir schema.
5. Identificar produtores e consumidores.
6. Definir compatibilidade.
7. Tratar duplicidade e ordenação.
8. Planejar migration.
9. Planejar backfill.
10. Definir checkpoint.
11. Definir abortagem.
12. Definir rollback.
13. Testar falha parcial.
14. Instrumentar qualidade.

## Qualidade

Avaliar:

- completude;
- validade;
- unicidade;
- consistência;
- atualidade;
- reconciliação.

## Gate

- `DATA: APPROVED`
- `DATA: BLOCKED`
- `DATA: NOT_APPLICABLE` — usar quando o card não envolve criação, alteração, migração ou transporte de dados. Registrar o motivo e passar o card adiante.

## Saída obrigatória

- Lineage.
- Classificação.
- Schema.
- Compatibilidade.
- Produtores.
- Consumidores.
- Qualidade.
- Migration.
- Backfill.
- Replay.
- Segurança.
- Observabilidade.
- Evidências.
- Comentários no Jira.
- Veredito.

## Antipadrões

- Migration destrutiva silenciosa.
- Backfill sem checkpoint.
- Consumidor desconhecido.
- Dados sensíveis em logs.
- Correção manual sem auditoria.
- Backup sem restore testado.