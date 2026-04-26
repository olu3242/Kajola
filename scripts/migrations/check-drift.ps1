param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [string]$DbPassword = $env:SUPABASE_DB_PASSWORD
)

$ErrorActionPreference = "Stop"

if (!$DbPassword) {
  throw "SUPABASE_DB_PASSWORD is required."
}

$env:SUPABASE_DB_PASSWORD = $DbPassword
$diff = supabase db diff --project-ref $ProjectRef 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
  throw "supabase db diff failed: $diff"
}

$normalized = $diff.Trim()
if ($normalized -and $normalized -notmatch 'No schema changes found') {
  Write-Error "Schema drift detected for $ProjectRef:`n$diff"
  exit 2
}

Write-Host "Schema drift check clean for $ProjectRef."
