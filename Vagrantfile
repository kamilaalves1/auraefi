# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/jammy64"
  config.vm.box_version = ">= 20230101.0.0"

  config.vm.network "forwarded_port",
    guest: 3000,
    host: 3000,
    host_ip: "127.0.0.1"

  config.vm.network "forwarded_port",
    guest: 3306,
    host: 3306,
    host_ip: "127.0.0.1"

  config.vm.provider "virtualbox" do |vb|
    vb.name = "vertex-control-center"
    vb.memory = 2048
    vb.cpus = 2
    vb.customize ["modifyvm", :id, "--natdnshostresolver1", "on"]
  end

  config.vm.synced_folder ".", "/vagrant", type: "virtualbox"

  # Executado sempre que houver vagrant up ou vagrant reload.
  # Mantém node_modules e .next no disco Linux, pois o compartilhamento
  # do VirtualBox não suporta os recursos usados pelo npm e pelo Turbopack.
  config.vm.provision "shell", run: "always", inline: <<-SHELL
    set -e

    install -d -o vagrant -g vagrant /opt/aura/node_modules
    install -d -o vagrant -g vagrant /opt/aura/next
    install -d -o vagrant -g vagrant /vagrant/node_modules
    install -d -o vagrant -g vagrant /vagrant/.next

    mountpoint -q /vagrant/node_modules || \
      mount --bind /opt/aura/node_modules /vagrant/node_modules

    mountpoint -q /vagrant/.next || \
      mount --bind /opt/aura/next /vagrant/.next

    # Reinicia a aplicação após preparar as pastas.
    systemctl is-enabled aura.service >/dev/null 2>&1 && \
      systemctl restart aura.service || true

    # Inicia o MySQL caso ele já esteja instalado.
    systemctl is-active --quiet mysql || \
      systemctl start mysql 2>/dev/null || true
  SHELL

  # Provisionamento inicial da VM.
  config.vm.provision "shell", inline: <<-SHELL
    set -e

    echo "=========================================="
    echo "AURA - Vertex Control Center Setup"
    echo "=========================================="

    export DEBIAN_FRONTEND=noninteractive

    echo "Atualizando pacotes..."
    apt-get update -qq

    echo "Instalando dependências do sistema..."
    apt-get install -y -qq \
      curl \
      xz-utils \
      ca-certificates \
      mysql-server-8.0

    # Instala o Node 22 pelo site oficial.
    # Isso evita o erro de certificado do deb.nodesource.com.
    NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)"

    if [ "$NODE_MAJOR" -lt 22 ] || ! command -v npm >/dev/null 2>&1; then
      echo "Instalando Node.js 22..."

      cd /tmp

      NODE_ARCHIVE="$(
        curl -fsSL \
          https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt |
        awk '/linux-x64.tar.xz$/ {print $2}'
      )"

      curl -fsSLO \
        "https://nodejs.org/dist/latest-v22.x/$NODE_ARCHIVE"

      curl -fsSL \
        https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt |
        grep "  $NODE_ARCHIVE$" |
        sha256sum -c -

      tar -xJf "$NODE_ARCHIVE" \
        -C /usr/local \
        --strip-components=1

      rm -f "$NODE_ARCHIVE"
    fi

    echo "Node: $(node -v)"
    echo "npm: $(npm -v)"

    echo "Configurando MySQL..."

    systemctl enable --now mysql

    mysql -u root \
      -e "CREATE DATABASE IF NOT EXISTS aura;"

    mysql -u root \
      -e "CREATE USER IF NOT EXISTS 'aura'@'localhost' IDENTIFIED BY 'aura123';"

    mysql -u root \
      -e "GRANT ALL PRIVILEGES ON aura.* TO 'aura'@'localhost';"

    mysql -u root \
      -e "FLUSH PRIVILEGES;"

    # O Next.js prioriza o arquivo .env.local.
    # As configurações só serão incluídas se ainda não existirem.
    touch /vagrant/.env.local
    chown vagrant:vagrant /vagrant/.env.local

    ensure_env() {
      KEY="$1"
      VALUE="$2"

      grep -q "^${KEY}=" /vagrant/.env.local || \
        echo "${KEY}=${VALUE}" >> /vagrant/.env.local
    }

    ensure_env AUTH_USER admin
    ensure_env AUTH_PASS admin

    ensure_env MYSQL_HOST localhost
    ensure_env MYSQL_PORT 3306
    ensure_env MYSQL_USER aura
    ensure_env MYSQL_PASSWORD aura123
    ensure_env MYSQL_DATABASE aura

    ensure_env NODE_ENV development
    ensure_env NEXT_PUBLIC_GATEWAY_OPTIONAL true
    ensure_env MC_ALLOW_ANY_HOST true
    ensure_env MC_DISABLE_RATE_LIMIT 1
    ensure_env MC_COOKIE_SECURE false

    ensure_env MC_ALLOWED_HOSTS \
      "localhost,127.0.0.1,localhost:3000,127.0.0.1:3000"

    echo "Instalando dependências da aplicação..."

    chown -R vagrant:vagrant /opt/aura

    sudo -u vagrant -H bash -lc \
      'cd /vagrant && npm ci || npm install'

    # Serviço que inicia a aplicação automaticamente.
    cat > /etc/systemd/system/aura.service <<'EOF'
[Unit]
Description=AURA Vertex Control Center
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=vagrant
Group=vagrant
WorkingDirectory=/vagrant
Environment=NODE_ENV=development
ExecStart=/usr/local/bin/node /vagrant/node_modules/next/dist/bin/next dev --hostname 0.0.0.0 --port 3000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now aura.service

    echo ""
    echo "=========================================="
    echo "Setup concluído!"
    echo "=========================================="
    echo ""
    echo "Aplicação: http://localhost:3000"
    echo "Login inicial: admin"
    echo "Senha inicial: admin"
    echo ""
  SHELL
end