param(
  [Parameter(Mandatory = $true)]
  [string]$Registry,
  [string]$ImageTag = "latest",
  [string[]]$Targets = @("backend", "frontend", "sample-app")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$validTargets = @{
  "backend"     = @{ context = "backend";     image = "switchyard-backend" }
  "frontend"    = @{ context = "frontend";    image = "switchyard-frontend" }
  "sample-app"  = @{ context = "sample-app";  image = "switchyard-sample" }
}

foreach ($target in $Targets) {
  if (-not $validTargets.ContainsKey($target)) {
    throw "Unknown target '$target'. Valid options: backend, frontend, sample-app"
  }
}

foreach ($target in $Targets) {
  $context = $validTargets[$target].context
  $imageName = $validTargets[$target].image
  $fullTag = "${Registry}/${imageName}:${ImageTag}"

  Write-Host "`n>>> Building $fullTag ($context)"
  docker build -t $fullTag $context

  Write-Host "`n>>> Pushing $fullTag"
  docker push $fullTag
}

Write-Host "`n✅ Published images: $($Targets -join ', ') (tag=$ImageTag)"
