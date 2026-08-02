-- Talk2Me OS2 preview migration ledger bootstrap
-- Target database: kloka_talk2me only.
-- Apply manually once, after verified preview backup and before running migration-runner.js.
-- This file is deliberately outside migrations/ because the runner requires the ledger to exist before applying governed migrations.

CREATE TABLE os2_schema_migrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  migration_name VARCHAR(255) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_by VARCHAR(190) NULL,
  execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_os2_schema_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
