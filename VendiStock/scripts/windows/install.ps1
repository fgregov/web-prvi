<#
.SYNOPSIS
  Instalacija VendiStocka na Windows 10/11 računalo koje služi kao server.
.DESCRIPTION
  1. Provjerava Node.js (22 LTS ili 24 LTS).
  2. Instalira ovisnosti (npm ci) i gradi aplikaciju.
  3. Instalira Chromium za Televend konektor u mapu VendiStock\browsers
     (dostupno i Windows servisu koji radi pod računom LocalSystem).
  4. Stvara .env iz .env.example ako ne postoji i ograničava prava na .env i data\.
  5. Nudi stvaranje administratorskog računa.
  Pokrenuti iz mape VendiStock u PowerShellu kao administrator:
    powershell -ExecutionPolicy Bypass -File .\scripts\windows\install.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $Root
Write-Host "VendiStock – instalacija u $Root" -ForegroundColor Cyan

# 1. Node.js
try { $nodeVersion = (node --version) } catch { throw 'Node.js nije instaliran. Instalirajte Node.js 22 LTS ili 24 LTS s https://nodejs.org (Windows Installer, x64).' }
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Potreban je Node.js 22 ili noviji (trenutno $nodeVersion)." }
Write-Host "Node.js $nodeVersion – u redu."

# 2. Ovisnosti i izgradnja
if (Test-Path 'package-lock.json') { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { throw 'npm install nije uspio.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Izgradnja aplikacije nije uspjela.' }

# 3. Preglednik za Televend konektor
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Root 'browsers'
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Instalacija Chromiuma nije uspjela (provjerite internetsku vezu).' }

# 4. Konfiguracija i prava
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Stvorena datoteka .env – prilagodite postavke (IP adresa, HTTPS, mape).' -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force -Path 'data' | Out-Null
# Pristup samo administratorima i sustavu (servis radi kao LocalSystem)
foreach ($p in @('.env', 'data')) {
  icacls $p /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
}
Write-Host 'Prava na .env i data\ ograničena na SYSTEM i Administratore.'

# 5. Administrator
$create = Read-Host 'Stvoriti administratorski račun sada? (d/n)'
if ($create -eq 'd') { npm run user:create -- --role admin }

Write-Host ''
Write-Host 'Instalacija završena.' -ForegroundColor Green
Write-Host 'Sljedeći koraci (vidi README.md):'
Write-Host '  1) HTTPS:      .\scripts\windows\New-VendiStockCertificate.ps1 -IpAddress 192.168.1.50'
Write-Host '  2) Vatrozid:   .\scripts\windows\Set-VendiStockFirewall.ps1 -Port 3000'
Write-Host '  3) Servis:     npm run service:install'
