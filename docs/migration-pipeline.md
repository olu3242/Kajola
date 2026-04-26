# Kajola Migration Pipeline

## Rules
- Every schema change must be a file in `supabase/migrations`.
- Never edit production schema manually.
- Name migrations `YYYYMMDD_HHMMSS_description.sql`.
- Prefer safe rollout: add column, backfill, switch app logic, remove later.
- Destructive SQL requires `ALLOW_DESTRUCTIVE_MIGRATION` and a matching rollback file in `supabase/rollbacks`.

## Environments
- `local`: developer Supabase instance.
- `staging`: production mirror for validation.
- `production`: live marketplace database.

Each environment must use the same migration history.

## Local Flow
```bash
supabase migration new add_feature
supabase db push
supabase db diff
pwsh ./scripts/migrations/validate.ps1
```

`supabase db diff` must be empty before opening a PR.

## Staging and Production
CI validates migrations on PR. Merge to `main` deploys to staging, checks drift, then deploys to production after the protected environment approval.

Required GitHub secrets:
- `SUPABASE_ACCESS_TOKEN`
- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_SUPABASE_DB_PASSWORD`
- `PROD_SUPABASE_PROJECT_REF`
- `PROD_SUPABASE_DB_PASSWORD`

## Rollback
- Prefer forward-fix migrations.
- Use Supabase point-in-time recovery for data-loss incidents.
- Store backup marker from `artifacts/migration-backups`.
- Keep rollback SQL beside the migration when destructive changes are unavoidable.

## Drift
Run:
```bash
pwsh ./scripts/migrations/check-drift.ps1 -ProjectRef <project-ref>
```

Any non-empty diff blocks deployment until reconciled by a migration.
