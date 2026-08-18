# 🚀 Guia de Deploy - AURA

## O que foi criado

✅ `.gitlab-ci.yml` - Pipeline de CI/CD para GitLab que:
1. **Faz build** da imagem Docker automaticamente
2. **Faz push** para o registry GitLab
3. **Faz deploy** via SSH quando aprovado (manual trigger)

---

## Setup Necessário

### 1️⃣ Configurar Variáveis no GitLab

No repositório do GitLab, vá para:
**Settings → CI/CD → Variables**

Adicione estas variáveis:

```
DEPLOY_HOST = seu-servidor.com (ou IP do servidor)
DEPLOY_USER = usuario_que_tem_docker
DEPLOY_PATH = /caminho/onde/roda/aura
SSH_PRIVATE_KEY = conteudo-da-sua-chave-privada-ssh
```

**Exemplo:**
```
DEPLOY_HOST = 192.168.1.100
DEPLOY_USER = devops
DEPLOY_PATH = /opt/aura
SSH_PRIVATE_KEY = -----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
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

No servidor de deploy, fazer login no registry GitLab:

```bash
docker login registry.gitlab.interno.testegerencianet.com.br
# Digite seu username do GitLab
# Senha: use um Personal Access Token (Settings → Access Tokens)
```

---

## Como Fazer Deploy

### Primeira Vez: Preparar o Servidor

```bash
# No servidor de produção
cd /opt
mkdir -p aura
cd aura

# Fazer login no registry
docker login registry.gitlab.interno.testegerencianet.com.br

# Testar acesso
docker pull registry.gitlab.interno.testegerencianet.com.br/desenvolvimento/aura:latest
```

### Deploy via GitLab (Automático)

1. **Fazer merge para master** ✅ (já feito)
2. **Ir para GitLab**
   - Acesse: https://gitlab.interno.testegerencianet.com.br/desenvolvimento/aura
   - Vá para **Pipelines** → Pipeline da master
   - Veja o job **build** completar
   - Clique no botão **Deploy** (manual trigger)
3. **Pronto!** SSH executará no servidor:
   ```bash
   cd /opt/aura
   docker-compose pull
   docker-compose up -d
   ```

### Monitorar o Deploy

```bash
# No servidor de produção
docker-compose logs -f aura

# Ver containers rodando
docker-compose ps

# Parar/iniciar
docker-compose stop
docker-compose up -d

# Atualizar imagem
docker-compose pull
docker-compose up -d
```

---

## Verificar se Funcionou

Depois do deploy, acesse:

```
http://seu-servidor:3000
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
SSH Deploy (seu servidor)
        ↓
docker-compose up -d
        ↓
🚀 Aplicação em Produção
```

---

## Troubleshooting

### "DEPLOY_HOST not defined"
- ❌ Faltam variáveis no GitLab Settings → CI/CD → Variables
- ✅ Adicione: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH, SSH_PRIVATE_KEY

### "Permission denied (publickey)"
- ❌ SSH key não está configurada corretamente
- ✅ Certifique-se que a chave privada está em SSH_PRIVATE_KEY

### "Connection refused"
- ❌ Servidor não está acessível
- ✅ Verificar IP/hostname do servidor
- ✅ Verificar se SSH porta 22 está aberta

### "Image pull failed"
- ❌ Docker registry login falhou
- ✅ Executar no servidor: `docker login registry.gitlab.interno.testegerencianet.com.br`
- ✅ Usar personal access token como senha

### "docker-compose: command not found"
- ❌ Docker Compose não instalado no servidor
- ✅ Instalar: `sudo apt install docker-compose`

---

## Próximas Atualizações

Cada vez que você:
1. Fizer commit em `master`
2. Fazer push para GitLab
3. Clicar "Deploy" no pipeline

A aplicação será atualizada automaticamente! 🎉

---

**Passo a passo:**

1. ✅ Configurar variáveis no GitLab
2. ✅ Preparar servidor (Docker + docker-compose)
3. ✅ Fazer login no registry
4. ✅ Clicar Deploy no GitLab Pipelines
5. 🚀 Aplicação rodando!
