# 🚀 Guia de Deploy - AURA

## O que foi criado

✅ `.gitlab-ci.yml` - Pipeline de CI/CD para GitLab que:
1. **Faz build** da imagem Docker automaticamente
2. **Faz push** para o registry GitLab
3. **Faz deploy** quando aprovado (manual trigger)

---

## Setup Necessário

### 1️⃣ Configurar Variáveis no GitLab

No repositório do GitLab, vá para:
**Settings → CI/CD → Variables**

Adicione estas variáveis (escolha uma opção de deploy):

#### Opção A: Deploy via SSH (Recomendado)

```
DEPLOY_HOST = seu-servidor.com ou IP
DEPLOY_USER = usuario_ssh
DEPLOY_PATH = /home/usuario/aura
SSH_PRIVATE_KEY = conteudo-da-chave-privada-ssh
```

#### Opção B: Deploy com Kubernetes

```
KUBE_URL = https://seu-kubernetes:6443
KUBE_TOKEN = seu-token-k8s
KUBE_CA_CERT = seu-certificado-ca
```

### 2️⃣ Configurar Servidor de Deploy (SSH)

No seu servidor de produção:

```bash
# Criar diretório
mkdir -p /home/usuario/aura
cd /home/usuario/aura

# Criar docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.9'

services:
  aura:
    image: registry.gitlab.interno.testegerencianet.com.br/desenvolvimento/aura:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MYSQL_HOST=mysql
      - MYSQL_PORT=3306
      - MYSQL_USER=aura
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=aura
      - AUTH_USER=${AUTH_USER:-admin}
      - AUTH_PASS=${AUTH_PASS:-admin}
    depends_on:
      - mysql
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
      - MYSQL_DATABASE=aura
      - MYSQL_USER=aura
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql-data:
EOF

# Criar arquivo .env
cat > .env << 'EOF'
MYSQL_ROOT_PASSWORD=your_root_password
MYSQL_PASSWORD=your_aura_password
AUTH_USER=admin
AUTH_PASS=your_secure_password
EOF

# Configurar permissões
chmod 600 .env
```

### 3️⃣ Autenticação no Registry

No servidor, fazer login no registry GitLab:

```bash
docker login registry.gitlab.interno.testegerencianet.com.br
# Digite seu username e personal access token
```

---

## Como Fazer Deploy

### Primeira Vez: Build Manual

```bash
# No seu computador local
cd /caminho/do/projeto

# Build da imagem
docker build -t registry.gitlab.interno.testegerencianet.com.br/desenvolvimento/aura:latest .

# Push para registry
docker login registry.gitlab.interno.testegerencianet.com.br
docker push registry.gitlab.interno.testegerencianet.com.br/desenvolvimento/aura:latest
```

### Próximas Vezes: Automático via GitLab

1. **Fazer merge para master** ✅ (já feito)
2. **Ir para GitLab**
   - Acesse: https://gitlab.interno.testegerencianet.com.br/desenvolvimento/aura
   - Vá para **Pipelines**
   - Clique no pipeline da master
   - Clique em **Deploy** (manual trigger)

### Monitorar o Deploy

```bash
# No servidor de produção
docker-compose logs -f aura

# Ver containers rodando
docker-compose ps

# Parar/iniciar
docker-compose stop
docker-compose up -d
```

---

## Verificar se Funcionou

Depois do deploy, acesse:

```
http://seu-servidor:3000
# ou
https://aura.seu-dominio.com
```

Login: admin / admin

---

## Estrutura do Deploy

```
Seu Repositório (master branch)
        ↓
GitLab CI/CD Pipeline
        ↓
Docker Build & Push
        ↓
Registry GitLab
        ↓
Servidor SSH / Kubernetes
        ↓
🚀 Aplicação em Produção
```

---

## Troubleshooting

### "DEPLOY_HOST not defined"
- Faltam variáveis no GitLab Settings → CI/CD → Variables

### "Docker login failed"
- Verificar credenciais do registry
- Usar personal access token ao invés de senha

### "Connection refused"
- Verificar se servidor SSH está acessível
- Verificar SSH key configurada

### "Image pull failed"
- Verificar se imagem foi feita push corretamente
- Executar `docker pull` manualmente no servidor

---

## Próximas Atualizações

Cada vez que você:
1. Fizer commit em `master`
2. Fazer push para GitLab
3. Clicar "Deploy" no pipeline

A aplicação será atualizada automaticamente! 🎉

---

**Pronto para deploy!** Você tem apenas que configurar as variáveis no GitLab.
