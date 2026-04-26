param(
  [Parameter(Mandatory = $true)][ValidateSet("staging","production")][string]$Environment,
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [string]$DbPassword = $env:SUPABASE_DB_PASSWORD,
  [string]$CommitSha = $env:GITHUB_SHA
)

$ErrorActionPreference = "Stop"

if (!$DbPassword) {
  throw "SUPABASE_DB_PASSWORD is required."
}

./scripts/migrations/validate.ps1

$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$backupRef = "$Environment-$ProjectRef-$timestamp"
New-Item -ItemType Directory -Force -Path "artifacts/migration-backups" | Out-Null
@{
  environment = $Environment
  project_ref = $ProjectRef
  backup_reference = $backupRef
  commit_sha = $CommitSha
  created_at = (Get-Date).ToUniversalTime().ToString("o")
  note = "Use Supabase point-in-time recovery/snapshot for this timestamp before rollback."
} | ConvertTo-Json | Set-Content -Path "artifacts/migration-backups/$backupRef.json"

$env:SUPABASE_DB_PASSWORD = $DbPassword
supabase migration list --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Unable to list migrations for $Environment." }

supabase db push --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) { throw "Migration deploy failed for $Environment." }

./scripts/migrations/check-drift.ps1 -ProjectRef $ProjectRef -DbPassword $DbPassword

$latest = Get-ChildItem supabase/migrations -Filter "*.sql" | Sort-Object Name | Select-Object -Last 1
Write-Host "Deployed through $($latest.Name) to $Environment. Backup marker: $backupRef"
