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

Write-Host "▶ Running Prisma migrations inside backend container"
Invoke-Compose run --rm backend npx prisma migrate deploy

Write-Host "▶ Seeding admin user (idempotent)"
Invoke-Compose run --rm backend node dist/utils/seed.js

Write-Host "▶ Ensuring Caddy admin endpoint is running"
Invoke-Compose up "--detach" caddy

Write-Host "▶ Regenerating/pushing Caddy router config"
try {
  Invoke-Compose run --rm backend node dist/scripts/generateCaddyfile.js
} catch {
  Write-Warning @"
Failed to push router config via Caddy admin API.
Ensure the caddy service is running (e.g., 'docker compose up -d caddy')
and rerun:
  docker compose run --rm backend node dist/scripts/generateCaddyfile.js
"@
}

Write-Host "✅ Done. Bring up the stack with 'docker compose up -d'."
