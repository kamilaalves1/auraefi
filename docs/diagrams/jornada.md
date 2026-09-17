# Jornada da Demanda — AURA

> Perspectiva do usuário e do negócio: o que acontece, quem participa e qual valor é entregue em cada etapa.

```mermaid
sequenceDiagram
    autonumber

    actor PO as Product Owner
    actor Dev as Developer Humano
    participant Jira
    participant AURA
    participant Agentes as Agentes de IA
    participant Repo as Repositório Git
    participant CI as Pipeline de CI

    Note over PO, CI: ── FASE 1: ENTRADA DA DEMANDA ──────────────────────────────────────────

    PO->>Jira: Cria card "AURA-42: Implementar endpoint de contestação"
    PO->>Jira: Move card para coluna "Em análise" (trigger do pipeline)

    Note over AURA: AURA detecta o card em até 10 segundos

    AURA-->>PO: 🚀 Comentário no card: "Etapa iniciada — Agente Ana em execução"

    Note over PO, CI: ── FASE 2: ANÁLISE DE NEGÓCIO ──────────────────────────────────────────

    AURA->>Agentes: Chama Agente BA (Ana)
    Agentes-->>Agentes: Consulta Second Brain: existe regra de contestação?
    Agentes-->>Jira: 🤖 Posta análise completa no card:<br/>regras, exceções, critérios de aceite

    alt Falta informação
        Agentes-->>Jira: ⏸️ ANALYSIS: BLOCKED — pergunta ao PO
        PO->>Jira: Responde a dúvida no comentário
        Agentes-->>Jira: ✅ ANALYSIS: READY — continua
    else Tudo claro
        Agentes-->>Jira: ✅ ANALYSIS: READY
    end

    Note over PO, CI: ── FASE 3: DECISÃO TÉCNICA ────────────────────────────────────────────

    AURA->>Agentes: Chama Agente Arquiteto (Bruno)
    Agentes-->>Repo: Lê código real do repositório (estrutura, padrões, banco)
    Agentes-->>Jira: 🤖 Posta decisão arquitetural:<br/>endpoints, eventos, rollout, rollback

    AURA-->>Jira: 📊 Story Points estimados: 5 pontos (confiança Média)

    Note over PO, CI: ── FASE 4: IMPLEMENTAÇÃO ──────────────────────────────────────────────

    AURA->>Agentes: Chama Agente Developer (Carlos)
    Agentes-->>Repo: Lê código + design-system.md + arquivos de tokens
    Agentes-->>Jira: Gera código, commita, abre Merge Request
    AURA-->>Jira: ✅ Comentário: "Código commitado → branch feature/AURA-42"
    AURA-->>Jira: ✅ Comentário: "Testes passaram (14.2s)"
    AURA-->>Jira: 🔗 Comentário: "MR aberto → gitlab.com/.../merge_requests/88"

    Note over PO, CI: ── FASE 5: VALIDAÇÃO DE QUALIDADE ────────────────────────────────────

    AURA->>Agentes: Chama Agente QA (Dani)
    Agentes-->>Jira: Valida cada critério de aceite com evidência

    alt QA reprova
        Agentes-->>Jira: 🔄 VERDICT: CHANGES_REQUESTED — feedback detalhado
        AURA->>Agentes: Retorna ao Developer com o feedback
        Agentes-->>Repo: Corrige e commita novamente
        Agentes-->>Jira: ✅ VERDICT: APPROVED — na segunda rodada
    else QA aprova
        Agentes-->>Jira: ✅ VERDICT: APPROVED
    end

    Note over PO, CI: ── FASE 6: REVISÃO DE SEGURANÇA ──────────────────────────────────────

    AURA->>Agentes: Chama Agente Security Auditor (Elena)
    Agentes-->>Jira: Revisa autenticação, autorização, dados sensíveis
    Agentes-->>Jira: ✅ SECURITY: APPROVED

    Note over PO, CI: ── FASE 7: CI E CODE REVIEW HUMANO ──────────────────────────────────

    Repo->>CI: Pipeline CI dispara automaticamente
    CI-->>AURA: CI passou ✅

    Dev->>Repo: Faz code review humano no MR

    alt Revisor solicita mudanças
        Dev->>Repo: Comenta CHANGES_REQUESTED no MR
        AURA-->>Jira: 🚫 PR rejeitado — fechado. Card pausado para decisão humana
        Dev->>Jira: Comenta "reprocessar com foco em X"
        AURA->>Agentes: Retorna ao Developer com o feedback
    else Revisor aprova
        Dev->>Repo: Aprova o MR (LGTM)
        AURA-->>Jira: ✅ PR aprovado — avançando para próxima etapa
    end

    Note over PO, CI: ── FASE 8: CONCLUSÃO ──────────────────────────────────────────────────

    AURA->>Jira: Move card para coluna "Pronto para deploy"
    AURA-->>Jira: ✅ Esteira concluída — todos os estágios processados
    AURA-->>AURA: Grava aprendizado no Second Brain para cards futuros

    PO-->>Jira: Vê o card completo com toda a rastreabilidade
    Dev-->>Repo: Faz o merge do MR no momento adequado
```

---

## Resumo da jornada

| Fase | Responsável | O que é entregue |
|---|---|---|
| 1 — Entrada | Product Owner | Card com descrição e critérios |
| 2 — Análise | Agente BA + (PO se bloqueado) | Regras, fluxos, critérios verificáveis |
| 3 — Arquitetura | Agente Arquiteto | Decisão técnica + estimativa de story points |
| 4 — Implementação | Agente Developer | Código commitado + testes passando + PR aberto |
| 5 — Qualidade | Agente QA | Validação contra todos os critérios de aceite |
| 6 — Segurança | Agente Security | Revisão de vulnerabilidades |
| 7 — Review | CI + Developer Humano | Aprovação técnica final |
| 8 — Conclusão | AURA | Card movido, conhecimento gravado no Second Brain |
