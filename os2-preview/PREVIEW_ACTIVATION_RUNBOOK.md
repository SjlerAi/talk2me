# Talk2Me OS2 Preview Activation Runbook

## Purpose

This runbook controls source validation before any deployment, migration, restart, or formal UAT activity for `talk2me.kloka.co.za`.

## Fixed preview identity

- Application: `talk2me-os2-preview`
- Version: `0.59.0`
- Branch: `agent/talk2me-os2-integrated-rebuild`
- Application root: `/home/kloka/repositories/talk2me/os2-preview`
- Database: `kloka_talk2me`
- Node.js: 20.x
- Production: `talk2me.uent.co.za` must remain untouched
- Customer-merge execution: disabled

## Mandatory source-only preflight

Run from `/home/kloka/repositories/talk2me/os2-preview`:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:preview-activation-preflight
```

The preflight must execute these controls in this exact order:

1. `workspace-topology-verification.js`
2. `dependency-lock-verification.js`
3. `dependency-lock-governance-check.js`
4. `workspace-source-integrity.js`
5. `workspace-source-integrity-check.js`
6. `workspace-topology-governance-check.js`
7. `migration-ledger-bootstrap-governance-check.js`
8. `migration-ledger-bootstrap-runner-check.js`
9. `migration-ledger-bootstrap-evidence-check.js`
10. `migration-runner-security-check.js`
11. `restore-test-governance-check.js`
12. `restore-test-integration-check.js`
13. `recovery-readiness-check.js`
14. `recovery-release-gate.js`
15. `runtime-release-identity-check.js`
16. `readiness-check.js`
17. `deployment-check.js`
18. `uat-gate-check.js`
19. `release-evidence-security-check.js`
20. `release-source-integrity-check.js`
21. `release-manifest-check.js`

Every child control has a 30-second execution limit, forced `SIGKILL` termination on timeout, shell execution disabled, inherited output, and fixed preview-only safety flags. The preflight stops immediately when a child cannot start, times out, is interrupted, or returns a non-zero status.

## Dependency lock verification

A committed `package-lock.json` is mandatory before activation source hashing. A missing lockfile is a hard stop; it is not a warning and cannot be bypassed with `npm install`, `--package-lock=false`, conditional auditing, or manual acceptance.

`dependency-lock-verification.js` securely reads `package.json` and `package-lock.json` using canonical path checks, single-link regular-file checks, owner and permission controls, `O_NOFOLLOW`, descriptor identity, metadata stability, bounded reads, fatal UTF-8 decoding, LF line endings and final newline.

The verifier requires:

- package name `talk2me-os2-preview` and version `0.59.0`;
- a private package with main entrypoint `server.js`;
- the exact reviewed six direct dependencies;
- semantic direct dependency specifications;
- no root development, optional, bundled or workspace dependencies;
- no dangerous npm lifecycle scripts;
- `lockfileVersion` must be `3`;
- the lock root must match package identity and direct dependencies exactly;
- normalized paths contained under `node_modules/`;
- no linked, bundled, extraneous, development or install-script packages;
- HTTPS tarballs from `registry.npmjs.org` only;
- SHA-512 integrity for every installed package;
- resolvable dependency graph edges;
- a lock entry for every direct dependency.

The verifier calculates SHA-256 for both package files and reports `packageLockPresent: true`. It is read-only and performs no dependency installation.

`dependency-lock-governance-check.js` confirms that the verifier, CI workflow, activation order, protected source inventory and runbooks enforce the same policy.

After the lock passes verification, dependency installation must use:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --audit-level=high
```

`npm install` is not an approved substitute.

## Sanitized child environment

Each preflight child runs in a sanitized allowlisted child environment. The complete parent environment is never copied into a child process.

Only these operational variables may be inherited when present: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `TEMP`, `TMP`, `LANG`, `LC_ALL`, `TZ`, `CI`, and `GITHUB_ACTIONS`.

These startup hooks and path overrides are explicitly prohibited from inheritance: `NODE_OPTIONS`, `NODE_PATH`, `BASH_ENV`, `ENV`, `CDPATH`, `GIT_DIR`, `GIT_WORK_TREE`, `NPM_CONFIG_PREFIX`, and `NPM_CONFIG_USERCONFIG`.

The preflight always forces:

