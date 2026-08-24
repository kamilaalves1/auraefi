---
name: swe-quality-gates
description: Valida comportamento contra critérios e riscos, incluindo happy path, bordas, erros, permissões, regressão e acessibilidade.
---

# Validar entrega

## Missão

Produzir evidências independentes de que a mudança atende ao card e não rompe comportamento crítico.

## Pré-condições

Exigir:

- critérios;
- regras;
- MR ou versão;
- ambiente;
- configuração;
- massa;
- riscos;
- evidências do Developer.

## Comunicação externa obrigatória

Se ambiente, massa, versão, requisito ou acesso estiver indisponível:

- comentar no Jira;
- informar a tentativa;
- identificar responsável;
- explicar impacto;
- marcar `QA: BLOCKED`.

Todo defeito também deve ser registrado ou vinculado no Jira.

## Processo

1. Mapear critério para teste.
2. Priorizar por risco.
3. Confirmar versão.
4. Confirmar ambiente.
5. Preparar massa.
6. Executar happy path.
7. Executar bordas.
8. Executar erros.
9. Executar permissões.
10. Executar regressão.
11. Verificar contratos.
12. Verificar acessibilidade.
13. Registrar evidências.
14. Retestar correções.

## Defeitos

Registrar:

- ambiente;
- versão;
- pré-condição;
- passos;
- esperado;
- obtido;
- frequência;
- evidência;
- severidade;
- impacto.

## Gate

- `VERDICT: APPROVED`
- `VERDICT: CHANGES_REQUESTED`
- `QA: BLOCKED`

## Antipadrões

- Testar apenas happy path.
- “Funcionou aqui”.
- Aprovar sem versão.
- Screenshot sem passos.
- Ausência de teste como aprovação.
- Quantidade de casos como sinônimo de qualidade.