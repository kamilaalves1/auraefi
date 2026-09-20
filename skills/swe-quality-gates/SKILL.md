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

## Execução de testes automatizados

Antes de emitir qualquer veredito, o QA Engineer **deve instruir o orquestrador a executar os testes automatizados do repositório**.

O comando correto deve ser descoberto em:

- `package.json` (scripts: `test`, `test:ci`, `vitest`, `jest`);
- `Makefile`;
- pipeline CI (`.gitlab-ci.yml`, `.github/workflows/`);
- documentação local (`README`, `AGENTS.md`).

Nunca inventar o comando. Nunca assumir que os testes passam sem executá-los.

Após receber o resultado da execução:

- Se todos os testes passarem: registrar como evidência e prosseguir.
- Se houver falha: registrar o output completo no Jira, identificar se a falha foi causada pela mudança do card ou era preexistente, e marcar `QA: BLOCKED` com o log.
- Não commitar nem avançar o card enquanto houver falha de teste causada pela mudança.

## Processo

1. Mapear critério para teste.
2. Priorizar por risco.
3. Confirmar versão.
4. Confirmar ambiente.
5. Preparar massa.
6. **Instruir execução dos testes automatizados do repositório e aguardar resultado.**
7. Executar happy path.
8. Executar bordas.
9. Executar erros.
10. Executar permissões.
11. Executar regressão.
12. Verificar contratos.
13. Verificar acessibilidade.
14. Registrar evidências (incluindo output dos testes automatizados).
15. Retestar correções.

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
- `QA: NOT_APPLICABLE` — usar quando o card não gerou artefato testável (análise pura, documentação, spike sem código entregue). Registrar o motivo e passar o card adiante sem bloquear.

## Rastreabilidade obrigatória

Ao finalizar a validação, registrar no Jira:

- skill ativada: `swe-quality-gates`;
- critérios verificados;
- testes executados e resultado (com comando exato);
- decisão tomada e justificativa;
- evidências vinculadas.

Esse registro é obrigatório para auditoria e para alimentar o Second Brain.

## Antipadrões

- Testar apenas happy path.
- “Funcionou aqui”.
- Aprovar sem versão.
- Screenshot sem passos.
- Ausência de teste como aprovação.
- Quantidade de casos como sinônimo de qualidade.