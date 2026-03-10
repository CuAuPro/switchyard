param(
  [string]$ComposeFile = "docker-compose.yml",
  [string]$ComposeExecutable = "",
  [string[]]$ComposePrefixArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ComposeExecutable) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    $ComposeExecutable = "docker"
    $ComposePrefixArgs = @("compose")
  } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $ComposeExecutable = "docker-compose"
    $ComposePrefixArgs = @()
  } else {
    throw "Neither 'docker' nor 'docker-compose' was found on PATH."
  }
}

function Invoke-Compose {
  param (
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )

  $argList = @()
  if (Test-Path $ComposeFile) {
    $argList += @("-f", $ComposeFile)
  }
  $argList += $Args
  $fullArgs = @($ComposePrefixArgs + $argList)
  Write-Host ">> $ComposeExecutable $($fullArgs -join ' ')"
  & $ComposeExecutable $fullArgs
}

Write-Host "▶ Preparing local bind-mount paths"
New-Item -ItemType Directory -Force -Path "backend","caddy/config","caddy/data" | Out-Null
if (Test-Path "backend/switchyard.db" -PathType Container) {
  throw "backend/switchyard.db is a directory. Remove it and rerun."
}
if (-not (Test-Path "backend/switchyard.db")) {
  New-Item -ItemType File -Path "backend/switchyard.db" | Out-Null
}

Write-Host "▶ Running Prisma migrations inside backend container"
Invoke-Compose run --rm --use-aliases --entrypoint /bin/sh backend -lc "if [ -x ./node_modules/.bin/prisma ]; then ./node_modules/.bin/prisma migrate deploy; else exit 42; fi"
$migrateExitCode = $LASTEXITCODE
if ($migrateExitCode -eq 42) {
  throw "Prisma CLI not found in backend image. Rebuild/pull backend image with prisma included."
} elseif ($migrateExitCode -ne 0) {
  throw "Migration command failed with exit code $migrateExitCode."
}

Write-Host "▶ Seeding admin user (idempotent)"
Invoke-Compose run --rm --use-aliases --entrypoint node backend dist/utils/seed.js

Write-Host "▶ Ensuring Caddy admin endpoint is running"
Invoke-Compose up "--detach" caddy

Write-Host "▶ Regenerating/pushing Caddy router config"
try {
  Invoke-Compose run --rm --use-aliases --entrypoint node backend dist/scripts/generateCaddyfile.js
} catch {
  Write-Warning @"
Failed to push router config via Caddy admin API.
Ensure the caddy service is running (e.g., 'docker compose up -d caddy')
and rerun:
  docker compose run --rm --use-aliases --entrypoint node backend dist/scripts/generateCaddyfile.js
"@
}

Write-Host "✅ Done. Bring up the stack with 'docker compose up -d'."
