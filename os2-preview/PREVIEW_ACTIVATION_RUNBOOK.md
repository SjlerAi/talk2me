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

## Dependency lock generation

A committed `package-lock.json` is mandatory. A missing lockfile is a hard stop for activation, CI, dependency audit, source approval and release freeze.

Generate the initial lock only through the separately governed procedure in `DEPENDENCY_LOCK_GENERATION_RUNBOOK.md`. That procedure requires Node.js 20, npm 10, the exact controlled branch, a canonical private temporary root, a private evidence path, the exact npm registry, lifecycle scripts disabled, package-lock-only execution and independent post-publication verification.

A controlled manual GitHub Actions path is documented in `DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md`. The workflow is protected by `dependency-lock-workflow-check.js`, runs only through `workflow_dispatch`, has read-only repository permission, does not commit automatically and publishes a seven-day review artifact containing `package-lock.json`, evidence, manifest and checksums.

The source-only activation preflight runs `dependency-lock-generator-check.js`, `dependency-lock-workflow-check.js` and `dependency-lock-artifact-check.js`; it never runs `dependency-lock-generator.js`, `dependency-lock-artifact-verification.js` or the GitHub Actions workflow. Successful source governance must retain:

```text
dependencyLockGeneratorGovernanceVerified: true
dependencyLockWorkflowGovernanceVerified: true
dependencyLockArtifactGovernanceVerified: true
dependencyLockArtifactVerificationExecuted: false
dependencyLockGenerationWorkflowExecuted: false
dependencyLockGenerationExecuted: false
```

After generation, review and commit only `package-lock.json`. Private generation evidence and temporary npm data must stay outside the repository and outside `public_html`.

## Dependency lock artifact verification

The downloaded review artifact must be verified through `dependency-lock-artifact-verification.js` according to `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md` before its `package-lock.json` is considered for commit.

Artifact verification requires:

- the exact 13-file artifact set;
- a private `0700` canonical artifact directory;
- private `0600` regular files;
- no symbolic links, additional hard links, hidden files or nested directories;
- exact repository, branch, commit, workflow, run ID and run-attempt identity;
- exact `SHA256SUMS` coverage with constant-time digest comparison;
- the dedicated generation-evidence checksum sidecar;
- exact lock identity and reviewed direct dependencies;
- exact manifest keys and safety flags;
- successful generation, independent verification and governance evidence;
- matching pre-install, post-install and manifest source inventory digests;
- rejection of password, token, secret, authorization, cookie and database-password fields.

Artifact verification is environment-bound and therefore is not executed by `npm run check` or the source-only activation preflight.

## Dependency lock verification

Before source hashing, `dependency-lock-verification.js` must securely verify:

- exact package and application identity;
- exact reviewed direct dependencies;
- canonical regular package files;
- one-link ownership and safe permissions;
- `lockfileVersion` must be `3`;
- npm-registry HTTPS tarball URLs;
- SHA-512 package integrity;
- resolved dependency graph edges;
- absence of development, linked, bundled, extraneous and install-script packages;
- production mutation and customer-merge execution disabled.

`dependency-lock-governance-check.js` then confirms CI, source protection and activation wiring. Neither dependency installation nor dependency-lock generation occurs during these source-only checks.

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
4. `dependency-lock-generator-check.js`
5. `dependency-lock-workflow-check.js`
6. `dependency-lock-artifact-check.js`
7. `workspace-source-integrity.js`
8. `workspace-source-integrity-check.js`
9. `workspace-topology-governance-check.js`
10. `migration-ledger-bootstrap-governance-check.js`
11. `migration-ledger-bootstrap-runner-check.js`
12. `migration-ledger-bootstrap-evidence-check.js`
13. `migration-runner-security-check.js`
14. `restore-test-governance-check.js`
15. `restore-test-integration-check.js`
16. `recovery-readiness-check.js`
17. `recovery-release-gate.js`
18. `runtime-release-identity-check.js`
19. `readiness-check.js`
20. `deployment-check.js`
21. `uat-gate-check.js`
22. `release-evidence-security-check.js`
23. `release-source-integrity-check.js`
24. `release-manifest-check.js`

Every child control has a 30-second execution limit, forced `SIGKILL` termination on timeout, shell execution disabled, inherited output and fixed preview-only safety flags. The preflight stops when a child cannot start, times out, is interrupted or returns non-zero.

## Sanitized allowlisted child environment

Each preflight child runs in a sanitized allowlisted child environment. The complete parent environment is never copied into a child process.

Only these operational values may be inherited when present:

```text
PATH
HOME
USER
LOGNAME
TMPDIR
TEMP
TMP
LANG
LC_ALL
TZ
CI
GITHUB_ACTIONS
```

These startup hooks and path overrides are prohibited:

