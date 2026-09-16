---
inclusion: auto
name: product-context
description: Contexto de produto e domínios de negócio para agentes de Business Analysis e Product Management
---

# Contexto de Produto e Domínios de Negócio

Este arquivo fornece contexto de negócio para os agentes de Analista de Negócios e Product Manager.
Mantenha este arquivo atualizado conforme o produto evolui.

## Produto: AURA

AURA é uma plataforma de orquestração de agentes de IA para squads de desenvolvimento de software.
Permite configurar pipelines de entrega onde agentes de IA executam etapas do ciclo de vida do desenvolvimento
(análise, arquitetura, implementação, revisão, QA, release) de forma autônoma, integrada ao Jira e repositórios Git.

### Capacidades principais
- Integração com Jira e Azure DevOps para detecção e processamento de cards
- Pipeline configurável com colunas e agentes por etapa
- Commit automático de código nos repositórios configurados
- Abertura de Pull Requests / Merge Requests
- Skills especializadas por papel (BA, Arquiteto, Dev, QA, Security, etc.)
- Second Brain para conhecimento persistente por domínio de negócio

---

## Domínios de Negócio

### Cartões (Domínio: `cartoes`)

Produtos: Cartão de Crédito GN Card, cartões pré-pagos e outros instrumentos de pagamento.

**Conceitos-chave:**
- **Fatura**: consolidação mensal dos lançamentos do cartão
- **Limite**: valor máximo disponível para compras
- **Lançamento**: transação individual (compra, pagamento, estorno)
- **Parcelamento**: divisão de uma compra em múltiplas parcelas
- **Ciclo de fatura**: período entre fechamentos (geralmente mensal)
- **Data de vencimento**: prazo para pagamento da fatura
- **Bandeira**: rede de pagamento (Visa, Mastercard, etc.)
- **Modalidade**: crédito rotativo, parcelado, avista

**Regras de negócio relevantes:**
- Lançamentos após o fechamento entram na próxima fatura
- Pagamento mínimo evita juros sobre o valor pago, mas aplica juros rotativos no restante
- Contestação de lançamento inicia processo de chargeback
- Bloqueio temporário suspende novas transações mas mantém o cartão ativo

**Integrações:**
- Processadora de cartões (autorizações e liquidações)
- Sistema de cobrança (fatura e boleto)
- Core bancário (liquidação financeira)
- Antifraude

---

## Como usar este contexto

**Analista de Negócios:** Ao analisar um card, verifique se o domínio está mapeado aqui.
Use os conceitos e regras para preencher lacunas de requisitos antes de perguntar ao humano.

**Product Manager:** Use as métricas e objetivos para avaliar se o card tem outcome claro e mensurável.

**Para adicionar um novo domínio:** Inclua uma seção seguindo o padrão acima com:
- Nome e código do domínio
- Conceitos-chave
- Regras de negócio relevantes
- Integrações

---

## Second Brain

Os agentes de BA e PM também consultam o Second Brain — uma base de conhecimento semântica
hospedada separadamente. O Second Brain acumula aprendizados de cards processados anteriormente
e pode ser consultado para domínios de negócio específicos.

Quando disponível (`SECOND_BRAIN_URL` configurado), o contexto do Second Brain é injetado
automaticamente no prompt do agente antes da execução.
