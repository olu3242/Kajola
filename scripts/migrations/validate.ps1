param(
  [string]$MigrationsPath = "supabase/migrations",
  [switch]$AllowDestructive
)

$ErrorActionPreference = "Stop"
$namePattern = '^\d{14}_[a-z0-9_]+\.sql$'
$unsafePatterns = @(
  '(?i)\bDROP\s+TABLE\b',
  '(?i)\bDROP\s+COLUMN\b',
  '(?i)\bALTER\s+TABLE\b.+\bALTER\s+COLUMN\b.+\bTYPE\b',
  '(?i)\bTRUNCATE\b',
  '(?i)\bDELETE\s+FROM\b(?!\s+\w+\s+WHERE\b)'
)

if (!(Test-Path $MigrationsPath)) {
  throw "Migrations path not found: $MigrationsPath"
}

$files = Get-ChildItem -Path $MigrationsPath -Filter "*.sql" | Sort-Object Name
if ($files.Count -eq 0) {
  throw "No migrations found."
}

$versions = @{}
foreach ($file in $files) {
  if ($file.Name -notmatch $namePattern) {
    throw "Invalid migration name: $($file.Name). Use YYYYMMDD_HHMMSS_description.sql"
  }

  $version = $file.Name.Substring(0, 15)
  if ($versions.ContainsKey($version)) {
    throw "Duplicate migration timestamp: $version"
  }
  $versions[$version] = $true

  $sql = Get-Content -Raw -LiteralPath $file.FullName
  foreach ($pattern in $unsafePatterns) {
    if ($sql -match $pattern -and !$AllowDestructive -and $sql -notmatch 'ALLOW_DESTRUCTIVE_MIGRATION') {
      throw "Unsafe migration operation in $($file.Name). Split safely or add ALLOW_DESTRUCTIVE_MIGRATION with rollback."
    }
  }

  if ($sql -match 'ALLOW_DESTRUCTIVE_MIGRATION') {
    $rollback = Join-Path "supabase/rollbacks" ($file.BaseName + ".rollback.sql")
    if (!(Test-Path $rollback)) {
      throw "Destructive migration requires rollback script: $rollback"
    }
  }
}

Write-Host "Migration validation passed for $($files.Count) migrations."