```text
NODE_OPTIONS
NODE_PATH
BASH_ENV
ENV
CDPATH
GIT_DIR
GIT_WORK_TREE
NPM_CONFIG_PREFIX
NPM_CONFIG_USERCONFIG
```

The preflight always forces:

```text
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview
DB_NAME=kloka_talk2me
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild
NODE_ENV=production
ALLOW_PRODUCTION_MUTATION=false
ENABLE_CUSTOMER_MERGE_EXECUTION=false
```

The environment object is frozen, its key count is bounded, and the same immutable values are supplied to all 24 controls. Production mutation and merge execution are forced off in every child.

## Workspace topology verification

The workspace verifier must prove that the executing directory is the configured preview application root. It rejects a missing, relative, non-normalized or mismatched root; validates application and migration directories as real non-symlink directories; uses `O_DIRECTORY | O_NOFOLLOW`; compares path and descriptor identity; rejects unsafe permissions; requires owner consistency; rejects symbolic links and additional hard links; bounds protected file sizes; requires 25 ordered migrations and migration 025; and rechecks directory identity after inventory validation.

`package-lock.json` is mandatory and receives the same path, ownership, mode, link and descriptor checks.

## Deterministic SHA-256 inventory

Immediately after dependency governance, `workspace-source-integrity.js` creates a deterministic SHA-256 inventory in memory. It must not modify the workspace.

The inventory includes:

- `.github/workflows/os2-preview-ci.yml`;
- `.github/workflows/os2-dependency-lock-generation.yml`;
- `package.json` and `package-lock.json`;
- dependency lock verification, generation, workflow, artifact and governance controls;
- `DEPENDENCY_LOCK_GENERATION_RUNBOOK.md`;
- `DEPENDENCY_LOCK_WORKFLOW_RUNBOOK.md`;
- `DEPENDENCY_LOCK_ARTIFACT_REVIEW_RUNBOOK.md`;
- server, migration, recovery, activation, readiness, deployment, UAT and release controls;
- all protected governance files;
- every ordered migration;
- all activation, deployment, UAT, release, backup and CI runbooks.

The CI workflow file itself is part of the protected source inventory. The dependency-lock workflow is also part of the protected source inventory. Any workflow change changes the source inventory digest.

Each protected file is read through secure descriptor-based reads using `O_NOFOLLOW`, canonical path binding, device and inode comparison, additional hard-link rejection, owner consistency, safe permissions and bounded reads.

The canonical record contains relative filename, byte length and SHA-256. Sorted records are hashed into one source inventory digest named `inventorySha256`.

## Governed dependency commands

The package exposes these dependency-lock commands:

```text
verify:dependency-lock           node dependency-lock-verification.js
generate:dependency-lock         node dependency-lock-generator.js
verify:dependency-lock-artifact  node dependency-lock-artifact-verification.js
check:dependency-lock-governance node dependency-lock-governance-check.js
check:dependency-lock-generator  node dependency-lock-generator-check.js
check:dependency-lock-workflow   node dependency-lock-workflow-check.js
check:dependency-lock-artifact   node dependency-lock-artifact-check.js
```

`npm run check` syntax-checks all dependency-lock controls and executes source-only governance. It must not execute dependency-lock generation or environment-bound artifact verification.

## Governed recovery commands

The package exposes these recovery commands:

```text
backup:preview                  node backup-runner.js
verify:backup                   node backup-verification.js
restore:test                    node restore-test-runner.js
check:restore-test-governance   node restore-test-governance-check.js
check:restore-test-integration  node restore-test-integration-check.js
check:recovery-readiness        node recovery-readiness-check.js
check:recovery-release          node recovery-release-gate.js
```

`npm run check` may syntax-check recovery files and execute source-only governance. It must not execute backup generation, backup verification or restore testing.

## Approved release source integrity

After successful CI for the exact candidate commit, retain the approved `inventorySha256` as `RELEASE_SOURCE_INVENTORY_SHA256` and run:

```bash
PREVIEW_APP_ROOT=/home/kloka/repositories/talk2me/os2-preview \
DB_NAME=kloka_talk2me \
RELEASE_BRANCH=agent/talk2me-os2-integrated-rebuild \
RELEASE_SOURCE_INVENTORY_SHA256=<approved-ci-inventory-sha256> \
ALLOW_PRODUCTION_MUTATION=false \
ENABLE_CUSTOMER_MERGE_EXECUTION=false \
npm run verify:release-source-integrity
```

The verifier must complete within 30 seconds, use shell execution disabled, require the committed lockfile and report exact approved inventory matching.

Any protected source change invalidates prior CI approval and requires a new CI run and approved digest.

## Source-only limitations