```text
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
NODE_ENV=production
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The resulting environment object is frozen before the first child starts, its key count is bounded, and the same immutable environment is supplied to all 21 ordered controls. Production mutation and merge execution are forced off in every child.

Successful preflight evidence must report `childEnvironmentSanitized: true`, `childEnvironmentAllowlistApplied: true`, `childEnvironmentFrozen: true`, and false inheritance markers for all prohibited variables.

## Workspace topology verification

Before other activation controls, the workspace verifier must prove that the executing directory is the configured preview application root.

It must reject a missing, relative, non-normalized, or mismatched `PREVIEW_APP_ROOT`; validate the application root and migrations directory as real non-symlink directories; open directory descriptors with `O_DIRECTORY | O_NOFOLLOW`; compare path and descriptor device/inode identities; reject unsafe write permissions; require protected source files to share the preview-root owner; reject symbolic links and additional hard links; enforce bounded file sizes; require at least 25 ordered migration files and migration 025; and re-check directory identity after inventory validation.

## Deterministic source integrity inventory

After dependency lock verification, `workspace-source-integrity.js` creates a deterministic SHA-256 inventory in memory. It must not modify the workspace or write evidence files.

The inventory requires and protects:

- `package.json` and `package-lock.json`;
- dependency lock verification and governance;
- the CI workflow;
- package and server entrypoints;
- bootstrap and migration controls;
- backup generation and verification;
- isolated restore testing;
- recovery readiness and recovery release gates;
- activation, readiness, deployment and UAT gates;
- release source verification and release freeze;
- related governance checks and runbooks;
- every ordered migration.

The inventory is self-protecting and includes `workspace-source-integrity.js` and `workspace-source-integrity-check.js`. The CI workflow file itself is part of the protected source inventory. Any change to `.github/workflows/os2-preview-ci.yml`, dependency controls, package files, code, migrations or runbooks changes `inventorySha256` and invalidates earlier CI source evidence.

Each source is read through secure descriptor-based reads using `O_NOFOLLOW`, canonical path binding, device/inode comparison, additional hard-link rejection, ownership consistency, safe permission checks and bounded reads.

The canonical inventory record contains the relative filename, byte length and SHA-256 checksum for each protected file. Records are sorted by filename and hashed again to produce one source inventory digest named `inventorySha256`.

Retain the full source inventory output with activation evidence. A different source inventory digest means the source surface changed and previous activation evidence is no longer applicable.

## Governed recovery commands

The package exposes these exact commands:

```text
backup:preview                  node backup-runner.js
verify:backup                   node backup-verification.js
restore:test                    node restore-test-runner.js
check:restore-test-governance   node restore-test-governance-check.js
check:restore-test-integration  node restore-test-integration-check.js
check:recovery-readiness        node recovery-readiness-check.js
check:recovery-release          node recovery-release-gate.js
```

`npm run check` syntax-checks backup, verification, restore and recovery files. It executes source-governance checks but must not execute `backup-runner.js`, `backup-verification.js`, or `restore-test-runner.js`, because those commands require explicit preview identity and may change recovery evidence.

## Approved release source integrity

After successful CI for the exact candidate commit, retain the approved workspace inventory digest as `RELEASE_SOURCE_INVENTORY_SHA256`.

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-ci-inventory-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:release-source-integrity
```

The verifier must complete within 30 seconds, run with shell execution disabled, require the committed lockfile in the protected inventory, and report `exactApprovedInventoryMatched: true` and `packageLockPresent: true`.

Any source change after CI approval invalidates the candidate. Re-run approved source-integrity verification immediately before formal UAT and again immediately before release freeze.

## Preflight limitations

A successful preflight proves source-governance readiness only. It does not install dependencies, connect to the database, create backups, verify backups, run restore tests, bootstrap the migration ledger, apply migrations, restart preview, execute UAT, or deploy.

Successful output must retain:

```text
dependencyInstallationExecuted: false
backupRuntimeExecuted: false
backupVerificationExecuted: false
restoreTestExecuted: false
databaseBackedVerificationExecuted: false
migrationsExecuted: false
previewRestartExecuted: false
productionMutationEnabled: false
mergeExecutionEnabled: false
```

## Activation sequence after source preflight

