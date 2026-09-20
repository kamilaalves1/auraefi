---
name: swe-security-review
description: Revisa autenticação, autorização, dados, entradas, secrets, integrações, dependências e abuso. Use em mudanças com APIs, privilégios ou dados sensíveis.
---

# Revisar segurança

## Missão

Identificar caminhos plausíveis de abuso antes da entrega, sem testes destrutivos.

Não aprovar por ausência de evidências. Aprovar somente quando houver evidência positiva de que os controles estão presentes e corretos.

## Comunicação externa obrigatória

Todo achado, bloqueio, acesso ausente, risco residual ou necessidade de aceite humano deve ser publicado no Jira.

O comentário deve conter:
- achado ou bloqueio identificado;
- severidade;
- evidência encontrada no código ou na configuração;
- impacto se explorado;
- ação necessária;
- responsável esperado.

Achado alto ou crítico bloqueia o card. Não avançar sem correção ou aceite humano formal registrado no Jira.

## Limiares de severidade

| Severidade | Critério | Ação obrigatória |
|---|---|---|
| **Crítico** | Execução remota de código, bypass de autenticação, exposição de dados de todos os usuários, injeção direta em produção | Bloquear imediatamente. Não avançar sem correção e validação. |
| **Alto** | Escalada de privilégio, exposição de dados sensíveis de um usuário, SSRF com acesso interno, secret em código | Bloquear. Exige correção ou aceite humano formal no Jira antes de avançar. |
| **Médio** | Rate limit ausente em endpoint sensível, log com dado sensível, validação incompleta de entrada, dependência com CVE ativo | Registrar como bloqueante ou importante. Decidir com o Arquiteto se bloqueia ou segue com condição. |
| **Baixo** | Header de segurança ausente, mensagem de erro com stack trace, configuração subótima sem impacto imediato | Registrar como sugestão. Não bloqueia. |
| **Informativo** | Boa prática não seguida sem risco imediato | Registrar como sugestão opcional. |

## Processo

### Passo 1 — Confirmar escopo e verificar NOT_APPLICABLE

Se o card não envolve nenhum dos itens abaixo, emitir `SECURITY: NOT_APPLICABLE`:
- criação ou alteração de endpoint HTTP/gRPC/GraphQL;
- autenticação ou autorização;
- dados sensíveis (PII, financeiro, credencial, token);
- dependências externas novas ou atualizadas;
- acesso a sistemas externos ou internos;
- operações destrutivas ou privilegiadas.

Registrar o motivo e passar adiante.

### Passo 2 — Identificar ativos e atores

- Quais dados são lidos, criados, alterados ou excluídos?
- Quem pode chamar o endpoint ou executar a operação? (usuário autenticado, anônimo, serviço interno, admin)
- Quais sistemas externos ou internos são acionados?
- Quais privilégios são necessários?

### Passo 3 — Mapear fronteiras e superfície de ataque

- Onde a requisição entra no sistema?
- Quais são os pontos de validação?
- Onde dados externos chegam e são processados?
- Onde dados sensíveis são persistidos, transmitidos ou logados?

### Passo 4 — Threat modeling (STRIDE)

Para cada componente relevante, aplicar as 6 categorias:

| Categoria | Pergunta | Exemplo de achado |
|---|---|---|
| **S**poofing | Um ator pode se passar por outro? | JWT sem validação de issuer, cookie sem HttpOnly |
| **T**ampering | Um ator pode modificar dados em trânsito ou em repouso? | HMAC ausente, migration sem controle de integridade |
| **R**epudiation | Uma ação pode ser negada sem rastreamento? | Operação destrutiva sem log de auditoria |
| **I**nformation Disclosure | Dados sensíveis podem vazar? | Stack trace em resposta, dado no log, campo não mascarado |
| **D**enial of Service | O endpoint pode ser sobrecarregado? | Loop sem limite, consulta sem paginação, rate limit ausente |
| **E**levation of Privilege | Um ator pode obter mais permissões do que deveria? | Verificação de autorização ausente, IDOR |

