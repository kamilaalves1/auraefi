# Vagrant Helper - Usa caminho completo
param([string]$Cmd = "help")

$vagrant = "C:\Program Files\Vagrant\bin\vagrant.exe"

if (-not (Test-Path $vagrant)) {
    Write-Host "Vagrant nao encontrado!" -ForegroundColor Red
    exit 1
}

Set-Location (Split-Path $MyInvocation.MyCommand.Path)

switch ($Cmd.ToLower()) {
    "up" {
        Write-Host "Iniciando VM..." -ForegroundColor Cyan
        & $vagrant up
    }
    "dev" {
        Write-Host "Iniciando aplicacao..." -ForegroundColor Cyan
        & $vagrant ssh -c "cd /vagrant && npm run dev"
    }
    "ssh" {
        & $vagrant ssh
    }
    "stop" {
        Write-Host "Parando..." -ForegroundColor Yellow
        & $vagrant halt
    }
    "status" {
        & $vagrant status
    }
    "destroy" {
        & $vagrant destroy -f
    }
    default {
        Write-Host @"

Vagrant Helper - AURA

Comandos:
  .\vagrant-run.ps1 up      - Iniciar VM
  .\vagrant-run.ps1 dev     - Conectar e rodar npm run dev
  .\vagrant-run.ps1 ssh     - Conectar SSH
  .\vagrant-run.ps1 status  - Ver status
  .\vagrant-run.ps1 stop    - Parar
  .\vagrant-run.ps1 destroy - Deletar

"@ -ForegroundColor Cyan
    }
}