1. Confirm the controlled branch and exact intended commit.
2. Generate and commit `package-lock.json` in a trusted Node.js 20 and npm 10 environment.
3. Run dependency lock verification and dependency lock governance.
4. Repeat source-only preflight so the committed lock is included in the protected digest.
5. Run `npm ci --ignore-scripts --no-audit --no-fund`.
6. Run `npm audit --omit=dev --audit-level=high`.
7. Run `npm run check`, `npm run check:readiness`, `npm run check:deployment`, `npm run check:uat-gate`, `npm run check:recovery-readiness`, and `npm run check:recovery-release`.
8. Retain the approved CI source inventory and set `RELEASE_SOURCE_INVENTORY_SHA256`.
9. Run approved release-source verification.
10. Run `npm run backup:preview` against `kloka_talk2me` with preview-only flags.
11. Run `npm run verify:backup -- <backup-id>` and retain verified backup evidence.
12. Pre-create an empty isolated restore database using the governed naming pattern.
13. Run `npm run restore:test -- <backup-id>` with explicit restore-test approval and reviewer identity.
14. Retain a passed restore-test record proving checksum reverification, target emptiness, required tables, exactly 25 migration rows and zero failed checks.
15. Create a private canonical bootstrap-evidence directory.
16. Execute the one-time migration-ledger bootstrap with verified backup evidence.
17. Verify the bootstrap evidence pair.
18. Apply migrations with the same evidence path and preview-only flags.
19. Accept completion only when lock release and database closure are proven.
20. Run `DB_NAME=kloka_talk2me npm run verify:preview-data`.
21. Re-run source verification before formal UAT.
22. Complete automated and manual preview UAT.
23. Re-run source verification before release freeze.
24. Freeze and verify the release manifest.
25. Restart only the preview Node.js application.
26. Run technical smoke testing.
27. Record all results in GitHub Issue #83.

## Recovery controls

Backup generation must be preview-only, branch-bound, private-directory restricted, descriptor-based, checksum-backed, bounded and fail-closed. Backup verification must re-open the exact private file, bind path and descriptor identity, recompute SHA-256 and record passed operational evidence.

The restore test must use a pre-created empty isolated database. It must never create or drop databases, must reverify the backup checksum before import, run the import with a sanitized bounded child process, create running evidence before import, record the authorised reviewer, compare restored table count, require the core tables, require exactly 25 valid migration-ledger entries and finish with `failedChecks: 0`.

Recovery governance passing is not recovery execution evidence.

## Bootstrap and migration controls

The bootstrap runner must refuse every database except `kloka_talk2me`, require verified backup evidence, refuse an existing migration ledger, securely read the reviewed bootstrap source, acquire and verify the preview advisory lock, verify the created schema and empty ledger, confirm lock release, close MySQL before publishing evidence, and atomically publish private JSON evidence and its SHA-256 sidecar.

The migration runner must re-run the bootstrap evidence verifier before opening MySQL. It must securely freeze migration sources, validate the ledger as an exact checksum-matching strict prefix, apply only remaining ordered migrations, confirm lock release, close MySQL and only then print final success.

Individual `applied <migration>` lines are not completion evidence.

## Secure release-evidence verification

After release freeze, `release-manifest-verification.js` must receive the exact commit SHA, controlled branch, approved source digest and absolute canonical manifest path. It must first rerun approved source-integrity verification, then securely verify the release manifest and checksum sidecar, package files, bootstrap source, every migration source, and the private bootstrap evidence pair.

Protected reads must reject symbolic links, additional hard links, non-canonical paths, descriptor identity changes, invalid private permissions and oversized files. They must use `O_NOFOLLOW` and descriptor-based reads. Checksums must use constant-time comparison where applicable.

## Hard-stop conditions

Do not proceed when preview identity differs, protected paths are unsafe, a preflight child fails, `package-lock.json` is absent, dependency lock verification fails, lockfile version is not 3, package and lock dependencies differ, a package uses an unapproved source or invalid integrity, `npm ci` or dependency audit fails, source inventory differs from approved CI evidence, recovery commands differ, database or branch identity is wrong, Node.js is not 20.x, production mutation or merge execution is enabled, verified backup or passed restore evidence is missing, bootstrap evidence is missing, migration completion cannot prove lock release and connection closure, preview-data verification fails, UAT evidence is incomplete, release-manifest verification fails, or the exact deployed commit cannot be proven.

The committed `package-lock.json`, dependency installation, migration-ledger bootstrap, migration 025, preview-data verification, deployment, restart and formal UAT have not yet been completed.
