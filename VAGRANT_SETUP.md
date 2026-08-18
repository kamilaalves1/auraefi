# 🎟️ Vagrant Setup Guide

## Pré-requisitos

1. **VirtualBox** instalado (compatível com Vagrant)
   - Download: https://www.virtualbox.org/wiki/Downloads
   - Versão recomendada: 7.0+

2. **Vagrant** instalado
   - Download: https://www.vagrantup.com/downloads
   - Versão recomendada: 2.4+

3. **Verificar instalação**
```powershell
# PowerShell
vagrant --version
vboxmanage --version
```

## Quick Start

### 1. Clonar/Navegar até o projeto

```powershell
cd "C:\Users\kamila.alves\OneDrive - Efí S.A\Documentos\vertex-control-center"
```

### 2. Iniciar Vagrant

```powershell
# Primeira vez (vai baixar a box e provisionar)
vagrant up

# Isso vai:
# - Baixar Ubuntu 22.04 LTS (~500 MB)
# - Instalar Node.js 22
# - Instalar MySQL 8.0
# - Instalar dependências do projeto
# - Criar arquivo .env.development
# Tempo estimado: 5-10 minutos
```

### 3. Conectar à máquina virtual

```powershell
vagrant ssh
```

Você verá:
```
vagrant@vertex-control-center:~$
```

### 4. Iniciar a aplicação

```bash
cd /vagrant
npm run dev
```

Você verá:
```
▲ Next.js 16.3.1 (Turbopack)
- Local:         http://127.0.0.1:3000
- Ready in 2.2s
```

### 5. Acessar a aplicação

Abra no navegador: **http://localhost:3000**

## Credenciais Padrão

- **Usuário**: admin
- **Senha**: admin

## Banco de Dados (MySQL)

Dentro do Vagrant:
```bash
# Conectar ao MySQL
mysql -u aura -paura123 -h localhost

# Ver dados
USE aura;
SHOW TABLES;
```

Do seu Windows (host):
```powershell
# Instale MySQL CLI se quiser usar do host
mysql -u aura -paura123 -h 127.0.0.1 -P 3306
```

## Comandos Vagrant Úteis

```powershell
# Ver status
vagrant status

# Parar a máquina
vagrant halt

# Reiniciar
vagrant reload

# Destruir (remove tudo)
vagrant destroy

# Ver logs de provisioning
vagrant provision

# SSH com shell customizado
vagrant ssh -c "cd /vagrant && npm run dev"

# Pasta compartilhada
# Windows: C:\Users\kamila.alves\OneDrive - Efí S.A\Documentos\vertex-control-center
# Vagrant: /vagrant (automático)
```

## Desenvolvimento

### Editar código do Windows

1. Edite os arquivos normalmente no Windows
2. Os arquivos são sincronizados automaticamente para `/vagrant` no Vagrant
3. A aplicação recarrega automaticamente (HMR)

### Exemplo

```powershell
# No Windows
# Abra C:\Users\kamila.alves\OneDrive - Efí S.A\Documentos\vertex-control-center\src\app\layout.tsx
# Faça alterações
# Salve

# A mudança aparece em tempo real em http://localhost:3000
```

## Troubleshooting

### Vagrant não inicia

**Erro: "The box 'ubuntu/jammy64' could not be found"**
```powershell
# Baixar a box manualmente
vagrant box add ubuntu/jammy64

# Ou usar outra box
# Edite o Vagrantfile: config.vm.box = "ubuntu/focal64"
```

**Erro: "VirtualBox Guest Additions Version Mismatch"**
```powershell
# Instalar plugin
vagrant plugin install vagrant-vbguest

# Provisionar novamente
vagrant provision
```

### Porta 3000 já em uso

```powershell
# Mudar porta no Vagrantfile (linha com "guest: 3000")
# De:
#   config.vm.network "forwarded_port", guest: 3000, host: 3000
# Para:
#   config.vm.network "forwarded_port", guest: 3000, host: 3001

# Depois:
vagrant reload
```

### MySQL não inicia

```bash
# Dentro do Vagrant
vagrant ssh

# Reiniciar MySQL
sudo systemctl restart mysql

# Ver status
sudo systemctl status mysql

# Ver logs
sudo tail -f /var/log/mysql/error.log
```

### Folder sync não funciona

```powershell
# Reinstalar Guest Additions
vagrant plugin install vagrant-vbguest
vagrant reload
```

## Performance

Se a máquina ficar lenta:

1. **Aumentar recursos** (Vagrantfile):
```ruby
config.vm.provider "virtualbox" do |vb|
  vb.memory = 4096  # ao invés de 2048
  vb.cpus = 4       # ao invés de 2
end
```

2. **Reiniciar**:
```powershell
vagrant reload
```

## Logs e Debugging

```bash
# Dentro do Vagrant
# Ver logs da aplicação
cd /vagrant
npm run dev

# Ver logs do MySQL
sudo tail -f /var/log/mysql/error.log

# Ver logs do sistema
journalctl -xe
```

## Parar e Limpar

```powershell
# Parar sem destruir
vagrant halt

# Destruir VM (mas mantém o Vagrantfile e código)
vagrant destroy

# Destruir e limpar box
vagrant destroy
vagrant box remove ubuntu/jammy64
```

## Próximas Vezes

```powershell
# Depois que criou uma vez, próximas vezes é mais rápido
vagrant up    # Inicia (rápido)
vagrant ssh   # Conecta
cd /vagrant
npm run dev
```

---

## Stack Instalado

- **SO**: Ubuntu 22.04 LTS (Jammy)
- **Node.js**: 22.x (LTS)
- **npm**: 10.x
- **MySQL**: 8.0
- **Projeto**: Next.js 16.3.1 com Turbopack

## Recursos da VM

- **RAM**: 2 GB (editável no Vagrantfile)
- **CPUs**: 2 (editável no Vagrantfile)
- **Disco**: ~20 GB (expansível)

---

**Pronto!** A aplicação AURA está configurada para rodar com Vagrant! 🚀
