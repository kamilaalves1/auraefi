# Script para facilitar setup com Vagrant

param(
    [ValidateSet("up", "ssh", "stop", "destroy", "logs", "status", "help")]
    [string]$Command = "help"
)

function Show-Help {
    Write-Host "
🎟️  Vertex Control Center - Vagrant Helper
========================================

Uso: .\vagrant-setup.ps1 [comando]

Comandos:
  up       - Criar e iniciar a VM (primeira vez)
  ssh      - Conectar via SSH e iniciar npm run dev
  stop     - Parar a VM
  destroy  - Deletar a VM completamente
  status   - Ver status da VM
  logs     - Ver logs da aplicação
  help     - Mostrar esta mensagem

Exemplos:
  .\vagrant-setup.ps1 up
  .\vagrant-setup.ps1 ssh
  .\vagrant-setup.ps1 stop

Acesso:
  Aplicação: http://localhost:3000
  Admin: admin / admin

" -ForegroundColor Cyan
}

function Check-Vagrant {
    try {
        $version = vagrant --version 2>&1
        Write-Host "✓ Vagrant: $version" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Vagrant não encontrado!" -ForegroundColor Red
        Write-Host "  Download em: https://www.vagrantup.com/downloads" -ForegroundColor Yellow
        return $false
    }
}

function Check-VirtualBox {
    try {
        $version = vboxmanage --version 2>&1
        Write-Host "✓ VirtualBox: $version" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ VirtualBox não encontrado!" -ForegroundColor Red
        Write-Host "  Download em: https://www.virtualbox.org/wiki/Downloads" -ForegroundColor Yellow
        return $false
    }
}

# Verificar pré-requisitos
function Test-Prerequisites {
    Write-Host "Verificando pré-requisitos..." -ForegroundColor Cyan
    Write-Host ""

    if (-not (Check-Vagrant)) {
        return $false
    }

    if (-not (Check-VirtualBox)) {
        return $false
    }

    Write-Host ""
    Write-Host "✓ Todos os pré-requisitos estão instalados!" -ForegroundColor Green
    return $true
}

# Comandos
function Invoke-VagrantUp {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "🚀 Iniciando Vagrant..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Prerequisites)) {
        Write-Host ""
        Write-Host "❌ Não foi possível continuar" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "⏳ Isso pode levar 5-10 minutos na primeira vez..." -ForegroundColor Yellow
    Write-Host ""

    vagrant up

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "✅ Vagrant iniciado com sucesso!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Para iniciar a aplicação:" -ForegroundColor Cyan
        Write-Host "  .\vagrant-setup.ps1 ssh" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Ou conecte manualmente:" -ForegroundColor Cyan
        Write-Host "  vagrant ssh" -ForegroundColor Yellow
        Write-Host "  cd /vagrant" -ForegroundColor Yellow
        Write-Host "  npm run dev" -ForegroundColor Yellow
        Write-Host ""
    }
}

function Invoke-VagrantSSH {
    Write-Host ""
    Write-Host "Conectando à VM..." -ForegroundColor Cyan
    Write-Host ""

    vagrant ssh -c "cd /vagrant && npm run dev"
}

function Invoke-VagrantStop {
    Write-Host ""
    Write-Host "Parando VM..." -ForegroundColor Yellow
    Write-Host ""

    vagrant halt

    Write-Host ""
    Write-Host "✓ VM parada" -ForegroundColor Green
    Write-Host "  Para reiniciar: .\vagrant-setup.ps1 up" -ForegroundColor Gray
    Write-Host ""
}

function Invoke-VagrantDestroy {
    Write-Host ""
    Write-Host "⚠️  Isso vai deletar a VM completamente!" -ForegroundColor Red
    $confirm = Read-Host "Tem certeza? (s/n)"

    if ($confirm -eq "s" -or $confirm -eq "sim") {
        Write-Host ""
        Write-Host "Destruindo VM..." -ForegroundColor Red
        vagrant destroy -f
        Write-Host ""
        Write-Host "✓ VM deletada" -ForegroundColor Green
        Write-Host "  Para criar novamente: .\vagrant-setup.ps1 up" -ForegroundColor Gray
        Write-Host ""
    } else {
        Write-Host "Cancelado" -ForegroundColor Yellow
    }
}

function Invoke-VagrantStatus {
    Write-Host ""
    Write-Host "Status da VM:" -ForegroundColor Cyan
    Write-Host ""

    vagrant status

    Write-Host ""
}

function Invoke-VagrantLogs {
    Write-Host ""
    Write-Host "Conectando para ver logs..." -ForegroundColor Cyan
    Write-Host "Para sair: Ctrl+C" -ForegroundColor Yellow
    Write-Host ""

    vagrant ssh -c "cd /vagrant && npm run dev"
}

# Executar comando
switch ($Command.ToLower()) {
    "up" { Invoke-VagrantUp }
    "ssh" { Invoke-VagrantSSH }
    "stop" { Invoke-VagrantStop }
    "destroy" { Invoke-VagrantDestroy }
    "status" { Invoke-VagrantStatus }
    "logs" { Invoke-VagrantLogs }
    default { Show-Help }
}
