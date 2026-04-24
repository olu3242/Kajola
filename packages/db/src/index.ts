export type SqlMigration = {
  id: string;
  name: string;
  sql: string;
};

export const migrations: SqlMigration[] = [];
