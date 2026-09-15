# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  # Box base
  config.vm.box = "ubuntu/jammy64"
  config.vm.box_version = ">= 20230101.0.0"

  # Configurações de rede
  config.vm.network "forwarded_port", guest: 3000, host: 3000, host_ip: "127.0.0.1"
  config.vm.network "forwarded_port", guest: 3306, host: 3306, host_ip: "127.0.0.1"

  # Configurações de máquina virtual
  config.vm.provider "virtualbox" do |vb|
    vb.name = "vertex-control-center"
    vb.memory = 2048
    vb.cpus = 2
    vb.customize ["modifyvm", :id, "--natdnshostresolver1", "on"]
  end

  # Sincronização de diretórios
  config.vm.synced_folder ".", "/vagrant", type: "virtualbox"

  # Provisioning - instalar e configurar tudo
  config.vm.provision "shell", inline: <<-SHELL
    set -e

    echo "=========================================="
    echo "🚀 AURA - Vertex Control Center Setup"
    echo "=========================================="

    # Atualizar sistema
    echo "📦 Atualizando sistema..."
    apt-get update -qq
    apt-get upgrade -y -qq

    # Instalar Node.js
    echo "📦 Instalando Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs

    # Instalar MySQL
    echo "📦 Instalando MySQL 8.0..."
    apt-get install -y -qq mysql-server-8.0

    # Configurar MySQL
    echo "⚙️  Configurando MySQL..."
    mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';" || true
    mysql -u root -proot -e "CREATE DATABASE IF NOT EXISTS aura;" 2>/dev/null || \
    mysql -u root -e "CREATE DATABASE IF NOT EXISTS aura;"
    mysql -u root -e "CREATE USER IF NOT EXISTS 'aura'@'localhost' IDENTIFIED BY 'aura123';" 2>/dev/null || true
    mysql -u root -e "GRANT ALL PRIVILEGES ON aura.* TO 'aura'@'localhost';" 2>/dev/null || \
    mysql -u root -proot -e "GRANT ALL PRIVILEGES ON aura.* TO 'aura'@'localhost';"
    mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || \
    mysql -u root -proot -e "FLUSH PRIVILEGES;"

    # Reiniciar MySQL
    systemctl restart mysql

    echo "✓ MySQL configurado"

    # Instalar npm packages
    echo "📦 Instalando dependências da aplicação..."
    cd /vagrant
    npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null

    echo "✓ Dependências instaladas"

    # Criar arquivo .env.development se não existir
    if [ ! -f /vagrant/.env.development ]; then
      echo "⚙️  Criando .env.development..."
      cat > /vagrant/.env.development << 'EOF'
# Autenticação
AUTH_USER=admin
AUTH_PASS=admin

# Database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=aura
MYSQL_PASSWORD=aura123
MYSQL_DATABASE=aura

# Desenvolvimento
NODE_ENV=development
NEXT_PUBLIC_GATEWAY_OPTIONAL=true
MC_ALLOW_ANY_HOST=true
MC_DISABLE_RATE_LIMIT=1
MC_COOKIE_SECURE=false

# Hosts
MC_ALLOWED_HOSTS=localhost,127.0.0.1,localhost:3000,127.0.0.1:3000
EOF
      echo "✓ .env.development criado"
    fi

    echo ""
    echo "=========================================="
    echo "✅ Setup completo!"
    echo "=========================================="
    echo ""
    echo "Para iniciar a aplicação, execute:"
    echo "  vagrant ssh"
    echo "  cd /vagrant"
    echo "  npm run dev"
    echo ""
    echo "Acesse: http://localhost:3000"
    echo ""
    echo "MySQL:"
    echo "  Host: localhost:3306"
    echo "  User: aura"
    echo "  Password: aura123"
    echo "  Database: aura"
    echo ""
  SHELL

  # Provision script para iniciar a aplicação
  config.vm.provision "shell", run: "always", inline: <<-SHELL
    # Iniciar MySQL se não estiver rodando
    systemctl is-active --quiet mysql || systemctl start mysql
  SHELL
end