Documentar cada ameaça identificada com: categoria STRIDE, localização no código, cenário de exploração, pré-condição, impacto e severidade.

### Passo 5 — Revisão técnica detalhada

**Autenticação:**
- Token/sessão validado corretamente?
- Expiração implementada?
- Renovação segura?
- Logout invalida a sessão no servidor?

**Autorização:**
- Verificação acontece no servidor, não apenas no cliente?
- IDOR possível? (acesso a recursos de outros usuários por ID)
- Privilege escalation possível via parâmetro ou header?
- Autorização aplicada em todos os métodos HTTP do recurso?

**Validação de entrada:**
- Toda entrada externa é validada antes de usar?
- SQL: queries parametrizadas ou ORM? Nunca concatenação de string.
- NoSQL: operadores de query sanitizados?
- HTML: saída escapada para prevenir XSS?
- Path traversal: caminhos de arquivo validados contra base permitida?
- SSRF: URLs externas validadas contra allowlist?

**Secrets e configuração:**
- Credenciais, tokens, chaves em variável de ambiente, não em código?
- `.env` no `.gitignore`?
- Secrets não aparecem em logs, respostas de API ou stack traces?
- Rotação de secrets implementada ou documentada?

**Dados sensíveis:**
- PII, financeiro ou credencial em campo de banco? Criptografado ou mascarado?
- Transmissão: TLS obrigatório?
- Logs: dados sensíveis excluídos ou truncados?
- Resposta da API: campos sensíveis omitidos quando não necessários?

**Dependências:**
- Pacotes novos introduzidos? Verificar CVEs conhecidos (npm audit, pip check, trivy, snyk).
- Versão fixada ou com range seguro?
- Origem confiável?

**Rate limit e abuso:**
- Endpoints de autenticação têm rate limit?
- Endpoints de criação têm proteção contra abuso?
- Bulk operations têm limite de tamanho?

### Passo 6 — Registrar achados

Para cada achado identificado, registrar no formato:

```text
[SECURITY FINDING]

Severidade: <Crítico | Alto | Médio | Baixo | Informativo>
Categoria STRIDE: <S | T | R | I | D | E>
Local: <arquivo, linha, endpoint ou componente>
Cenário: <como um atacante exploraria>
Pré-condição: <o que precisa ser verdade para exploração>
Impacto: <o que acontece se explorado>
Evidência: <trecho de código ou configuração>
Correção necessária: <o que deve ser alterado>
Teste de confirmação: <como verificar que foi corrigido>
```

## Gate

- `SECURITY: APPROVED` — revisão concluída, sem achados críticos ou altos pendentes.
- `SECURITY: BLOCKED` — achado crítico ou alto identificado sem correção ou aceite humano. Não avançar.
- `SECURITY: NOT_APPLICABLE` — card não envolve superfície de ataque relevante. Registrar motivo.

Risco alto ou crítico exige correção verificada ou aceite humano formal registrado no Jira antes de `SECURITY: APPROVED`.

## Saída obrigatória

- Escopo analisado e superfície de ataque identificada.
- Ativos e atores mapeados.
- Fronteiras do sistema.
- Ameaças STRIDE avaliadas (com resultado por categoria).
- Lista de achados no formato estruturado (ou "nenhum identificado").
- Dependências verificadas.
- Limitações desta revisão (o que não foi possível verificar e por quê).
- Risco residual aceito (se houver).
- Comentários publicados no Jira para cada achado alto/crítico.
- Veredito com gate.

## Antipadrões

- Scanner como única revisão — ferramentas automatizadas complementam, não substituem análise.
- Aprovar por ausência de prova de exploração.
- Aprovar sem ler o diff.
- "Será corrigido depois" sem registro formal no Jira.
- Severidade sem impacto concreto.
- Expor ou reproduzir dados sensíveis reais durante a revisão.
- Adiar segurança sem aceite humano explícito.
- Executar teste destrutivo em produção.
