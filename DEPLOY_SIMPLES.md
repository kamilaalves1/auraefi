# 🚀 Deploy Simples - AURA

Sem SSH key, sem complicações. Apenas **docker-compose**.

---

## Como Funciona

1. **GitLab faz build** da imagem Docker automaticamente
2. **Você faz pull** manualmente no servidor
3. **docker-compose up** inicia a aplicação

---

## Passo 1: Preparar o Servidor

SSH no seu servidor de produção:

```bash
# Instalar Docker (se não tiver)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Instalar docker-compose
sudo apt install docker-compose

# Criar diretório
sudo mkdir -p /opt/aura
cd /opt/aura

# Fazer login no registry GitLab
docker login registry.gitlab.interno.testegerencianet.com.br
# Username: seu-usuario-gitlab
# Password: gerar em GitLab Settings → Access Tokens → Create
```

---

## Passo 2: Criar docker-compose.yml

No servidor `/opt/aura`, crie:

```bash
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
      - MYSQL_PASSWORD=aura123
      - MYSQL_DATABASE=aura
      - AUTH_USER=admin
      - AUTH_PASS=admin
    depends_on:
      - mysql
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=root123
      - MYSQL_DATABASE=aura
      - MYSQL_USER=aura
      - MYSQL_PASSWORD=aura123
    volumes:
      - mysql-data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql-data:
EOF
```

---

## Passo 3: Subir a Aplicação

```bash
# No servidor, no diretório /opt/aura
docker-compose up -d

# Ver se tá rodando
docker-compose ps

# Ver logs
docker-compose logs -f aura
```

---

## Passo 4: Fazer Atualizações

Cada vez que quiser fazer deploy de uma nova versão:

```bash
# No servidor /opt/aura
docker-compose pull
docker-compose up -d
```

---

## Acessar a Aplicação

```
http://seu-servidor:3000
```

Login: **admin / admin**

---

## GitLab Pipeline

Cada vez que você faz push para `master`:

1. GitLab **automaticamente faz build** da imagem
2. Imagem é enviada para o registry
3. Você executa no servidor:
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

Pronto!

---

## Trocas de Senhas

No `docker-compose.yml`, mude:

```yaml
MYSQL_PASSWORD=aura123          # Altere aqui
MYSQL_ROOT_PASSWORD=root123     # E aqui
AUTH_PASS=admin                 # E aqui
```

---

## Parar/Iniciar

```bash
# Parar
docker-compose down

# Iniciar
docker-compose up -d

# Logs
docker-compose logs -f

# Deletar tudo (dados também)
docker-compose down -v
```

---

## Resumo

✅ GitLab constrói imagem automaticamente  
✅ Você faz pull da imagem no servidor  
✅ docker-compose up -d inicia tudo  
✅ Simples, sem SSH key, sem complicações!

**Pronto para usar!** 🎉
