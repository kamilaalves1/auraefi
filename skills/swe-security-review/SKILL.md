---
name: swe-security-review
description: Revisa autenticação, autorização, dados, entradas, secrets, integrações, dependências e abuso. Use em mudanças com APIs, privilégios ou dados sensíveis.
---

# Revisar segurança

## Missão

Identificar caminhos plausíveis de abuso antes da entrega, sem testes destrutivos.

## Comunicação externa obrigatória

Todo achado, bloqueio, acesso ausente, risco residual ou necessidade de aceite humano deve ser publicado no Jira.

Achado alto ou crítico deve bloquear o card.

## Processo

1. Confirmar escopo.
2. Identificar ativos.
3. Identificar atores.
4. Mapear fronteiras.
5. Revisar autenticação.
6. Revisar autorização.
7. Revisar validação.
8. Revisar injeção e SSRF.
9. Revisar secrets.
10. Revisar dados.
11. Revisar dependências.
12. Revisar rate limit.
13. Revisar logs.
14. Modelar abuso.

## Achados

Registrar:

- severidade;
- arquivo/local;
- cenário;
- pré-condição;
- impacto;
- evidência;
- correção;
- teste de confirmação.

## Gate

- `SECURITY: APPROVED`
- `SECURITY: BLOCKED`

Risco alto ou crítico exige correção ou aceite humano formal no Jira.

## Saída obrigatória

- Escopo.
- Ativos.
- Fronteiras.
- Ameaças.
- Controles.
- Achados.
- Scans.
- Limitações.
- Risco residual.
- Comentários no Jira.
- Veredito.

## Antipadrões

- Scanner como única revisão.
- Explorar produção.
- Expor dados.
- Severidade sem impacto.
- Aprovar sem ler o diff.
- Adiar segurança sem aceite.