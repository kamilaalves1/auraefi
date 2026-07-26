# Guia de Deploy

## Pré-requisitos

- **Node.js** >= 20 (LTS recomendado)
- **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`)

### Ubuntu / Debian

`better-sqlite3` requer ferramentas de compilação nativa:

```bash
sudo apt-get update
sudo apt-get install -y python3 make g++
```

### macOS

Xcode command line tools são necessárias:

```bash
xcode-select --install
```

## Desenvolvimento Local

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Abra http://localhost:3000. Login com `AUTH_USER` / `AUTH_PASS` definidos em `.env.local`.

## Produção (Direto)

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

O `pnpm start` sobe na porta `3005`. Para mudar:

```bash
PORT=3000 pnpm start
```

**Importante:** O build nativo do `better-sqlite3` é específico de plataforma. Execute `pnpm install` e `pnpm build` no mesmo SO e arquitetura do servidor de produção.

## Produção (Standalone)

Para deployments bare-metal com o servidor standalone do Next.js:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start:standalone
```

Para atualização in-place no host alvo:

```bash
BRANCH=main PORT=3000 pnpm deploy:standalone
```

O script `deploy:standalone`:
- Faz fetch e fast-forward da branch solicitada
- Reinstala dependências com o lockfile
- Reconstrói a partir de um `.next/` limpo
- Para o processo antigo na porta alvo
- Inicia o servidor standalone via `scripts/start-standalone.sh`

## Produção (Docker)

```bash
docker compose up
```

Ou build e run manualmente:

```bash
docker build -t vertex-control-center .
docker run -p 3000:3000 \
  -v vertex-data:/app/.data \
  -e AUTH_USER=admin \
  -e AUTH_PASS=senha-segura \
  -e API_KEY=sua-api-key \
  vertex-control-center
```

A imagem Docker:
- Build multi-stage a partir de `node:22-slim`
- Compila `better-sqlite3` nativamente dentro do container (Linux x64)
- Usa output standalone do Next.js para tamanho mínimo
- Roda como usuário não-root `nextjs`
- Expõe porta 3000 (sobrescreva com `-e PORT=8080`)

### Dados Persistentes

O banco SQLite fica em `/app/.data/` dentro do container. Monte um volume para persistir dados entre reinicializações:

```bash
docker run -v /caminho/para/dados:/app/.data ...
```

### Hardening em Produção

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

Adiciona: JSON logging, allowlist estrita de hostnames, cookies seguros, HSTS, rede interna isolada.

## Variáveis de Ambiente

Veja `.env.example` para a lista completa. Variáveis principais:

| Variável | Obrigatória | Padrão | Descrição |
|----------|-------------|--------|-----------|
| `AUTH_USER` | Sim | `admin` | Username do admin (criado na primeira execução) |
| `AUTH_PASS` | Sim | — | Senha do admin |
| `AUTH_PASS_B64` | Não | — | Senha em base64 (sobrescreve `AUTH_PASS`) |
| `AUTH_SECRET` | Sim | — | Secret para assinatura de JWT (mín. 32 chars) |
| `API_KEY` | Sim | — | API key para acesso headless |
| `PORT` | Não | `3005` | Porta do servidor |
| `MC_ALLOWED_HOSTS` | Não | `localhost,127.0.0.1` | Hosts permitidos em produção |
| `MC_ENABLE_HSTS` | Não | `0` | Habilitar HSTS (deploy HTTPS) |
| `MC_COOKIE_SECURE` | Não | `0` | Cookies seguros (deploy HTTPS) |
| `MC_TRUSTED_PROXIES` | Não | — | IPs de proxies confiáveis (CIDR) |

## Deploy AWS (ECS Fargate)

Para o deploy recomendado em produção, consulte a seção **Arquitetura AWS** no `README.md`.

Resumo da arquitetura:
- **ECS Fargate** rodando a imagem Docker (stateless)
- **EFS** montado em `/app/.data` para o banco SQLite
- **Secrets Manager** para todas as credenciais
- **ALB** com TLS via ACM
- **NAT Gateway** para saída HTTPS a sistemas externos (JIRA, GitHub, LLM)

## Troubleshooting

### "NODE_MODULE_VERSION mismatch"

`better-sqlite3` é compilado para uma versão específica do Node.js. Se trocar de versão:

```bash
pnpm rebuild better-sqlite3
```

### Módulo better-sqlite3 não encontrado

Falha na compilação nativa. No Ubuntu/Debian:

```bash
sudo apt-get install -y python3 make g++
rm -rf node_modules
pnpm install
```

### Erros de banco de dados travado

Garanta que apenas uma instância esteja rodando contra o mesmo diretório `.data/`. SQLite usa WAL mode mas não suporta múltiplos writers simultâneos.

### AUTH_PASS com "#" não funciona

Em arquivos dotenv, `#` inicia um comentário. Use:

```bash
AUTH_PASS="minha#senha"
# ou
AUTH_PASS_B64=$(echo -n 'minha#senha' | base64)
```

### Erros de plataforma ("Invalid ELF header" ou "Mach-O")

O binário nativo foi compilado em outra plataforma. Reconstrua:

```bash
rm -rf node_modules .next
pnpm install
pnpm build
```

## Próximos Passos

- **[Primeiros Passos](quickstart.md)** — Registre seu primeiro agente em 5 minutos
- **[Configuração de Agentes](agent-setup.md)** — SOUL, heartbeats, sincronização
- **[Padrões de Orquestração](orchestration.md)** — Workflows automáticos e multi-agente
