# Script para iniciar Docker Compose

Write-Host "🐳 Iniciando Docker Compose..." -ForegroundColor Cyan

# Tenta encontrar Docker
$dockerPaths = @(
    "docker",
    "docker.exe",
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    "C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe"
)

$dockerCmd = $null
foreach ($path in $dockerPaths) {
    try {
        $result = & $path --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerCmd = $path
            Write-Host "✓ Docker encontrado: $path" -ForegroundColor Green
            break
        }
    } catch {
        # Continue
    }
}

if (-not $dockerCmd) {
    Write-Host "✗ Docker não encontrado no PATH" -ForegroundColor Red
    Write-Host "Por favor:"
    Write-Host "  1. Abra uma nova janela PowerShell (como Administrador)"
    Write-Host "  2. Certifique-se que Docker Desktop está rodando"
    Write-Host "  3. Tente novamente"
    exit 1
}

# Verificar se Docker está rodando
Write-Host "Verificando status do Docker..." -ForegroundColor Cyan
try {
    & $dockerCmd ps > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Docker não está rodando" -ForegroundColor Red
        Write-Host "  Inicie o Docker Desktop e tente novamente"
        exit 1
    }
    Write-Host "✓ Docker está rodando" -ForegroundColor Green
} catch {
    Write-Host "✗ Erro ao verificar Docker: $_" -ForegroundColor Red
    exit 1
}

# Rodar docker compose
Write-Host "`nIniciando docker compose up -d..." -ForegroundColor Cyan
Set-Location "C:\Users\kamila.alves\OneDrive - Efí S.A\Documentos\vertex-control-center"

Write-Host "Parando containers anteriores..." -ForegroundColor Cyan
& docker compose -f docker-compose.dev.yml down 2>&1 | Out-Null

Write-Host "Iniciando containers..." -ForegroundColor Cyan
& docker compose -f docker-compose.dev.yml up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ Docker Compose iniciado com sucesso!" -ForegroundColor Green
    Write-Host "`nAplicação rodando em:" -ForegroundColor Cyan
    Write-Host "  http://localhost:3000" -ForegroundColor Yellow
    Write-Host "`nPara ver os logs:"
    Write-Host "  docker compose logs -f" -ForegroundColor Gray
    Write-Host "`nPara parar:"
    Write-Host "  docker compose down" -ForegroundColor Gray
} else {
    Write-Host "`n✗ Erro ao iniciar docker compose" -ForegroundColor Red
    exit 1
}