A successful activation preflight proves source governance only. It does not prove dependency-lock artifact verification, dependency-lock workflow execution, dependency-lock generation, dependency installation, backup execution, backup verification, restore testing, database migration, preview data verification, deployment, restart, smoke testing or UAT.

Successful preflight evidence must retain:

```text
dependencyLockArtifactVerificationExecuted: false
dependencyLockGenerationWorkflowExecuted: false
dependencyLockGenerationExecuted: false
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

## Activation sequence

1. Confirm the controlled branch and exact intended commit.
2. When absent, generate `package-lock.json` either through the controlled server-side generator procedure or the manual read-only GitHub workflow.
3. Verify the private evidence pair or downloaded workflow artifact and `SHA256SUMS`.
4. Run `dependency-lock-artifact-verification.js` for a downloaded workflow artifact and retain its successful result.
5. Review and commit only the generated lockfile.
6. Repeat the source-only activation preflight.
7. Run `npm ci --ignore-scripts --no-audit --no-fund` from the committed lockfile.
8. Run `npm run check`, readiness, deployment, UAT and recovery governance checks.
9. Run `npm audit --omit=dev --audit-level=high` and stop on unresolved high or critical findings.
10. Retain the exact CI workspace source inventory and build-evidence artifact.
11. Run approved release-source integrity verification.
12. Generate and verify the preview database backup.
13. Pre-create an empty isolated restore database.
14. Run the isolated restore test and require zero failed checks.
15. Create the private bootstrap-evidence directory.
16. Execute the one-time migration-ledger bootstrap.
17. Verify the bootstrap evidence pair.
18. Apply the 25 ordered preview migrations.
19. Require advisory-lock release and database closure evidence.
20. Run preview-data verification.
21. Re-run approved source-integrity verification before formal UAT.
22. Complete automated and manual preview UAT.
23. Re-run source-integrity verification before release freeze.
24. Freeze and verify the release manifest.
25. Restart only the preview Node.js application.
26. Run technical smoke testing.
27. Record all evidence in GitHub Issue #83.

## Dependency installation policy

A missing lockfile is a hard stop. `npm install` is not an approved release installation method. The exact committed lock must drive:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --audit-level=high
```

Dependency installation and auditing occur only after dependency-lock verification, generator governance, workflow governance, artifact governance, workspace topology and source integrity pass for the exact candidate.

## Recovery controls

Backup generation is preview-only, branch-bound, private-directory restricted, checksum-backed, bounded and fail-closed. Backup verification reopens the exact private file, binds path and descriptor identity, recalculates SHA-256 and records operational evidence.

Restore testing requires a pre-created empty isolated database, checksum reverification, a sanitized bounded import process, running evidence before import, an authorised reviewer, matching table counts, core tables, exactly 25 valid migration rows and zero failed checks.

## Bootstrap and migration controls

The bootstrap runner refuses every database except `kloka_talk2me`, requires verified backup evidence, refuses an existing migration ledger, securely reads the reviewed bootstrap source, verifies the advisory-lock lifecycle, confirms the exact empty ledger and publishes private evidence only after MySQL closes.

The migration runner reverifies bootstrap evidence before opening MySQL, freezes migration sources, requires a checksum-matching strict ledger prefix, applies remaining migrations in order, confirms lock release and closes MySQL before final success.

Individual `applied <migration>` lines are not completion evidence.

## Secure release evidence

After release freeze, release-manifest verification receives the exact commit, controlled branch, approved source digest and canonical manifest path. It first reruns source-integrity verification and then securely verifies the manifest, checksum sidecar, package files, bootstrap source, every migration and the private bootstrap evidence pair.

Protected reads reject symbolic links, additional hard links, non-canonical paths, descriptor changes, unsafe permissions and oversized files. Checksums use constant-time comparison where applicable.

## Hard-stop conditions

Do not proceed when:

- preview root identity differs;
- protected paths are unsafe;
- a source-only child exceeds 30 seconds;
- `package-lock.json` is absent;
- dependency-lock verification fails;
- dependency-lock generator governance fails;
- dependency-lock workflow governance fails;
- dependency-lock artifact governance fails;
- downloaded artifact verification fails;
- the workflow artifact source commit or checksums do not match;
- artifact permissions are not private;
- artifact evidence contains prohibited secret fields;
- Node.js is not 20.x;
- production mutation or merge execution is enabled;
- the source inventory differs from the approved CI digest;
- the dependency audit has unresolved high or critical findings;
- verified backup or restore evidence is missing;
- bootstrap or migration evidence is incomplete;
- preview-data verification fails;
- UAT evidence is incomplete;
- release-manifest verification fails;
- the exact deployed commit cannot be proven.

The dependency lock has not been generated or committed. The dependency-lock workflow and artifact verifier have not been executed. The migration-ledger bootstrap, migration 025, preview data verification, deployment, restart and formal UAT have not yet been executed.
