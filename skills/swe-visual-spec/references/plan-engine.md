# Plan Engine

`plan` is the architecture-aware specification engine. Its output is one authoritative
spec with **ordered implementation tasks**. There is no second verbose implementation-plan stage.

## Core principle

**Discover before deciding. Follow the existing architecture before inventing another one.**

In an established repository, architectural consistency outranks theoretical purity.
Prefer extension over invention, reuse over abstraction, and local consistency over generic preference.

## 1. Understand intent and scope

Capture the requested outcome, constraints, success criteria, and non-goals. Do not expand scope
to resolve uncertainty. Use YAGNI aggressively.

Classify only to choose depth:
- trivial/bounded: short spec or in-chat plan may be enough;
- architectural/cross-cutting: persisted spec is required;
- mixed: include every relevant domain in one spec, not multiple competing plans.

## 2. Repository and Architecture Discovery

Before proposing structure, inspect the existing project. Read explicit authority first:
AGENTS/CLAUDE/project instructions, ADRs, architecture docs, README, contributing rules,
workspace/configuration, and tests.

Then discover the **existing architecture** and **existing pattern** evidence:
- module and package boundaries;
- dependency direction;
- controllers/services/repositories or equivalent conventions;
- persistence and transaction patterns;
- validation and error handling;
- events/jobs/messaging;
- auth/security and configuration;
- logging/metrics/tracing;
- testing structure;
- frontend components, tokens, state management, routing, and design system.

Authority order:
1. explicit user requirement;
2. explicit project docs/ADRs;
3. project-wide established patterns;
4. local module patterns;
5. framework conventions;
6. industry best practices;
7. agent preference.

## 3. Activate only required reasoning domains

**Visual reasoning activation — decisão crítica:**

Ativar quando o card contiver qualquer um dos seguintes:
- Screenshots, wireframes ou protótipos anexados
- Referência a frames Figma na descrição
- Criação de nova tela ou componente de UI
- Alteração de layout, navegação ou fluxo visual
- Mudança em formulários, modais, tabelas ou listas

**Quando ativar visual reasoning:**
→ Incluir no spec a seção `## Visual Specification` com a flag:

```
VISUAL_SPEC_REQUIRED: true
Motivo: [descreva qual elemento visual precisa ser especificado]
```

Isso sinaliza para o agente UX que ele deve executar o protocolo de Visual Spec completo
antes do Developer implementar.

**Quando NÃO ativar:**
→ Card puramente backend, infra, dados, CI/CD, scripts → incluir no spec:

```
VISUAL_SPEC_REQUIRED: false
Motivo: card não envolve alteração de experiência do usuário
```

Isso sinaliza para o agente UX emitir `UX: NOT_APPLICABLE` imediatamente.

## 4. Resolve uncertainty

Investigate first, then ask only consequential questions that cannot be resolved
from project evidence or safe inference.

## 5. Produce the single authoritative Spec

Use the template in `spec-template.md`. The spec must contain:
- intent, goals/non-goals;
- relevant existing-system findings;
- decisions and constraints;
- architecture / data flow / interfaces;
- `VISUAL_SPEC_REQUIRED: true|false` with rationale;
- error/failure handling;
- security/privacy where relevant;
- testing strategy;
- acceptance criteria;
- ordered implementation tasks.

## 6. Recommend execution mode

Analyze task count, independence, dependencies, shared files, integration risk.

- **subagent-driven**: several independently implementable tasks with clear contracts
- **normal execution**: small work, tightly coupled tasks, or evolving understanding
