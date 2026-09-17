# Jornada da Demanda — AURA

> Perspectiva do negócio: o que acontece, quem participa e qual valor é entregue em cada fase.

## Como visualizar

**Online:** cole o conteúdo de `jornada.puml` em [https://www.plantuml.com/plantuml/uml/](https://www.plantuml.com/plantuml/uml/)

**VS Code:** instale a extensão [PlantUML](https://marketplace.visualstudio.com/items?itemName=jebbs.plantuml) e pressione `Alt+D` com o `.puml` aberto.

**Docker:**
```bash
docker run --rm -v $(pwd):/data plantuml/plantuml -tsvg /data/docs/diagrams/jornada.puml
```

---

## Resumo das fases e agentes

| # | Fase | Agente de IA | Quando é ativado | Gate de saída |
|---|---|---|---|---|
| 1 | Entrada da demanda | — | Sempre | Card criado |
| 2 | Orquestração | **01 · Coordinator (Aegis)** | Sempre — coordena toda a esteira | — |
| 3 | Clareza de produto | **02 · Product Manager** | Card sem outcome claro ou métrica de sucesso | `PRODUCT: READY` |
| 4 | Priorização | **03 · Product Owner (Backlog)** | Disputa de prioridade ou planejamento de sprint | `BACKLOG: PRIORITIZED` |
| 5 | Fluxo de entrega | **04 · Scrum Master (Flow)** | WIP alto, card parado ou risco de prazo | `FLOW: OK` |
| 6 | Discovery | **06 · Discovery** | Nova funcionalidade não validada com usuários | `DISCOVERY: READY` |
| 7 | Análise de negócio | **05 · Business Analyst** | Sempre — antes de qualquer decisão técnica | `ANALYSIS: READY` |
| 8 | Jornada do usuário | **07 · UX Designer** | Card que altera interface ou experiência | `UX: APPROVED` |
| 9 | Decisão técnica | **08 · Software Architect** | Sempre — define solução, rollout e rollback | `ARCHITECTURE: APPROVED` |
| 10 | Mudança de dados | **09 · Data Engineer** | Card com schema, migration ou pipeline de dados | `DATA: APPROVED` |
| 11 | Implementação | **10 · Developer** | Sempre — gera código, commita, abre PR | `IMPLEMENTATION: READY_FOR_REVIEW` |
| 12 | Revisão de segurança | **11 · Security Auditor** | Cards com API, permissões ou dados sensíveis | `SECURITY: APPROVED` |
| 13 | Validação de qualidade | **12 · QA Engineer** | Sempre — valida contra todos os critérios | `VERDICT: APPROVED` |
| 14 | Release / Deploy | **13 · DevOps / Release** | Após aprovação do revisor humano | `RELEASE: SUCCESS` |
| 15 | Conclusão | AURA | Sempre — grava no Second Brain | Card movido |

> **Nota:** nem todos os agentes são ativados em todos os cards. O Coordinator (Agente 01) decide quais agentes são necessários com base na natureza do card. Agentes com gate `NOT_APPLICABLE` são pulados automaticamente quando a skill não se aplica.

---

## Arquivo do diagrama

O diagrama completo com todos os agentes e cenários alternativos está em [`jornada.puml`](jornada.puml) (PlantUML).
