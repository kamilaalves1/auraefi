# 🐳 Docker Setup Guide

## Status Atual

✅ Docker foi instalado na máquina  
❌ Docker não está acessível no PATH (sessão terminal atual)

## Próximos Passos

### 1. Reiniciar o Terminal

**Opção A: PowerShell (Recomendado)**
```powershell
# Abra uma NOVA janela PowerShell (não use a atual)
# Pode ser como administrador também
```

**Opção B: Command Prompt**
```cmd
# Ou abra Command Prompt e execute
docker --version
```

### 2. Iniciar Docker Desktop (se no Windows)

1. Pressione `Win + S`
2. Digite "Docker Desktop"
3. Clique em "Docker Desktop" para iniciar
4. Aguarde o ícone do Docker aparecer na bandeja

### 3. Validar Instalação

```powershell
# Em uma nova janela PowerShell, execute:
docker --version
docker compose --version
```

Você deve ver algo como:
```
Docker version 27.0.0, build xxxxx
Docker Compose version v2.27.0
```

### 4. Iniciar a Stack Completa

```powershell
cd "C:\Users\kamila.alves\OneDrive - Efí S.A\Documentos\vertex-control-center"

# Opção A: Usar o script (recomendado)
.\start-docker.ps1

# Opção B: Comando direto
docker compose -f docker-compose.dev.yml up -d
```

### 5. Verificar Status

```powershell
# Ver containers rodando
docker compose -f docker-compose.dev.yml ps

# Ver logs
docker compose -f docker-compose.dev.yml logs -f

# Parar containers
docker compose -f docker-compose.dev.yml down
```

## O que vai ser criado

### Containers
- **vertex-control-center** — Aplicação Next.js (porta 3000)
- **vertex-mysql** — Banco de dados MySQL 8.0 (porta 3306)

### Volumes
- **mysql-data** — Dados persistentes do MySQL
- **vcc-data** — Dados da aplicação

### Acesso

- **Aplicação**: http://localhost:3000
- **MySQL**: localhost:3306
  - User: `aura`
  - Password: `aura123`
  - Database: `aura`

## Troubleshooting

### Docker não encontrado
- Reinicie o terminal (nova janela PowerShell)
- Verifique se Docker Desktop está rodando
- Tente executar `docker ps` para confirmar

### Porta 3000 já em uso
```powershell
# Verifique qual processo está usando
netstat -ano | findstr :3000

# Ou altere a porta no docker-compose.dev.yml
# Mude: ports: - "3000:3000" para "3001:3000"
```

### Erro de conexão com MySQL
- Aguarde alguns segundos (MySQL leva tempo para iniciar)
- Verifique os logs: `docker compose logs mysql`
- Reinicie os containers: `docker compose down && docker compose up -d`

## Comandos Úteis

```powershell
# Ver status dos containers
docker ps

# Ver todos os containers (incluindo parados)
docker ps -a

# Ver logs da aplicação
docker compose -f docker-compose.dev.yml logs app

# Ver logs do MySQL
docker compose -f docker-compose.dev.yml logs mysql

# Acessar shell do container
docker exec -it vertex-control-center sh

# Acessar MySQL
docker exec -it vertex-mysql mysql -u aura -p aura123

# Remover tudo (containers + volumes)
docker compose -f docker-compose.dev.yml down -v
```

---

Após completar os passos acima, a aplicação AURA estará completamente funcional com:
- ✅ Next.js rodando
- ✅ MySQL configurado
- ✅ Todas as atualizações de governança e layout
