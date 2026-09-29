---
name: swe-visual-spec
description: Produz uma especificação visual estruturada a partir de wireframes, screenshots ou referências Figma anexadas ao card. Use quando o card envolver criação ou alteração de telas, componentes ou fluxos visuais. A saída é o contrato de implementação para o Developer.
---

# Produzir especificação visual

## Missão

Transformar referências visuais (wireframes, screenshots, protótipos) em uma especificação estruturada e verificável que o Developer pode implementar sem ambiguidade.

Uma referência visual é uma entrada. A Visual Spec é o contrato de implementação.

## Quando ativar

Este protocolo se aplica quando o card contiver:
- Screenshots ou wireframes anexados
- Referências a frames do Figma na descrição
- Criação de nova tela ou componente
- Alteração significativa de layout, navegação ou interação

Se o card não envolver conteúdo visual ou for puramente técnico (API, banco, infra), emita `VISUAL_SPEC: NOT_APPLICABLE` imediatamente.

## Pré-requisito

Antes de iniciar, leia o protocolo completo de raciocínio visual:

#[[file:skills/swe-visual-spec/references/visual-reasoning.md]]

E use o template de spec como estrutura de saída:

#[[file:skills/swe-visual-spec/references/spec-template.md]]

## Processo

### Passo 1 — Determinar profundidade

Escolha o nível mínimo que satisfaz a fidelidade exigida:

- **Level 0:** mudança só de texto/copy — sem análise visual
- **Level 1:** ajuste em componente existente — inspecionar componente e tokens locais
- **Level 2:** novo layout ou componente — reconciliação com design system + estados + responsividade
- **Level 3:** reconstrução a partir de screenshot ou Figma — extração estruturada completa
- **Level 4:** múltiplos form factors / cross-platform — comportamento responsivo e nativo específico

### Passo 2 — Extrair evidências

Para cada referência visual disponível no contexto (`## 🖼️ Contexto visual`), extrair em três buckets:

```json
{
  "observed": "o que é visível e verificável na referência",
  "inferred": "decisão de design inferida com base em evidência + confiança",
  "unknown": "comportamento que a referência não mostra"
}
```

Nunca apresentar comportamento inferido (hover, mobile, animação) como fato observado.

### Passo 3 — Mapear ao design system existente

Inspecionar tokens, variáveis CSS, configuração Tailwind, componentes existentes e padrões de composição do repositório. Reutilizar o que existe antes de criar algo novo.

Ordem de prioridade:
1. Requisito explícito do usuário
2. Design system existente no projeto
3. Intenção visual da referência
4. Boas práticas de acessibilidade e plataforma

### Passo 4 — Especificar comportamento além do frame estático

Definir para cada tela ou componente:
- Transformações desktop/tablet/mobile
- Estados: loading, empty, error, disabled, active, selected, hover, focus-visible
- Navegação por teclado e gerenciamento de foco
- Touch targets mínimos (44×44px mobile)
- Labels semânticos, roles ARIA, contraste, reduced motion
- Comportamento de modais/drawers: focus trap e restauração

### Passo 5 — Produzir a especificação

Usar a estrutura do `spec-template.md`. A seção **Visual Specification** deve conter para cada componente:

```
### Componente: <NomeDoComponente>

**Fonte:** project-design-system | visual-reference | accessibility-best-practice

**Layout:**
- [descrição precisa de grid, alinhamento, proporções]

**Estados:**
| Estado | O que o usuário vê | Classe/token |
|--------|-------------------|--------------|
| Default | ... | ... |
| Loading | ... | ... |
| Empty | ... | ... |
| Error | ... | ... |

**Acessibilidade:**
- role, aria-label, contraste mínimo

**Critérios verificáveis:**
- Dado [contexto], quando [ação], então [resultado observável]
```

## Comunicação externa obrigatória

Se houver decisão visual que não pode ser inferida com confiança da referência (comportamento mobile não mostrado, estado de erro não definido, componente não mapeado ao design system), registrar em `unknown` e publicar no Jira como dúvida para o designer ou PO.

Não inventar comportamento visual. Marcar como `unknown` e indicar que precisa de decisão.

## Gate

- `VISUAL_SPEC: APPROVED` — especificação visual completa, todos os estados definidos, critérios verificáveis produzidos, design system mapeado.
- `VISUAL_SPEC: BLOCKED` — referência visual insuficiente para especificar, dúvidas publicadas no Jira, aguardando complemento.
- `VISUAL_SPEC: NOT_APPLICABLE` — card não envolve conteúdo visual (backend, infra, dados puros). Emitir imediatamente sem análise.

## Saída obrigatória

- Profundidade escolhida e justificativa
- Três buckets por referência visual (observed / inferred / unknown)
- Mapeamento ao design system existente
- Spec completa por componente (layout, estados, acessibilidade)
- Critérios verificáveis no formato Dado/Quando/Então
- Dúvidas publicadas no Jira (se houver unknowns bloqueantes)
- Gate emitido

## Antipadrões

- Apresentar comportamento inferido como observado
- Criar componentes novos quando existentes atendem
- Especificar pixel coordinates em vez de tokens semânticos
- Omitir estados de erro, loading e empty
- Marcar como APPROVED com unknowns bloqueantes não resolvidos
- Importar design system externo quando o projeto já tem o seu
