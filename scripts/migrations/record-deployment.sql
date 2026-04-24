INSERT INTO migration_deployments (
  environment,
  migration_version,
  migration_name,
  status,
  drift_status,
  backup_reference,
  commit_sha,
  applied_at
)
VALUES (
  :'environment',
  :'migration_version',
  :'migration_name',
  :'status',
  :'drift_status',
  :'backup_reference',
  :'commit_sha',
  NOW()
)
ON CONFLICT (environment, migration_version) DO UPDATE
SET status = EXCLUDED.status,
    drift_status = EXCLUDED.drift_status,
    backup_reference = EXCLUDED.backup_reference,
    commit_sha = EXCLUDED.commit_sha,
    applied_at = EXCLUDED.applied_at,
    error_message = NULL;
