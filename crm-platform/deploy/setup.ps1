# NimbusCRM one-shot installer for Windows + Docker Desktop.
# Paste into PowerShell:
#   iwr -useb https://raw.githubusercontent.com/muntakim335/Analystakim.github.io/claude/crm-platform-build-ym8vua/crm-platform/deploy/setup.ps1 | iex
# Everything lands in %USERPROFILE%\NimbusCRM. Safe to re-run (keeps your data and secrets).

$ErrorActionPreference = 'Stop'
$Branch = 'claude/crm-platform-build-ym8vua'
$Repo   = 'muntakim335/Analystakim.github.io'
$Home2  = Join-Path $env:USERPROFILE 'NimbusCRM'

Write-Host "`n=== NimbusCRM setup ===" -ForegroundColor Cyan

# 1. Docker must be up
try { docker info *> $null } catch {
  Write-Host 'Docker Desktop is not running. Start it (whale icon = running), then re-run this script.' -ForegroundColor Red
  exit 1
}
Write-Host '[1/5] Docker is running'

# 2. Fetch the code (zip download — no git needed)
if (-not (Test-Path $Home2)) { New-Item -ItemType Directory -Path $Home2 | Out-Null }
$zip = Join-Path $env:TEMP 'nimbuscrm.zip'
Write-Host '[2/5] Downloading NimbusCRM…'
Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
$extract = Join-Path $env:TEMP 'nimbuscrm-extract'
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive $zip -DestinationPath $extract
$srcRoot = Get-ChildItem $extract | Select-Object -First 1
Copy-Item (Join-Path $srcRoot.FullName 'crm-platform\*') $Home2 -Recurse -Force
Remove-Item $zip, $extract -Recurse -Force
Write-Host "      Code is in $Home2"

# 3. Secrets (.env) — created once, then left alone
$envFile = Join-Path $Home2 'deploy\.env'
if (-not (Test-Path $envFile)) {
  Write-Host '[3/5] Generating secrets'
  $rand = { param($n) -join ((1..$n) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }) }
  @(
    "POSTGRES_PASSWORD=$(& $rand 48)"
    "JWT_SECRET=$(& $rand 64)"
    'PUBLIC_ORIGIN=*'
    'WEB_PORT=8080'
    'SMTP_FROM="NimbusCRM <no-reply@example.com>"'
    'MAX_UPLOAD_MB=10'
  ) | Set-Content $envFile -Encoding ascii
} else {
  Write-Host '[3/5] Keeping existing secrets (.env already present)'
}

# 4. Build & start
Write-Host '[4/5] Building and starting containers (first run takes a few minutes)…'
Push-Location (Join-Path $Home2 'deploy')
docker compose up -d --build
Pop-Location

# 5. Wait until healthy
Write-Host '[5/5] Waiting for the app to come up…'
$ok = $false
foreach ($i in 1..60) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -UseBasicParsing http://localhost:8080/readyz -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}

if ($ok) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback' } |
    Select-Object -First 1).IPAddress
  Write-Host "`n=== NimbusCRM is running ===" -ForegroundColor Green
  Write-Host "  On this PC:            http://localhost:8080"
  if ($ip) { Write-Host "  From other devices:    http://${ip}:8080  (same network)" }
  Write-Host "  First step:            open it and click 'Create your organization'"
  Write-Host "  Stop:                  cd $Home2\deploy; docker compose down"
  Write-Host "  Update:                re-run this script"
  Write-Host "  Backup:                cd $Home2\deploy; docker compose exec -T postgres pg_dump -U crm -d crm -Fc > crm-backup.dump"
  Start-Process http://localhost:8080
} else {
  Write-Host "`nSomething did not come up. Diagnose with:" -ForegroundColor Yellow
  Write-Host "  cd $Home2\deploy; docker compose ps; docker compose logs api"
}
